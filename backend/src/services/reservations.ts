import { createRequire } from 'node:module';
import { prisma } from '../db.js';
import { config } from '../config.js';
import type { ScopeChain } from '../types.js';

/**
 * Token/cost reservations bridge the gap between `check-budget` (which reserves
 * projected headroom) and `record-usage` (which finalizes actuals). While a call
 * is in flight its reservation must be visible to concurrent checks so a swarm of
 * agents cannot collectively overshoot a hard budget (see docs/ARCHITECTURE.md).
 *
 * This module puts that bookkeeping behind a small interface with two backends:
 *
 *   - `DbReservationStore` (default): reservations are `LlmRequest` rows with
 *     `status = 'reserved'`, summed with a Prisma aggregate. Zero infrastructure;
 *     correct on a single node. This preserves the original behavior exactly.
 *   - `RedisReservationStore` (opt-in via `REDIS_URL`): outstanding reservations
 *     live in Redis sorted sets keyed per budget scope, with TTL-based expiry, so
 *     the headroom read no longer contends on the SQL hot path and works across
 *     many backend nodes sharing one Redis.
 *
 * The `LlmRequest` row is still written in both modes — it remains the source of
 * truth for accounting and analytics; only the *reserved headroom* computation is
 * swapped out.
 */

export type Metric = 'TOKENS' | 'COST_USD';

export interface ReservationRecord {
  id: string;
  chain: ScopeChain;
  reservedTokens: number;
  estimatedCostUsd: number;
  createdAt: Date;
}

export interface ReservationStore {
  /** Backend name, for diagnostics. */
  readonly kind: 'db' | 'redis';
  /** Outstanding reserved amount (tokens or cost) for a budget scope. */
  reserved(chain: ScopeChain, level: string, scopeId: string | null, metric: Metric): Promise<number>;
  /** Register a new reservation so concurrent checks see its headroom consumption. */
  add(rec: ReservationRecord): Promise<void>;
  /** Release a reservation once it is finalized, blocked, or explicitly dropped. */
  release(id: string): Promise<void>;
  /** Drop reservations older than TTL. Returns the count where knowable. */
  expireStale(opts?: { organizationId?: string; now?: Date }): Promise<number>;
}

/** Levels that never carry outstanding reservation headroom. */
const NO_RESERVATION_LEVELS: ReadonlySet<string> = new Set(['REQUEST', 'TOOL_CALL']);

function chainId(level: string, chain: ScopeChain): string | null | undefined {
  switch (level) {
    case 'ORGANIZATION':
      return chain.organizationId;
    case 'PROJECT':
      return chain.projectId;
    case 'AGENT':
      return chain.agentId;
    case 'SESSION':
      return chain.sessionId;
    case 'TASK':
      return chain.taskId;
    case 'USER':
      return chain.userId;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// DB-backed store (default) — preserves the original Prisma-aggregate behavior.
// ---------------------------------------------------------------------------

/** Maps a budget's (level, scopeId) onto the reservation rows it should sum. */
function reservationScopeFilter(level: string, scopeId: string | null, chain: ScopeChain) {
  switch (level) {
    case 'PROJECT':
      return { projectId: scopeId ?? chain.projectId ?? '__none__' };
    case 'AGENT':
      return { agentId: scopeId ?? chain.agentId ?? '__none__' };
    case 'SESSION':
      return { sessionId: scopeId ?? chain.sessionId ?? '__none__' };
    case 'TASK':
      return { taskId: scopeId ?? chain.taskId ?? '__none__' };
    case 'USER':
      return { userId: scopeId ?? chain.userId ?? '__none__' };
    case 'ORGANIZATION':
    default:
      return { organizationId: chain.organizationId };
  }
}

export class DbReservationStore implements ReservationStore {
  readonly kind = 'db' as const;

  async reserved(chain: ScopeChain, level: string, scopeId: string | null, metric: Metric): Promise<number> {
    if (NO_RESERVATION_LEVELS.has(level)) return 0;
    const cutoff = new Date(Date.now() - config.reservationTtlMs);
    const agg = await prisma.llmRequest.aggregate({
      where: {
        organizationId: chain.organizationId,
        status: 'reserved',
        createdAt: { gte: cutoff },
        ...reservationScopeFilter(level, scopeId, chain),
      },
      _sum: { reservedTokens: true, estimatedCostUsd: true },
    });
    return metric === 'COST_USD' ? agg._sum.estimatedCostUsd ?? 0 : agg._sum.reservedTokens ?? 0;
  }

  /** No-op: the `LlmRequest` row created by `createReservation` already carries the headroom. */
  async add(): Promise<void> {}

  /** No-op: `recordUsage` / `blockReservation` transition the row out of `reserved`. */
  async release(): Promise<void> {}

  async expireStale(opts: { organizationId?: string; now?: Date } = {}): Promise<number> {
    const now = opts.now ?? new Date();
    const cutoff = new Date(now.getTime() - config.reservationTtlMs);
    const result = await prisma.llmRequest.updateMany({
      where: {
        status: 'reserved',
        createdAt: { lt: cutoff },
        ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      },
      data: { status: 'expired' },
    });
    return result.count;
  }
}

// ---------------------------------------------------------------------------
// Redis-backed store (opt-in) — per-scope sorted sets with TTL expiry.
// ---------------------------------------------------------------------------

/**
 * The subset of the Redis client this store needs. `ioredis` satisfies it; tests
 * inject an in-memory fake so no live Redis is required.
 */
export interface MinimalRedis {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, ...members: string[]): Promise<unknown>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>;
  hset(key: string, values: Record<string, string>): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  del(key: string): Promise<unknown>;
  pexpire(key: string, ms: number): Promise<unknown>;
}

const KEY_PREFIX = 'tbm:resv';
const scopeKey = (orgId: string, level: string, id: string) => `${KEY_PREFIX}:z:${orgId}:${level}:${id}`;
const recKey = (id: string) => `${KEY_PREFIX}:rec:${id}`;

/** Scopes a reservation contributes headroom to, derived from its chain. */
function reservationScopes(chain: ScopeChain): Array<{ level: string; id: string }> {
  const scopes: Array<{ level: string; id: string }> = [
    { level: 'ORGANIZATION', id: chain.organizationId },
  ];
  const add = (level: string, id: string | null | undefined) => {
    if (id) scopes.push({ level, id });
  };
  add('PROJECT', chain.projectId);
  add('AGENT', chain.agentId);
  add('SESSION', chain.sessionId);
  add('TASK', chain.taskId);
  add('USER', chain.userId);
  return scopes;
}

export class RedisReservationStore implements ReservationStore {
  readonly kind = 'redis' as const;
  private readonly ttlMs: number;

  constructor(private readonly redis: MinimalRedis, ttlMs: number = config.reservationTtlMs) {
    this.ttlMs = ttlMs;
  }

  async reserved(chain: ScopeChain, level: string, scopeId: string | null, metric: Metric): Promise<number> {
    if (NO_RESERVATION_LEVELS.has(level)) return 0;
    const id = scopeId ?? chainId(level, chain) ?? '__none__';
    const key = scopeKey(chain.organizationId, level, id);
    const now = Date.now();
    // Lazily drop anything past its TTL, then sum what remains.
    await this.redis.zremrangebyscore(key, 0, now);
    const ids = await this.redis.zrange(key, 0, -1);
    if (ids.length === 0) return 0;
    let total = 0;
    for (const resId of ids) {
      const rec = await this.redis.hgetall(recKey(resId));
      if (!rec || Object.keys(rec).length === 0) continue; // record TTL'd out
      total += metric === 'COST_USD' ? Number(rec.cost ?? 0) : Number(rec.tokens ?? 0);
    }
    return total;
  }

  async add(rec: ReservationRecord): Promise<void> {
    const scopes = reservationScopes(rec.chain);
    const expiry = rec.createdAt.getTime() + this.ttlMs;
    await this.redis.hset(recKey(rec.id), {
      tokens: String(rec.reservedTokens),
      cost: String(rec.estimatedCostUsd),
      scopes: scopes.map((s) => `${s.level}:${s.id}`).join(','),
    });
    await this.redis.pexpire(recKey(rec.id), this.ttlMs);
    for (const s of scopes) {
      const key = scopeKey(rec.chain.organizationId, s.level, s.id);
      await this.redis.zadd(key, expiry, rec.id);
      await this.redis.pexpire(key, this.ttlMs);
    }
  }

  async release(id: string): Promise<void> {
    const rec = await this.redis.hgetall(recKey(id));
    if (rec && rec.scopes) {
      // rec.scopes = "ORGANIZATION:org1,AGENT:a1,..."; reconstruct each key.
      const orgId = rec.scopes.split(',')[0]?.split(':')[1];
      if (orgId) {
        for (const entry of rec.scopes.split(',')) {
          const [level, sid] = entry.split(':');
          if (level && sid) await this.redis.zrem(scopeKey(orgId, level, sid), id);
        }
      }
    }
    await this.redis.del(recKey(id));
  }

  /** TTL + lazy `zremrangebyscore` on read handle expiry; nothing to sweep here. */
  async expireStale(): Promise<number> {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Selection: REDIS_URL opts into Redis; otherwise the DB store (zero infra).
// ---------------------------------------------------------------------------

let store: ReservationStore | null = null;

/** Memoized reservation store, chosen once from config. */
export function getReservationStore(): ReservationStore {
  if (store) return store;
  if (config.redisUrl) {
    try {
      store = new RedisReservationStore(createIoRedis(config.redisUrl));
      // eslint-disable-next-line no-console
      console.log('[tbm] reservation store: redis');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[tbm] redis reservation store unavailable, falling back to db:', err);
      store = new DbReservationStore();
    }
  } else {
    store = new DbReservationStore();
  }
  return store;
}

/** Test hook: inject a store (e.g. a Redis store backed by a fake client). */
export function setReservationStore(next: ReservationStore | null): void {
  store = next;
}

/** Construct a real ioredis client. Required lazily so DB-only runs never load it. */
function createIoRedis(url: string): MinimalRedis {
  const require = createRequire(import.meta.url);
  const mod = require('ioredis');
  const RedisCtor = mod.default ?? mod;
  const client = new RedisCtor(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  return client as MinimalRedis;
}
