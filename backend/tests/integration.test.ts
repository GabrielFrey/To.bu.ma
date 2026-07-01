import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { resetDb } from './helpers.js';
import { buildServer } from '../src/server.js';
import { hashApiKey } from '../src/crypto.js';

const API_KEY = 'tbm_test_key';

async function seedTenant(opts: { agentHardLimit?: number } = {}) {
  const org = await prisma.organization.create({ data: { name: 'IT Org' } });
  await prisma.apiKey.create({
    data: { organizationId: org.id, name: 'k', keyHash: hashApiKey(API_KEY), role: 'owner' },
  });
  const project = await prisma.project.create({ data: { organizationId: org.id, name: 'P' } });
  const agent = await prisma.agent.create({ data: { projectId: project.id, name: 'A' } });
  const session = await prisma.session.create({ data: { agentId: agent.id } });
  const task = await prisma.task.create({ data: { sessionId: session.id, name: 'T' } });
  await prisma.modelPricing.create({
    data: { provider: 'openai', model: 'gpt-4o-mini', organizationId: null, inputPerMTokens: 0.15, outputPerMTokens: 0.6, cachedPerMTokens: 0.075, contextWindow: 128000 },
  });
  if (opts.agentHardLimit) {
    await prisma.budget.create({
      data: { organizationId: org.id, name: 'agent cap', level: 'AGENT', scopeId: agent.id, hardLimit: opts.agentHardLimit, resetPeriod: 'NEVER', fallbackBehavior: 'BLOCK' },
    });
  }
  return { org, project, agent, session, task };
}

let app: FastifyInstance;
const headers = { 'x-api-key': API_KEY, 'content-type': 'application/json' };

beforeEach(async () => {
  await resetDb();
  if (app) await app.close();
  app = await buildServer();
});
afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

describe('check -> record -> analytics flow (mock provider)', () => {
  it('forecasts, records actuals, and reflects spend in analytics', async () => {
    const { agent, session, task } = await seedTenant();
    const scope = { agentId: agent.id, sessionId: session.id, taskId: task.id };

    const check = await app.inject({
      method: 'POST', url: '/v1/check-budget', headers,
      payload: { model: 'gpt-4o-mini', provider: 'mock', messages: [{ role: 'user', content: 'hello world' }], expectedCompletionTokens: 32, scope },
    });
    const cb = check.json();
    expect(cb.allowed).toBe(true);
    expect(cb.forecast.promptTokens).toBeGreaterThan(0);
    expect(cb.forecast.reservedTokens).toBeGreaterThan(cb.forecast.promptTokens);
    expect(cb.requestId).toBeTruthy();

    const record = await app.inject({
      method: 'POST', url: '/v1/record-usage', headers,
      payload: { requestId: cb.requestId, usage: { inputTokens: cb.forecast.promptTokens, outputTokens: 20 } },
    });
    expect(record.statusCode).toBe(200);

    const total = (await app.inject({ method: 'GET', url: '/v1/analytics/total', headers })).json();
    expect(total.totalTokens).toBe(cb.forecast.promptTokens + 20);
    expect(total.requests).toBe(1);

    const byAgent = (await app.inject({ method: 'GET', url: '/v1/analytics/by-agent', headers })).json();
    expect(byAgent[0].agentId).toBe(agent.id);
  });

  it('llm/complete runs the whole gateway in one call', async () => {
    const { agent, session, task } = await seedTenant();
    const scope = { agentId: agent.id, sessionId: session.id, taskId: task.id };
    const res = await app.inject({
      method: 'POST', url: '/v1/llm/complete', headers,
      payload: { model: 'gpt-4o-mini', provider: 'mock', messages: [{ role: 'user', content: 'classify this' }], maxTokens: 32, scope },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toContain('mock');
    expect(body.usage.totalTokens).toBeGreaterThan(0);
    const total = (await app.inject({ method: 'GET', url: '/v1/analytics/total', headers })).json();
    expect(total.requests).toBe(1);
  });
});

describe('hard budget enforcement (acceptance criterion #1)', () => {
  it('an agent cannot exceed its hard token budget', async () => {
    const { agent, session, task } = await seedTenant({ agentHardLimit: 500 });
    const scope = { agentId: agent.id, sessionId: session.id, taskId: task.id };

    let blocked = false;
    for (let i = 0; i < 50; i++) {
      const r = await app.inject({
        method: 'POST', url: '/v1/llm/complete', headers,
        payload: { model: 'gpt-4o-mini', provider: 'mock', messages: [{ role: 'user', content: `unique message number ${i} about charger diagnostics` }], maxTokens: 32, scope },
      });
      if (r.statusCode === 402) {
        blocked = true;
        expect(r.json().blocked).toBe(true);
        break;
      }
    }
    expect(blocked).toBe(true);

    const total = (await app.inject({ method: 'GET', url: '/v1/analytics/by-agent', headers })).json();
    const agentTokens = total.find((a: any) => a.agentId === agent.id)?.totalTokens ?? 0;
    expect(agentTokens).toBeLessThanOrEqual(500);
  });
});

describe('auth', () => {
  it('rejects requests without an api key', async () => {
    await seedTenant();
    const r = await app.inject({ method: 'GET', url: '/v1/analytics/total' });
    expect(r.statusCode).toBe(401);
  });
});
