import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { resetDb } from './helpers.js';
import { buildServer } from '../src/server.js';
import { hashApiKey } from '../src/crypto.js';

const API_KEY = 'tbm_proxy_test_key';

async function seedTenant(opts: { agentHardLimit?: number } = {}) {
  const org = await prisma.organization.create({ data: { name: 'Proxy Org' } });
  await prisma.apiKey.create({ data: { organizationId: org.id, name: 'k', keyHash: hashApiKey(API_KEY), role: 'owner' } });
  await prisma.modelPricing.create({
    data: { provider: 'openai', model: 'gpt-4o-mini', organizationId: null, inputPerMTokens: 0.15, outputPerMTokens: 0.6, cachedPerMTokens: 0.075, contextWindow: 128000 },
  });
  if (opts.agentHardLimit) {
    // Budget applies to the agent the proxy will find-or-create from headers.
    const project = await prisma.project.create({ data: { organizationId: org.id, name: 'proxy' } });
    const agent = await prisma.agent.create({ data: { projectId: project.id, name: 'invoice-bot' } });
    await prisma.budget.create({
      data: { organizationId: org.id, name: 'agent cap', level: 'AGENT', scopeId: agent.id, hardLimit: opts.agentHardLimit, resetPeriod: 'NEVER', fallbackBehavior: 'BLOCK' },
    });
  }
  return org;
}

let app: FastifyInstance;
// OpenAI SDKs send the key as a Bearer token — mimic that exactly.
const authHeaders = { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' };

beforeEach(async () => {
  await resetDb();
  if (app) await app.close();
  app = await buildServer();
});
afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

describe('OpenAI-compatible proxy — /v1/chat/completions', () => {
  it('accepts Bearer auth, returns a wire-compatible completion, and records usage', async () => {
    await seedTenant();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeaders,
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hello there proxy' }], max_tokens: 32 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.role).toBe('assistant');
    expect(body.usage.total_tokens).toBeGreaterThan(0);
    expect(res.headers['x-tbm-request-id']).toBeTruthy();

    const total = await prisma.tokenUsage.aggregate({ _sum: { totalTokens: true }, _count: true });
    expect(total._count).toBe(1);
    expect(total._sum.totalTokens).toBe(body.usage.total_tokens);
  });

  it('attributes usage to the agent from X-TBM-Agent header (find-or-create)', async () => {
    const org = await seedTenant();
    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { ...authHeaders, 'x-tbm-agent': 'summarizer', 'x-tbm-session': 's1', 'x-tbm-task': 'summarize-doc' },
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'summarize' }], max_tokens: 16 },
    });
    const agent = await prisma.agent.findFirst({ where: { name: 'summarizer' } });
    expect(agent).toBeTruthy();
    const usage = await prisma.tokenUsage.findFirst({ where: { organizationId: org.id } });
    expect(usage?.agentId).toBe(agent!.id);
    const task = await prisma.task.findFirst({ where: { name: 'summarize-doc' } });
    expect(task).toBeTruthy();
  });

  it('blocks at the hard limit with an OpenAI-style 402 error BEFORE forwarding', async () => {
    await seedTenant({ agentHardLimit: 400 });
    let blockedStatus = 0;
    let errorBody: any = null;
    for (let i = 0; i < 40; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { ...authHeaders, 'x-tbm-agent': 'invoice-bot' },
        payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: `invoice line ${i} needs careful review and classification` }], max_tokens: 32 },
      });
      if (res.statusCode === 402) {
        blockedStatus = 402;
        errorBody = res.json();
        break;
      }
    }
    expect(blockedStatus).toBe(402);
    expect(errorBody.error.type).toBe('insufficient_quota');
    expect(errorBody.error.code).toBe('budget_exceeded');

    // Agent never exceeded its hard budget.
    const agent = await prisma.agent.findFirst({ where: { name: 'invoice-bot' } });
    const sum = await prisma.tokenUsage.aggregate({ where: { agentId: agent!.id }, _sum: { totalTokens: true } });
    expect(sum._sum.totalTokens ?? 0).toBeLessThanOrEqual(400);
  });

  it('supports streaming (stream: true) and records usage from the final chunk', async () => {
    await seedTenant();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeaders,
      payload: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'stream please' }],
        max_tokens: 32,
        stream: true,
        stream_options: { include_usage: true },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('data:');
    expect(res.body).toContain('[DONE]');
    expect(res.headers['x-tbm-usage-estimated']).toBe('false');

    const usage = await prisma.tokenUsage.findFirst();
    expect(usage).toBeTruthy();
    expect(usage!.totalTokens).toBeGreaterThan(0);
  });

  it('marks usage estimated when a stream omits usage', async () => {
    await seedTenant();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeaders,
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'stream no usage' }], max_tokens: 16, stream: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-tbm-usage-estimated']).toBe('true');
    const usage = await prisma.tokenUsage.findFirst();
    expect(usage!.outputTokens).toBeGreaterThan(0); // estimated from streamed content
  });
});

describe('OpenAI-compatible proxy — /v1/embeddings', () => {
  it('budgets and records embedding input tokens', async () => {
    await seedTenant();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: authHeaders,
      payload: { model: 'gpt-4o-mini', input: ['embed this text', 'and this one too'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.object).toBe('list');
    expect(body.data).toHaveLength(2);
    const usage = await prisma.tokenUsage.findFirst();
    expect(usage!.inputTokens).toBeGreaterThan(0);
    expect(usage!.outputTokens).toBe(0);
  });
});

describe('OpenAI-compatible proxy — auth', () => {
  it('rejects a missing key with an OpenAI-style error', async () => {
    await seedTenant();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('missing_api_key');
  });
});
