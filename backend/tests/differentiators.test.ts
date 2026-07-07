import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { resetDb, makeOrgScope } from './helpers.js';
import { forecastRun } from '../src/services/runForecast.js';
import { computeSavingsLedger } from '../src/services/savingsLedger.js';
import { simulatePolicies } from '../src/services/policySimulation.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('Run-level forecast', () => {
  it('predicts overflow when projected run exceeds task budget', async () => {
    const { org, chain, task } = await makeOrgScope();
    await prisma.budget.create({
      data: {
        organizationId: org.id,
        name: 'task cap',
        level: 'TASK',
        scopeId: task.id,
        metric: 'TOKENS',
        hardLimit: 5000,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });

    const result = await forecastRun({
      chain,
      model: 'gpt-4o-mini',
      estimatedSteps: 20,
      avgPromptTokens: 400,
      avgCompletionTokens: 150,
    });

    expect(result.projectedRunTokens).toBe(20 * 550);
    expect(result.willExceedHardLimit).toBe(true);
    expect(result.stepsUntilHardLimit).toBeLessThan(20);
    expect(result.limitingBudget?.level).toBe('TASK');
    expect(['reduce-steps', 'downgrade-model', 'abort']).toContain(result.recommendation);
  });

  it('recommends proceed when run fits budget', async () => {
    const { org, chain, task } = await makeOrgScope();
    await prisma.budget.create({
      data: {
        organizationId: org.id,
        name: 'task cap',
        level: 'TASK',
        scopeId: task.id,
        metric: 'TOKENS',
        hardLimit: 1_000_000,
        resetPeriod: 'NEVER',
        fallbackBehavior: 'BLOCK',
      },
    });

    const result = await forecastRun({
      chain,
      model: 'gpt-4o-mini',
      estimatedSteps: 5,
      avgPromptTokens: 100,
      avgCompletionTokens: 50,
    });

    expect(result.willExceedHardLimit).toBe(false);
    expect(result.recommendation).toBe('proceed');
  });
});

describe('Savings ledger', () => {
  it('counts counterfactual savings for blocked requests', async () => {
    const { org, chain, agent } = await makeOrgScope();
    await prisma.llmRequest.create({
      data: {
        organizationId: org.id,
        agentId: agent.id,
        model: 'gpt-4o-mini',
        status: 'blocked',
        decision: 'stop-agent',
        reservedTokens: 800,
        estimatedCostUsd: 0.05,
        promptTokens: 500,
        expectedCompletionTokens: 100,
      },
    });

    const ledger = await computeSavingsLedger(org.id);
    expect(ledger.blockedRequests).toBe(1);
    expect(ledger.totalSavedUsd).toBeGreaterThan(0);
    expect(ledger.byDecision.some((d) => d.decision === 'stop-agent')).toBe(true);
  });
});

describe('Policy simulation', () => {
  it('dry-runs loop policy against historical traffic without persisting', async () => {
    const { org, chain, agent, session } = await makeOrgScope();
    const sig = 'abc123';
    for (let i = 0; i < 4; i++) {
      await prisma.llmRequest.create({
        data: {
          organizationId: org.id,
          agentId: agent.id,
          sessionId: session.id,
          model: 'gpt-4o-mini',
          status: 'completed',
          signature: sig,
          decision: 'allow',
          reservedTokens: 100,
          estimatedCostUsd: 0.001,
        },
      });
    }

    const beforeEvents = await prisma.policyEvent.count();
    const sim = await simulatePolicies({
      organizationId: org.id,
      hypotheticalPolicies: [{ name: 'loop stop', condition: 'loop', action: 'STOP_AGENT' }],
      lookbackHours: 24,
    });
    const afterEvents = await prisma.policyEvent.count();

    expect(sim.sampleSize).toBe(4);
    expect(afterEvents).toBe(beforeEvents); // no persistence
    expect(sim.wouldBlock).toBeGreaterThanOrEqual(0);
  });
});
