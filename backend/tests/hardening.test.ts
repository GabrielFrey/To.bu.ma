import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { resetDb } from './helpers.js';
import { buildServer } from '../src/server.js';
import { hashApiKey } from '../src/crypto.js';
import { chooseModel } from '../src/services/optimization.js';
import { MAX_MESSAGES, MAX_MESSAGE_CHARS } from '../src/routes/schemas.js';

const API_KEY = 'tbm_hardening_test_key';
const authHeaders = { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' };

async function seedTenant() {
  const org = await prisma.organization.create({ data: { name: 'Hardening Org' } });
  await prisma.apiKey.create({
    data: { organizationId: org.id, name: 'k', keyHash: hashApiKey(API_KEY), role: 'owner' },
  });
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
  await prisma.modelPricing.create({
    data: {
      provider: 'openai',
      model: 'gpt-4o',
      organizationId: null,
      inputPerMTokens: 2.5,
      outputPerMTokens: 10,
      cachedPerMTokens: 1.25,
      contextWindow: 128000,
    },
  });
  return org;
}

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  if (app) await app.close();
  app = await buildServer();
});
afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

describe('P2-2 · proxy request-body bounds', () => {
  it('rejects a chat body with too many messages (OpenAI-style 400, no tokenizer work)', async () => {
    await seedTenant();
    const messages = Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeaders,
      payload: { model: 'gpt-4o-mini', messages },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.code).toBe('invalid_request');
    // Nothing should have been budgeted/recorded for a rejected body.
    const count = await prisma.tokenUsage.count();
    expect(count).toBe(0);
  });

  it('rejects a single oversized message content', async () => {
    await seedTenant();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeaders,
      payload: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'a'.repeat(MAX_MESSAGE_CHARS + 1) }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.type).toBe('invalid_request_error');
  });

  it('rejects an empty messages array', async () => {
    await seedTenant();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeaders,
      payload: { model: 'gpt-4o-mini', messages: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('still accepts a valid, in-bounds body and passes extra OpenAI fields through', async () => {
    await seedTenant();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeaders,
      payload: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 16,
        temperature: 0.2,
        top_p: 0.9,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().object).toBe('chat.completion');
  });

  it('bounds embeddings input array length', async () => {
    await seedTenant();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: authHeaders,
      payload: { model: 'gpt-4o-mini', input: Array.from({ length: MAX_MESSAGES + 1 }, () => 'x') },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.type).toBe('invalid_request_error');
  });
});

describe('P2-3 · chooseModel reports token vs cost fit separately', () => {
  it('flags a token-budget breach without emptying the candidate pool', async () => {
    await seedTenant();
    // Token budget cannot fit the reservation no matter which model is chosen.
    const result = await chooseModel({
      requestedModel: 'gpt-4o',
      promptTokens: 1000,
      expectedCompletionTokens: 500,
      remainingBudgetTokens: 100, // 1500 reserved >> 100 remaining
      preferCheaper: true,
      organizationId: undefined,
    });
    // A model is still selected (cheapest), not an empty/failed result.
    expect(result.model).toBeTruthy();
    expect(result.candidatesConsidered).toBeGreaterThan(0);
    // The token constraint is reported independently and is the reason for the miss.
    expect(result.fitsTokenBudget).toBe(false);
    expect(result.fitsRemainingBudget).toBe(false);
    expect(result.reason).toMatch(/token budget/i);
  });

  it('reports both constraints satisfied when the reservation fits', async () => {
    await seedTenant();
    const result = await chooseModel({
      requestedModel: 'gpt-4o',
      promptTokens: 100,
      expectedCompletionTokens: 50,
      remainingBudgetTokens: 100000,
      remainingBudgetUsd: 100,
      preferCheaper: true,
      organizationId: undefined,
    });
    expect(result.fitsTokenBudget).toBe(true);
    expect(result.fitsCostBudget).toBe(true);
    expect(result.fitsRemainingBudget).toBe(true);
  });

  it('separates a cost-only miss from a token miss', async () => {
    await seedTenant();
    // Tokens fit; cost is the binding constraint. Cheapest model should be chosen.
    const result = await chooseModel({
      requestedModel: 'gpt-4o',
      promptTokens: 1000,
      expectedCompletionTokens: 500,
      remainingBudgetTokens: 100000,
      remainingBudgetUsd: 0.0001, // too small for any model
      preferCheaper: true,
      organizationId: undefined,
    });
    expect(result.fitsTokenBudget).toBe(true);
    expect(result.fitsCostBudget).toBe(false);
    expect(result.reason).toMatch(/cost budget/i);
  });
});
