import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { resetDb } from './helpers.js';
import { buildServer } from '../src/server.js';
import { hashApiKey } from '../src/crypto.js';
import { recordUsage } from '../src/services/accounting.js';
import { resolveScopeFromHeaders } from '../src/services/scope.js';

/** One tenant with its own key, project/agent/session/task and pricing. */
async function makeTenant(name: string, key: string, role = 'owner') {
  const org = await prisma.organization.create({ data: { name } });
  await prisma.apiKey.create({
    data: { organizationId: org.id, name: `${name} key`, keyHash: hashApiKey(key), role },
  });
  const project = await prisma.project.create({ data: { organizationId: org.id, name: `${name} P` } });
  const agent = await prisma.agent.create({ data: { projectId: project.id, name: `${name} A` } });
  const session = await prisma.session.create({ data: { agentId: agent.id } });
  const task = await prisma.task.create({ data: { sessionId: session.id, name: `${name} T` } });
  return { org, project, agent, session, task };
}

async function ensurePricing() {
  const existing = await prisma.modelPricing.findFirst({ where: { model: 'gpt-4o-mini' } });
  if (existing) return;
  await prisma.modelPricing.create({
    data: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      organizationId: null,
      inputPerMTokens: 0.15,
      outputPerMTokens: 0.6,
      cachedPerMTokens: 0.075,
      contextWindow: 128000,
    },
  });
}

let app: FastifyInstance;
const KEY_A = 'tbm_tenant_a';
const KEY_B = 'tbm_tenant_b';
const hdr = (key: string) => ({ 'x-api-key': key, 'content-type': 'application/json' });

beforeEach(async () => {
  await resetDb();
  if (app) await app.close();
  app = await buildServer();
});
afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

describe('multi-tenant isolation', () => {
  it('rejects a scope that belongs to another tenant instead of leaking its budgets', async () => {
    await ensurePricing();
    const a = await makeTenant('A', KEY_A);
    const b = await makeTenant('B', KEY_B);
    await prisma.budget.create({
      data: {
        organizationId: b.org.id,
        name: 'B secret cap',
        level: 'AGENT',
        scopeId: b.agent.id,
        hardLimit: 12345,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });

    // Tenant A authenticates with its own key but names tenant B's agent.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/check-budget',
      headers: hdr(KEY_A),
      payload: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'probe' }],
        scope: { agentId: b.agent.id },
      },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain('B secret cap');
    // And nothing was attributed to tenant B.
    expect(await prisma.llmRequest.count({ where: { agentId: b.agent.id } })).toBe(0);
    expect(a.agent.id).not.toBe(b.agent.id);
  });

  it('rejects every foreign scope dimension', async () => {
    await ensurePricing();
    await makeTenant('A', KEY_A);
    const b = await makeTenant('B', KEY_B);
    const foreign = [
      { projectId: b.project.id },
      { agentId: b.agent.id },
      { sessionId: b.session.id },
      { taskId: b.task.id },
    ];
    for (const scope of foreign) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/forecast/run',
        headers: hdr(KEY_A),
        payload: {
          model: 'gpt-4o-mini',
          estimatedSteps: 2,
          avgPromptTokens: 10,
          avgCompletionTokens: 10,
          scope,
        },
      });
      expect(res.statusCode, `scope ${JSON.stringify(scope)} should be rejected`).toBe(404);
    }
  });

  it('cannot finalize another tenant\'s reservation via /v1/record-usage', async () => {
    await ensurePricing();
    await makeTenant('A', KEY_A);
    const b = await makeTenant('B', KEY_B);

    // Tenant B legitimately reserves.
    const check = await app.inject({
      method: 'POST',
      url: '/v1/check-budget',
      headers: hdr(KEY_B),
      payload: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'B work' }],
        scope: { agentId: b.agent.id },
      },
    });
    const requestId = check.json().requestId as string;
    expect(requestId).toBeTruthy();

    // Tenant A tries to post usage against it.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/record-usage',
      headers: hdr(KEY_A),
      payload: { requestId, usage: { inputTokens: 999_999, outputTokens: 999_999 } },
    });

    expect(res.statusCode).toBe(404);
    expect(await prisma.tokenUsage.count({ where: { organizationId: b.org.id } })).toBe(0);
  });

  it('recordUsage refuses to run without a tenant (undefined must not bypass the filter)', async () => {
    const b = await makeTenant('B', KEY_B);
    const req = await prisma.llmRequest.create({
      data: { organizationId: b.org.id, model: 'gpt-4o-mini', status: 'reserved' },
    });
    await expect(
      // @ts-expect-error deliberately omitting the tenant
      recordUsage({ requestId: req.id, usage: { inputTokens: 1, outputTokens: 1 } })
    ).rejects.toThrow(/organizationId/);
  });

  it('does not expose another tenant\'s agents, budgets or events', async () => {
    await makeTenant('A', KEY_A);
    const b = await makeTenant('B', KEY_B);
    await prisma.budget.create({
      data: { organizationId: b.org.id, name: 'B only', level: 'ORGANIZATION', hardLimit: 1 },
    });
    const agents = (await app.inject({ method: 'GET', url: '/v1/agents', headers: hdr(KEY_A) })).json();
    const budgets = (await app.inject({ method: 'GET', url: '/v1/budgets', headers: hdr(KEY_A) })).json();
    expect(agents.some((x: { id: string }) => x.id === b.agent.id)).toBe(false);
    expect(budgets).toHaveLength(0);
  });
});

describe('RBAC', () => {
  it('a viewer key cannot spend budget or mutate configuration', async () => {
    await ensurePricing();
    const t = await makeTenant('V', KEY_A, 'viewer');

    const spend = await app.inject({
      method: 'POST',
      url: '/v1/llm/complete',
      headers: hdr(KEY_A),
      payload: {
        model: 'gpt-4o-mini',
        provider: 'mock',
        messages: [{ role: 'user', content: 'spend money' }],
        scope: { agentId: t.agent.id },
      },
    });
    expect(spend.statusCode).toBe(403);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/budgets',
      headers: hdr(KEY_A),
      payload: { name: 'nope', level: 'ORGANIZATION', hardLimit: 10 },
    });
    expect(create.statusCode).toBe(403);

    // Reading analytics is still allowed.
    const read = await app.inject({ method: 'GET', url: '/v1/analytics/total', headers: hdr(KEY_A) });
    expect(read.statusCode).toBe(200);
  });

  it('a member key can spend but cannot change budgets', async () => {
    await ensurePricing();
    const t = await makeTenant('M', KEY_A, 'member');
    const spend = await app.inject({
      method: 'POST',
      url: '/v1/llm/complete',
      headers: hdr(KEY_A),
      payload: {
        model: 'gpt-4o-mini',
        provider: 'mock',
        messages: [{ role: 'user', content: 'work' }],
        scope: { agentId: t.agent.id },
      },
    });
    expect(spend.statusCode).toBe(200);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/budgets',
      headers: hdr(KEY_A),
      payload: { name: 'nope', level: 'ORGANIZATION', hardLimit: 10 },
    });
    expect(create.statusCode).toBe(403);
  });
});

describe('concurrent reservations cannot overshoot a hard budget', () => {
  it('20 simultaneous calls against a 300-token cap stay under it', async () => {
    await ensurePricing();
    const t = await makeTenant('C', KEY_A);
    const hardLimit = 300;
    await prisma.budget.create({
      data: {
        organizationId: t.org.id,
        name: 'concurrency cap',
        level: 'AGENT',
        scopeId: t.agent.id,
        metric: 'TOKENS',
        hardLimit,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });

    const scope = { agentId: t.agent.id, sessionId: t.session.id };
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/v1/llm/complete',
          headers: hdr(KEY_A),
          payload: {
            model: 'gpt-4o-mini',
            provider: 'mock',
            messages: [{ role: 'user', content: `concurrent request number ${i} about diagnostics` }],
            maxTokens: 32,
            scope,
          },
        })
      )
    );

    const allowed = results.filter((r) => r.statusCode === 200).length;
    const blocked = results.filter((r) => r.statusCode === 402).length;
    expect(allowed + blocked).toBe(20);
    expect(blocked).toBeGreaterThan(0);

    const agg = await prisma.tokenUsage.aggregate({
      where: { agentId: t.agent.id },
      _sum: { totalTokens: true },
    });
    expect(agg._sum.totalTokens ?? 0).toBeLessThanOrEqual(hardLimit);

    // No reservation that survived as `reserved`/`completed` may push the
    // committed + outstanding total over the cap either.
    const outstanding = await prisma.llmRequest.aggregate({
      where: { agentId: t.agent.id, status: 'reserved' },
      _sum: { reservedTokens: true },
    });
    expect((agg._sum.totalTokens ?? 0) + (outstanding._sum.reservedTokens ?? 0)).toBeLessThanOrEqual(hardLimit);
  });
});

describe('budget level semantics', () => {
  it('a REQUEST-level budget caps one call, not the org lifetime', async () => {
    await ensurePricing();
    const t = await makeTenant('R', KEY_A);
    await prisma.budget.create({
      data: {
        organizationId: t.org.id,
        name: 'per-call token guard',
        level: 'REQUEST',
        metric: 'TOKENS',
        hardLimit: 400,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });
    const scope = { agentId: t.agent.id, sessionId: t.session.id };
    const small = () =>
      app.inject({
        method: 'POST',
        url: '/v1/llm/complete',
        headers: hdr(KEY_A),
        payload: {
          model: 'gpt-4o-mini',
          provider: 'mock',
          messages: [{ role: 'user', content: `short ask ${Math.random()}` }],
          maxTokens: 16,
          scope,
        },
      });

    // Many small calls: each is well under 400 tokens, so none may be blocked
    // however much cumulative spend has already happened.
    for (let i = 0; i < 6; i++) {
      expect((await small()).statusCode).toBe(200);
    }

    // One oversized call exceeds the per-call cap on its own.
    const big = await app.inject({
      method: 'POST',
      url: '/v1/llm/complete',
      headers: hdr(KEY_A),
      payload: {
        model: 'gpt-4o-mini',
        provider: 'mock',
        messages: [{ role: 'user', content: 'x '.repeat(1000) }],
        maxTokens: 64,
        scope,
      },
    });
    expect(big.statusCode).toBe(402);
  });

  it('a USER-level budget only counts that user\'s usage', async () => {
    await ensurePricing();
    const t = await makeTenant('U', KEY_A);
    const alice = await prisma.user.create({
      data: { organizationId: t.org.id, email: 'alice@u.local', role: 'member' },
    });
    const bob = await prisma.user.create({
      data: { organizationId: t.org.id, email: 'bob@u.local', role: 'member' },
    });
    await prisma.budget.create({
      data: {
        organizationId: t.org.id,
        name: 'alice cap',
        level: 'USER',
        scopeId: alice.id,
        metric: 'TOKENS',
        hardLimit: 300,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });

    const call = (userId: string, i: number) =>
      app.inject({
        method: 'POST',
        url: '/v1/llm/complete',
        headers: hdr(KEY_A),
        payload: {
          model: 'gpt-4o-mini',
          provider: 'mock',
          messages: [{ role: 'user', content: `request ${i} with a reasonable amount of text in it` }],
          maxTokens: 32,
          scope: { agentId: t.agent.id, userId },
        },
      });

    // Bob is unlimited: burn well past Alice's cap on his account.
    for (let i = 0; i < 6; i++) expect((await call(bob.id, i)).statusCode).toBe(200);
    // Alice still has her own headroom.
    expect((await call(alice.id, 100)).statusCode).toBe(200);
    // ...and eventually hits her own cap.
    let aliceBlocked = false;
    for (let i = 0; i < 10 && !aliceBlocked; i++) {
      aliceBlocked = (await call(alice.id, 200 + i)).statusCode === 402;
    }
    expect(aliceBlocked).toBe(true);
  });

  it('a TOOL_CALL budget counts tool tokens only', async () => {
    await ensurePricing();
    const t = await makeTenant('T', KEY_A);
    await prisma.budget.create({
      data: {
        organizationId: t.org.id,
        name: 'tool token cap',
        level: 'TOOL_CALL',
        metric: 'TOKENS',
        hardLimit: 100,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });
    const scope = { agentId: t.agent.id, sessionId: t.session.id };

    // A normal LLM call contributes no tool tokens, so it is unaffected.
    const llm = await app.inject({
      method: 'POST',
      url: '/v1/llm/complete',
      headers: hdr(KEY_A),
      payload: {
        model: 'gpt-4o-mini',
        provider: 'mock',
        messages: [{ role: 'user', content: 'a request with quite a lot of prompt text here' }],
        maxTokens: 32,
        scope,
      },
    });
    expect(llm.statusCode).toBe(200);

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/v1/record-tool-usage',
        headers: hdr(KEY_A),
        payload: { tool: 'web_search', toolTokens: 40, scope },
      });
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/check-budget',
      headers: hdr(KEY_A),
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'next' }], scope },
    });
    expect(blocked.json().allowed).toBe(false);
  });
});

describe('audit log', () => {
  it('records who changed a budget and whether the limit went up', async () => {
    const t = await makeTenant('A', KEY_A);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/v1/budgets',
        headers: hdr(KEY_A),
        payload: { name: 'audited', level: 'ORGANIZATION', hardLimit: 1000 },
      })
    ).json();

    await app.inject({
      method: 'PATCH',
      url: `/v1/budgets/${created.id}`,
      headers: hdr(KEY_A),
      payload: { hardLimit: 5000 },
    });

    const log = (await app.inject({ method: 'GET', url: '/v1/audit-log', headers: hdr(KEY_A) })).json();
    const actions = log.map((e: { action: string }) => e.action);
    expect(actions).toContain('budget.create');
    expect(actions).toContain('budget.update');
    const update = log.find((e: { action: string }) => e.action === 'budget.update');
    expect(update.target).toBe(created.id);
    expect(update.actor).toMatch(/^apikey:/);
    expect(JSON.parse(update.metadata).raisedHardLimit).toBe(true);
    expect(log.every((e: { organizationId: string }) => e.organizationId === t.org.id)).toBe(true);
  });
});

describe('proxy scope headers', () => {
  it('resolves X-TBM-User so chargeback-by-user is attributable', async () => {
    const t = await makeTenant('S', KEY_A);
    const chain = await resolveScopeFromHeaders(t.org.id, {
      agent: 'invoice-processor',
      user: 'dana@corp.example',
    });
    expect(chain.userId).toBeTruthy();
    const user = await prisma.user.findUnique({ where: { id: chain.userId! } });
    expect(user?.email).toBe('dana@corp.example');
    expect(user?.organizationId).toBe(t.org.id);

    // Idempotent: the same header does not create a second user.
    const again = await resolveScopeFromHeaders(t.org.id, { user: 'dana@corp.example' });
    expect(again.userId).toBe(chain.userId);
  });
});
