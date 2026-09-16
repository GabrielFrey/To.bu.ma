import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { resetDb, makeOrgScope } from './helpers.js';
import { hashApiKey } from '../src/crypto.js';
import { buildServer } from '../src/server.js';
import { chooseModel } from '../src/services/optimization.js';
import { resolveBudgets } from '../src/services/budgetEngine.js';
import { expireStaleReservations, createReservation, recordUsage } from '../src/services/accounting.js';
import { lookupPromptCache } from '../src/services/promptCache.js';
import { requestSignature } from '../src/services/loopDetection.js';
import { checkBudget } from '../src/services/gateway.js';
import {
  SUPPORT_DESK_PACK,
  BATCH_ETL_PACK,
  importPolicyPack,
  exportPolicyPack,
  parsePolicyPack,
} from '../src/services/policyPacks.js';
import { chargebackToCsv, chargebackReport } from '../src/services/chargeback.js';

const API_KEY = 'tbm_embed_key';
const headers = { 'x-api-key': API_KEY, 'content-type': 'application/json' };

async function seedHttpTenant() {
  const org = await prisma.organization.create({ data: { name: 'Embed Org' } });
  await prisma.apiKey.create({
    data: { organizationId: org.id, name: 'k', keyHash: hashApiKey(API_KEY), role: 'owner' },
  });
  const project = await prisma.project.create({ data: { organizationId: org.id, name: 'P' } });
  const agent = await prisma.agent.create({ data: { projectId: project.id, name: 'A' } });
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
  return { org, project, agent };
}

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('Policy packs', () => {
  it('parses and imports support-desk-pack onto an org', async () => {
    const { org, agent, task } = await makeOrgScope();
    const parsed = parsePolicyPack(SUPPORT_DESK_PACK);
    expect(parsed.id).toBe('support-desk-pack');
    const result = await importPolicyPack({
      organizationId: org.id,
      pack: parsed,
      scopeBindings: { agentId: agent.id, taskId: task.id },
    });
    expect(result.budgetsCreated).toBe(2);
    expect(result.policiesCreated).toBe(5);
    const budgets = await prisma.budget.findMany({ where: { organizationId: org.id }, include: { policies: true } });
    expect(budgets).toHaveLength(2);
    const agentBudget = budgets.find((b) => b.level === 'AGENT');
    expect(agentBudget?.scopeId).toBe(agent.id);
    expect(agentBudget?.policies.length).toBeGreaterThan(0);
  });

  it('round-trips export after import', async () => {
    const { org } = await makeOrgScope();
    await importPolicyPack({ organizationId: org.id, pack: BATCH_ETL_PACK });
    const exported = await exportPolicyPack(org.id, 'roundtrip');
    expect(exported.kind).toBe('tbm-policy-pack');
    expect(exported.budgets.length).toBe(BATCH_ETL_PACK.budgets.length);
    expect(exported.policies.length).toBe(BATCH_ETL_PACK.policies.length);
  });
});

describe('Price-aware chooseModel', () => {
  it('picks the cheapest model that still fits remaining USD budget', async () => {
    await makeOrgScope();
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
    const picked = await chooseModel({
      requestedModel: 'gpt-4o',
      promptTokens: 1000,
      expectedCompletionTokens: 256,
      remainingBudgetUsd: 0.01,
      preferCheaper: true,
    });
    expect(picked.model).toBe('gpt-4o-mini');
    expect(picked.fitsRemainingBudget).toBe(true);
    expect(picked.reason).toMatch(/cheaper model/);
  });

  it('keeps the requested model when preferCheaper is false and it fits', async () => {
    await makeOrgScope();
    const picked = await chooseModel({
      requestedModel: 'gpt-4o-mini',
      promptTokens: 100,
      preferCheaper: false,
    });
    expect(picked.model).toBe('gpt-4o-mini');
    expect(picked.reason).toBe('no downgrade requested');
  });
});

describe('Prompt cache hint', () => {
  it('hits after an identical completed prompt', async () => {
    const { org, chain } = await makeOrgScope();
    const messages = [{ role: 'user', content: 'classify this invoice' }];
    const signature = requestSignature(messages, 'gpt-4o-mini');
    const res = await createReservation({
      chain,
      model: 'gpt-4o-mini',
      provider: 'mock',
      promptTokens: 20,
      expectedCompletionTokens: 10,
      reservedTokens: 32,
      estimatedCostUsd: 0,
      signature,
      decision: 'allow',
      status: 'reserved',
    });
    await recordUsage({ requestId: res.id, organizationId: org.id, usage: { inputTokens: 20, outputTokens: 8 } });
    const hint = await lookupPromptCache({ organizationId: org.id, signature });
    expect(hint.hit).toBe(true);
    expect(hint.priorRequestId).toBe(res.id);
    expect(hint.suggestedCachedTokens).toBe(20);

    const check = await checkBudget({ chain, model: 'gpt-4o-mini', messages });
    expect(check.promptCache.hit).toBe(true);
  });
});

describe('Reservation TTL cleanup', () => {
  it('expires stale reservations so they no longer consume budget', async () => {
    const { org, agent, chain } = await makeOrgScope();
    await prisma.budget.create({
      data: {
        organizationId: org.id,
        name: 'cap',
        level: 'AGENT',
        scopeId: agent.id,
        hardLimit: 1000,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });
    await prisma.llmRequest.create({
      data: {
        organizationId: org.id,
        agentId: agent.id,
        model: 'gpt-4o-mini',
        status: 'reserved',
        reservedTokens: 950,
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
    const n = await expireStaleReservations();
    expect(n).toBe(1);
    const statuses = await resolveBudgets(chain, 100, 0);
    expect(statuses[0].reserved).toBe(0);
    expect(statuses[0].exceedsHard).toBe(false);
  });
});

describe('Chargeback CSV + HTTP surfaces', () => {
  let app: FastifyInstance | undefined;

  afterAll(async () => {
    if (app) await app.close();
  });

  it('groups spend by agent and renders CSV', async () => {
    const { org, chain, agent } = await makeOrgScope();
    const res = await createReservation({
      chain,
      model: 'gpt-4o-mini',
      provider: 'mock',
      promptTokens: 50,
      expectedCompletionTokens: 10,
      reservedTokens: 61,
      estimatedCostUsd: 0,
      signature: 's',
      decision: 'allow',
      status: 'reserved',
    });
    await recordUsage({ requestId: res.id, organizationId: org.id, usage: { inputTokens: 50, outputTokens: 10 } });
    const rows = await chargebackReport(org.id, 'agent');
    expect(rows[0].id).toBe(agent.id);
    expect(rows[0].totalTokens).toBe(60);
    const csv = chargebackToCsv(rows);
    expect(csv).toMatch(/^dimension,id,name,total_tokens,cost_usd,requests/);
    expect(csv).toContain(agent.id);
  });

  it('exposes pack import, chargeback CSV, and call_blocked webhook events', async () => {
    await resetDb();
    const { org, agent } = await seedHttpTenant();
    if (app) await app.close();
    app = await buildServer();

    const packs = await app.inject({ method: 'GET', url: '/v1/policy-packs', headers });
    expect(packs.statusCode).toBe(200);
    expect(packs.json().some((p: { id: string }) => p.id === 'support-desk-pack')).toBe(true);

    const imported = await app.inject({
      method: 'POST',
      url: '/v1/policy-packs/import',
      headers,
      payload: { packId: 'support-desk-pack', scopeBindings: { agentId: agent.id } },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().budgetsCreated).toBe(2);

    await prisma.budget.create({
      data: {
        organizationId: org.id,
        name: 'tiny',
        level: 'AGENT',
        scopeId: agent.id,
        hardLimit: 1,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });
    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/check-budget',
      headers,
      payload: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
        expectedCompletionTokens: 32,
        scope: { agentId: agent.id },
      },
    });
    expect(blocked.json().allowed).toBe(false);

    const events = await app.inject({ method: 'GET', url: '/v1/events', headers });
    const types = events.json().map((e: { type: string }) => e.type);
    expect(types).toContain('call_blocked');

    const csv = await app.inject({ method: 'GET', url: '/v1/analytics/chargeback.csv?groupBy=agent', headers });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toMatch(/dimension,id,name/);
  });
});
