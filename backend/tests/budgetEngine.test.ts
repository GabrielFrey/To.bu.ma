import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { resetDb, makeOrgScope } from './helpers.js';
import { resolveBudgets, resetWindowStart } from '../src/services/budgetEngine.js';
import { evaluatePolicies } from '../src/services/policyEngine.js';
import type { LoopSignals } from '../src/services/loopDetection.js';

const noLoop: LoopSignals = { signatureRepeats: 0, failedAttempts: 0, isLoop: false, isRepeatedFailure: false };

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('resetWindowStart', () => {
  it('returns null for NEVER', () => {
    expect(resetWindowStart('NEVER')).toBeNull();
  });
  it('truncates to start of day for DAILY', () => {
    const d = resetWindowStart('DAILY', new Date('2025-06-15T13:45:00Z'))!;
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});

describe('Budget Engine — resolution', () => {
  it('reports remaining and utilization for an agent budget', async () => {
    const { org, agent, chain } = await makeOrgScope();
    await prisma.budget.create({
      data: {
        organizationId: org.id,
        name: 'agent cap',
        level: 'AGENT',
        scopeId: agent.id,
        metric: 'TOKENS',
        hardLimit: 1000,
        softLimit: 700,
        warningThreshold: 0.8,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });
    const statuses = await resolveBudgets(chain, 100, 0);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].projected).toBe(100);
    expect(statuses[0].remaining).toBe(1000);
    expect(statuses[0].exceedsHard).toBe(false);
  });

  it('counts prior usage toward the budget within the reset window', async () => {
    const { org, agent, chain } = await makeOrgScope();
    await prisma.budget.create({
      data: { organizationId: org.id, name: 'cap', level: 'AGENT', scopeId: agent.id, hardLimit: 1000, resetPeriod: 'NEVER', fallbackBehavior: 'BLOCK' },
    });
    const req = await prisma.llmRequest.create({
      data: { organizationId: org.id, agentId: agent.id, model: 'gpt-4o-mini', status: 'completed', reservedTokens: 0 },
    });
    await prisma.tokenUsage.create({
      data: { requestId: req.id, organizationId: org.id, agentId: agent.id, model: 'gpt-4o-mini', totalTokens: 900, inputTokens: 900 },
    });
    const statuses = await resolveBudgets(chain, 50, 0);
    expect(statuses[0].used).toBe(900);
    expect(statuses[0].projected).toBe(950);
    expect(statuses[0].exceedsHard).toBe(false);

    const over = await resolveBudgets(chain, 200, 0);
    expect(over[0].exceedsHard).toBe(true);
  });

  it('includes live reservations in projected usage (concurrency safety)', async () => {
    const { org, agent, chain } = await makeOrgScope();
    await prisma.budget.create({
      data: { organizationId: org.id, name: 'cap', level: 'AGENT', scopeId: agent.id, hardLimit: 1000, resetPeriod: 'NEVER', fallbackBehavior: 'BLOCK' },
    });
    await prisma.llmRequest.create({
      data: { organizationId: org.id, agentId: agent.id, model: 'gpt-4o-mini', status: 'reserved', reservedTokens: 950 },
    });
    const statuses = await resolveBudgets(chain, 100, 0);
    expect(statuses[0].reserved).toBe(950);
    expect(statuses[0].exceedsHard).toBe(true);
  });

  it('most-restrictive-wins: agent hard limit blocks even when org has room', async () => {
    const { org, agent, chain } = await makeOrgScope();
    await prisma.budget.create({
      data: { organizationId: org.id, name: 'org', level: 'ORGANIZATION', hardLimit: 1_000_000, resetPeriod: 'NEVER', fallbackBehavior: 'BLOCK' },
    });
    const agentBudget = await prisma.budget.create({
      data: { organizationId: org.id, name: 'agent', level: 'AGENT', scopeId: agent.id, hardLimit: 100, resetPeriod: 'NEVER', fallbackBehavior: 'BLOCK' },
    });
    const statuses = await resolveBudgets(chain, 500, 0);
    const decision = await evaluatePolicies({ chain, budgets: statuses, loop: noLoop, requestCost: 0 });
    expect(decision.blocked).toBe(true);
    expect(decision.budgetId).toBe(agentBudget.id);
  });

  it('COST_USD metric budgets use projected cost', async () => {
    const { org, chain } = await makeOrgScope();
    await prisma.budget.create({
      data: { organizationId: org.id, name: 'cost', level: 'REQUEST', metric: 'COST_USD', hardLimit: 0.5, resetPeriod: 'NEVER', fallbackBehavior: 'REQUIRE_APPROVAL' },
    });
    const statuses = await resolveBudgets(chain, 100000, 0.75);
    expect(statuses[0].metric).toBe('COST_USD');
    expect(statuses[0].exceedsHard).toBe(true);
    const decision = await evaluatePolicies({ chain, budgets: statuses, loop: noLoop, requestCost: 0.75 });
    expect(decision.decision).toBe('require-approval');
    expect(decision.blocked).toBe(true);
  });
});

describe('Policy Engine — decisions', () => {
  it('warns at the warning threshold and degrades past soft limit', async () => {
    const { org, agent, chain } = await makeOrgScope();
    await prisma.budget.create({
      data: { organizationId: org.id, name: 'cap', level: 'AGENT', scopeId: agent.id, hardLimit: 1000, softLimit: 900, warningThreshold: 0.8, resetPeriod: 'NEVER', fallbackBehavior: 'BLOCK' },
    });
    // 850 > warningThreshold*hard (800) but < softLimit (900) => warn only
    const warn = await evaluatePolicies({ chain, budgets: await resolveBudgets(chain, 850, 0), loop: noLoop, requestCost: 0 });
    expect(warn.decision).toBe('warn');
    // 950 > softLimit (900) => degrade (most-restrictive-wins over warn)
    const degrade = await evaluatePolicies({ chain, budgets: await resolveBudgets(chain, 950, 0), loop: noLoop, requestCost: 0 });
    expect(degrade.decision).toBe('degrade');
  });

  it('stop-agent on useless loop and retry-limit on repeated failures', async () => {
    const { chain } = await makeOrgScope();
    const loopDecision = await evaluatePolicies({
      chain,
      budgets: [],
      loop: { signatureRepeats: 3, failedAttempts: 0, isLoop: true, isRepeatedFailure: false },
      requestCost: 0,
    });
    expect(loopDecision.decision).toBe('stop-agent');
    expect(loopDecision.blocked).toBe(true);

    const retryDecision = await evaluatePolicies({
      chain,
      budgets: [],
      loop: { signatureRepeats: 0, failedAttempts: 3, isLoop: false, isRepeatedFailure: true },
      requestCost: 0,
    });
    expect(retryDecision.decision).toBe('retry-limit');
    expect(retryDecision.blocked).toBe(true);
  });

  it('paused agent short-circuits to stop-agent', async () => {
    const { chain } = await makeOrgScope();
    const d = await evaluatePolicies({ chain, budgets: [], loop: noLoop, requestCost: 0, agentPaused: true });
    expect(d.decision).toBe('stop-agent');
    expect(d.blocked).toBe(true);
  });

  it('data-driven policy fires (requestCost threshold -> require-approval)', async () => {
    const { org, agent, chain } = await makeOrgScope();
    const b = await prisma.budget.create({
      data: { organizationId: org.id, name: 'cap', level: 'AGENT', scopeId: agent.id, hardLimit: 100000, resetPeriod: 'NEVER', fallbackBehavior: 'BLOCK' },
    });
    await prisma.budgetPolicy.create({
      data: { budgetId: b.id, name: 'approve expensive', condition: 'requestCost>=0.5', action: 'REQUIRE_APPROVAL', priority: 9 },
    });
    const d = await evaluatePolicies({ chain, budgets: await resolveBudgets(chain, 1000, 0.6), loop: noLoop, requestCost: 0.6 });
    expect(d.decision).toBe('require-approval');
  });
});
