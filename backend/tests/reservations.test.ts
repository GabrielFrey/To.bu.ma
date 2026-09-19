import { beforeEach, afterEach, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { resetDb, makeOrgScope } from './helpers.js';
import {
  RedisReservationStore,
  DbReservationStore,
  getReservationStore,
  setReservationStore,
  type MinimalRedis,
} from '../src/services/reservations.js';
import type { ScopeChain } from '../src/types.js';
import { checkBudget } from '../src/services/gateway.js';
import { recordUsage } from '../src/services/accounting.js';

/** Minimal in-memory Redis: enough of the sorted-set + hash API for the store. */
class FakeRedis implements MinimalRedis {
  zsets = new Map<string, Map<string, number>>();
  hashes = new Map<string, Record<string, string>>();
  private z(key: string) {
    let m = this.zsets.get(key);
    if (!m) {
      m = new Map();
      this.zsets.set(key, m);
    }
    return m;
  }
  async zadd(key: string, score: number, member: string) {
    this.z(key).set(member, score);
    return 1;
  }
  async zrange(key: string, start: number, stop: number) {
    const m = this.zsets.get(key);
    if (!m) return [];
    const arr = [...m.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
    const end = stop === -1 ? arr.length : stop + 1;
    return arr.slice(start, end);
  }
  async zrem(key: string, ...members: string[]) {
    const m = this.zsets.get(key);
    if (!m) return 0;
    let n = 0;
    for (const mem of members) if (m.delete(mem)) n++;
    return n;
  }
  async zremrangebyscore(key: string, min: number | string, max: number | string) {
    const m = this.zsets.get(key);
    if (!m) return 0;
    const lo = Number(min);
    const hi = Number(max);
    let n = 0;
    for (const [mem, score] of [...m]) {
      if (score >= lo && score <= hi) {
        m.delete(mem);
        n++;
      }
    }
    return n;
  }
  async hset(key: string, values: Record<string, string>) {
    const h = this.hashes.get(key) ?? {};
    Object.assign(h, values);
    this.hashes.set(key, h);
    return 1;
  }
  async hgetall(key: string) {
    return this.hashes.get(key) ?? {};
  }
  async del(key: string) {
    const had = this.hashes.delete(key);
    this.zsets.delete(key);
    return had ? 1 : 0;
  }
  async pexpire() {
    return 1;
  }
}

const chain: ScopeChain = {
  organizationId: 'org1',
  projectId: 'proj1',
  agentId: 'agent1',
};

describe('RedisReservationStore (unit, fake client)', () => {
  let redis: FakeRedis;
  let store: RedisReservationStore;
  beforeEach(() => {
    redis = new FakeRedis();
    store = new RedisReservationStore(redis, 5 * 60 * 1000);
  });

  it('reflects a reservation across every scope it belongs to', async () => {
    await store.add({ id: 'r1', chain, reservedTokens: 100, estimatedCostUsd: 0.5, createdAt: new Date() });
    expect(await store.reserved(chain, 'ORGANIZATION', null, 'TOKENS')).toBe(100);
    expect(await store.reserved(chain, 'PROJECT', null, 'TOKENS')).toBe(100);
    expect(await store.reserved(chain, 'AGENT', null, 'TOKENS')).toBe(100);
    expect(await store.reserved(chain, 'AGENT', null, 'COST_USD')).toBe(0.5);
    // A scope the reservation is not part of sees nothing.
    expect(await store.reserved(chain, 'SESSION', null, 'TOKENS')).toBe(0);
    // Per-call / tool-call levels never carry reservation headroom.
    expect(await store.reserved(chain, 'REQUEST', null, 'TOKENS')).toBe(0);
    expect(await store.reserved(chain, 'TOOL_CALL', null, 'TOKENS')).toBe(0);
  });

  it('sums multiple concurrent reservations on the same scope', async () => {
    await store.add({ id: 'r1', chain, reservedTokens: 100, estimatedCostUsd: 0.5, createdAt: new Date() });
    await store.add({ id: 'r2', chain, reservedTokens: 250, estimatedCostUsd: 1.0, createdAt: new Date() });
    expect(await store.reserved(chain, 'AGENT', null, 'TOKENS')).toBe(350);
    expect(await store.reserved(chain, 'AGENT', null, 'COST_USD')).toBe(1.5);
  });

  it('release() frees the reservation everywhere', async () => {
    await store.add({ id: 'r1', chain, reservedTokens: 100, estimatedCostUsd: 0.5, createdAt: new Date() });
    await store.add({ id: 'r2', chain, reservedTokens: 250, estimatedCostUsd: 1.0, createdAt: new Date() });
    await store.release('r1');
    expect(await store.reserved(chain, 'AGENT', null, 'TOKENS')).toBe(250);
    expect(await store.reserved(chain, 'ORGANIZATION', null, 'TOKENS')).toBe(250);
  });

  it('drops reservations past their TTL on read', async () => {
    const old = new Date(Date.now() - 10 * 60 * 1000); // older than the 5-min TTL
    await store.add({ id: 'stale', chain, reservedTokens: 100, estimatedCostUsd: 0.5, createdAt: old });
    expect(await store.reserved(chain, 'AGENT', null, 'TOKENS')).toBe(0);
  });

  it('matches a budget scopeId directly', async () => {
    await store.add({ id: 'r1', chain, reservedTokens: 100, estimatedCostUsd: 0.5, createdAt: new Date() });
    // Budget rows carry an explicit scopeId; it should hit the same key.
    expect(await store.reserved(chain, 'AGENT', 'agent1', 'TOKENS')).toBe(100);
    expect(await store.reserved(chain, 'AGENT', 'other-agent', 'TOKENS')).toBe(0);
  });
});

describe('reservation store selection', () => {
  afterEach(() => setReservationStore(null));
  it('defaults to the DB store when REDIS_URL is unset', () => {
    setReservationStore(null);
    expect(getReservationStore()).toBeInstanceOf(DbReservationStore);
  });
});

describe('gateway consults the reservation store (Redis backend)', () => {
  beforeEach(async () => {
    await resetDb();
    setReservationStore(new RedisReservationStore(new FakeRedis()));
  });
  afterEach(() => setReservationStore(null));
  afterAll(async () => {
    setReservationStore(null);
    await prisma.$disconnect();
  });

  it('registers headroom on check and releases it on record-usage', async () => {
    const { org, chain: dbChain, agent } = await makeOrgScope();
    await prisma.budget.create({
      data: {
        organizationId: org.id,
        name: 'agent cap',
        level: 'AGENT',
        scopeId: agent.id,
        metric: 'TOKENS',
        hardLimit: 1_000_000,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });

    const store = getReservationStore();
    const check = await checkBudget({
      chain: dbChain,
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'reserve some headroom please' }],
      expectedCompletionTokens: 128,
    });
    expect(check.allowed).toBe(true);
    // Headroom is now visible in the Redis-backed store for the agent scope.
    const reservedAfterCheck = await store.reserved(dbChain, 'AGENT', agent.id, 'TOKENS');
    expect(reservedAfterCheck).toBe(check.forecast.reservedTokens);
    expect(reservedAfterCheck).toBeGreaterThan(0);

    // Finalizing the call releases the reservation.
    await recordUsage({
      requestId: check.requestId!,
      organizationId: org.id,
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    expect(await store.reserved(dbChain, 'AGENT', agent.id, 'TOKENS')).toBe(0);
  });

  it('a second concurrent call sees the first call\'s reserved headroom', async () => {
    const { org, chain: dbChain, agent } = await makeOrgScope();
    // Deliberately tiny so one reservation consumes most of the budget.
    const first = await checkBudget({
      chain: dbChain,
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'first' }],
      expectedCompletionTokens: 64,
    });
    // Now cap the agent at exactly one reservation's worth.
    await prisma.budget.create({
      data: {
        organizationId: org.id,
        name: 'agent cap',
        level: 'AGENT',
        scopeId: agent.id,
        metric: 'TOKENS',
        hardLimit: first.forecast.reservedTokens,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });
    const second = await checkBudget({
      chain: dbChain,
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'second' }],
      expectedCompletionTokens: 64,
    });
    // used(0) + reserved(first) + projected(second) > hardLimit → blocked.
    expect(second.allowed).toBe(false);
  });
});
