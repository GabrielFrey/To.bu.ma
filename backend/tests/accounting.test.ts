import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { resetDb, makeOrgScope } from './helpers.js';
import { createReservation, recordUsage, recordToolUsage } from '../src/services/accounting.js';
import { computeCost, estimateCost } from '../src/pricing.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('pricing', () => {
  it('computes cost from token usage', async () => {
    await makeOrgScope();
    // gpt-4o-mini: $0.15 / 1M input, $0.6 / 1M output
    const cost = await computeCost('gpt-4o-mini', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.75, 6);
  });

  it('discounts cached tokens', async () => {
    await makeOrgScope();
    const cost = await computeCost('gpt-4o-mini', { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 1_000_000 });
    // all input cached => billed at cached rate 0.075
    expect(cost).toBeCloseTo(0.075, 6);
  });

  it('estimateCost matches computeCost for equivalent tokens', async () => {
    await makeOrgScope();
    const est = await estimateCost('gpt-4o-mini', 500_000, 500_000);
    const act = await computeCost('gpt-4o-mini', { inputTokens: 500_000, outputTokens: 500_000 });
    expect(est).toBeCloseTo(act, 6);
  });
});

describe('Token Accounting Service', () => {
  it('records actual usage and computes cost + total', async () => {
    const { org, chain } = await makeOrgScope();
    const res = await createReservation({
      chain, model: 'gpt-4o-mini', provider: 'mock', promptTokens: 100,
      expectedCompletionTokens: 50, reservedTokens: 155, estimatedCostUsd: 0.0001,
      signature: 'sig', decision: 'allow', status: 'reserved',
    });
    const { usage, idempotent } = await recordUsage({
      requestId: res.id,
      organizationId: org.id,
      usage: { inputTokens: 100, outputTokens: 40, cachedTokens: 0, toolTokens: 0 },
    });
    expect(idempotent).toBe(false);
    expect(usage.totalTokens).toBe(140);
    expect(usage.costUsd).toBeGreaterThan(0);
    const req = await prisma.llmRequest.findUnique({ where: { id: res.id } });
    expect(req?.status).toBe('completed');
    expect(await prisma.tokenUsage.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it('is idempotent per requestId (retries do not double-count)', async () => {
    const { org, chain } = await makeOrgScope();
    const res = await createReservation({
      chain, model: 'gpt-4o-mini', provider: 'mock', promptTokens: 10,
      expectedCompletionTokens: 10, reservedTokens: 22, estimatedCostUsd: 0,
      signature: 'sig', decision: 'allow', status: 'reserved',
    });
    const first = await recordUsage({ requestId: res.id, organizationId: org.id, usage: { inputTokens: 10, outputTokens: 10 } });
    const second = await recordUsage({ requestId: res.id, organizationId: org.id, usage: { inputTokens: 999, outputTokens: 999 } });
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.usage.totalTokens).toBe(first.usage.totalTokens);
    const agg = await prisma.tokenUsage.aggregate({ where: { organizationId: org.id }, _sum: { totalTokens: true } });
    expect(agg._sum.totalTokens).toBe(20);
  });

  it('captures input/output/cached/tool token dimensions', async () => {
    const { org, chain } = await makeOrgScope();
    const res = await createReservation({
      chain, model: 'gpt-4o-mini', provider: 'mock', promptTokens: 100,
      expectedCompletionTokens: 50, reservedTokens: 155, estimatedCostUsd: 0,
      signature: 'sig', decision: 'allow', status: 'reserved',
    });
    const { usage } = await recordUsage({
      requestId: res.id,
      organizationId: org.id,
      usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 30, toolTokens: 12 },
    });
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.cachedTokens).toBe(30);
    expect(usage.toolTokens).toBe(12);
    expect(usage.totalTokens).toBe(162);
  });

  it('records standalone tool usage', async () => {
    const { org, chain } = await makeOrgScope();
    const { usage } = await recordToolUsage({ chain, tool: 'web_search', toolTokens: 42 });
    expect(usage.toolTokens).toBe(42);
    const agg = await prisma.tokenUsage.aggregate({ where: { organizationId: org.id }, _sum: { toolTokens: true } });
    expect(agg._sum.toolTokens).toBe(42);
  });

  it('marks failed status when recording a failure', async () => {
    const { org, chain } = await makeOrgScope();
    const res = await createReservation({
      chain, model: 'gpt-4o-mini', provider: 'mock', promptTokens: 10,
      expectedCompletionTokens: 10, reservedTokens: 22, estimatedCostUsd: 0,
      signature: 'sig', decision: 'allow', status: 'reserved',
    });
    await recordUsage({ requestId: res.id, organizationId: org.id, usage: { inputTokens: 10, outputTokens: 0 }, status: 'failed' });
    const req = await prisma.llmRequest.findUnique({ where: { id: res.id } });
    expect(req?.status).toBe('failed');
  });
});
