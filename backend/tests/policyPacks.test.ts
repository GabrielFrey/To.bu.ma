import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { resetDb, makeOrgScope } from './helpers.js';
import { resetWindowStart } from '../src/services/budgetEngine.js';
import { fallbackToDecision } from '../src/services/policyEngine.js';
import {
  BUILTIN_PACKS,
  getBuiltinPack,
  importPolicyPack,
  parsePolicyPack,
} from '../src/services/policyPacks.js';
import { checkBudget } from '../src/services/gateway.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('resetWindowStart', () => {
  const at = (iso: string) => new Date(iso);

  it('returns null for NEVER so the window is all of history', () => {
    expect(resetWindowStart('NEVER', at('2026-03-15T13:47:11.500Z'))).toBeNull();
    expect(resetWindowStart('UNKNOWN_PERIOD', at('2026-03-15T13:47:11.500Z'))).toBeNull();
  });

  it('truncates to the start of the hour, day, week and month', () => {
    const now = at('2026-03-18T13:47:11.500Z'); // a Wednesday
    const hourly = resetWindowStart('HOURLY', now)!;
    expect(hourly.getMinutes()).toBe(0);
    expect(hourly.getSeconds()).toBe(0);
    expect(hourly.getMilliseconds()).toBe(0);
    expect(hourly.getHours()).toBe(now.getHours());

    const daily = resetWindowStart('DAILY', now)!;
    expect(daily.getHours()).toBe(0);
    expect(daily.getMinutes()).toBe(0);
    expect(daily.getDate()).toBe(now.getDate());

    const weekly = resetWindowStart('WEEKLY', now)!;
    expect(weekly.getDay()).toBe(0); // week starts Sunday
    expect(weekly.getHours()).toBe(0);
    expect(weekly.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(now.getTime() - weekly.getTime()).toBeLessThan(7 * 24 * 3600 * 1000);

    const monthly = resetWindowStart('MONTHLY', now)!;
    expect(monthly.getDate()).toBe(1);
    expect(monthly.getHours()).toBe(0);
    expect(monthly.getMonth()).toBe(now.getMonth());
  });

  it('never returns a window start in the future, on any day of the month', () => {
    for (const day of [1, 2, 15, 28, 31]) {
      const now = new Date(2026, 0, Math.min(day, 31), 0, 30, 0);
      for (const period of ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']) {
        const start = resetWindowStart(period, now)!;
        expect(start.getTime(), `${period} on day ${day}`).toBeLessThanOrEqual(now.getTime());
      }
    }
  });
});

describe('fallbackToDecision', () => {
  it('maps every declared behavior, and treats unknown values as a hard stop', () => {
    expect(fallbackToDecision('DEGRADE')).toBe('degrade');
    expect(fallbackToDecision('SUMMARIZE')).toBe('summarize');
    expect(fallbackToDecision('REQUIRE_APPROVAL')).toBe('require-approval');
    expect(fallbackToDecision('STOP_AGENT')).toBe('stop-agent');
    expect(fallbackToDecision('BLOCK')).toBe('stop-agent');
    // Unknown strings collapse to the most restrictive decision, which is why
    // parsePolicyPack rejects them at the boundary.
    expect(fallbackToDecision('COMPRESS')).toBe('stop-agent');
  });
});

describe('policy pack validation', () => {
  it('rejects a fallbackBehavior that would silently become a hard block', () => {
    const pack = {
      ...getBuiltinPack('support-desk-pack')!,
      budgets: [
        {
          name: 'sneaky',
          level: 'TASK' as const,
          metric: 'TOKENS' as const,
          hardLimit: 100,
          fallbackBehavior: 'COMPRESS' as never,
        },
      ],
      policies: [],
    };
    expect(() => parsePolicyPack(pack)).toThrow(/unknown fallbackBehavior/);
  });

  it('rejects unknown levels and metrics', () => {
    const base = getBuiltinPack('batch-etl-pack')!;
    expect(() =>
      parsePolicyPack({ ...base, budgets: [{ name: 'x', level: 'GALAXY', metric: 'TOKENS', hardLimit: 1 }], policies: [] })
    ).toThrow(/unknown level/);
    expect(() =>
      parsePolicyPack({ ...base, budgets: [{ name: 'x', level: 'TASK', metric: 'BANANAS', hardLimit: 1 }], policies: [] })
    ).toThrow(/unknown metric/);
  });

  it('every built-in pack declares a valid fallbackBehavior', () => {
    for (const pack of BUILTIN_PACKS) {
      expect(() => parsePolicyPack(pack), pack.id).not.toThrow();
    }
  });
});

describe('imported packs actually enforce what they describe', () => {
  it('support-desk degrades a near-limit ticket instead of hard-stopping it', async () => {
    const { org, chain, agent, task } = await makeOrgScope();
    const pack = getBuiltinPack('support-desk-pack')!;
    await importPolicyPack({
      organizationId: org.id,
      pack,
      scopeBindings: { agentId: agent.id, taskId: task.id },
    });

    const taskBudget = await prisma.budget.findFirst({
      where: { organizationId: org.id, name: 'Per-ticket task tokens' },
    });
    expect(taskBudget?.fallbackBehavior).toBe('DEGRADE');

    // Burn the per-ticket budget to just over its hard limit, then check that the
    // gateway degrades rather than blocking the customer mid-conversation.
    await prisma.tokenUsage.create({
      data: {
        requestId: (
          await prisma.llmRequest.create({
            data: { organizationId: org.id, agentId: agent.id, taskId: task.id, model: 'gpt-4o-mini', status: 'completed' },
          })
        ).id,
        organizationId: org.id,
        agentId: agent.id,
        taskId: task.id,
        model: 'gpt-4o-mini',
        inputTokens: 8100,
        totalTokens: 8100,
        costUsd: 0.01,
      },
    });

    const check = await checkBudget({
      chain,
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'the customer replied again' }],
      expectedCompletionTokens: 32,
    });
    expect(check.allowed).toBe(true);
    expect(['degrade', 'compress', 'summarize', 'warn']).toContain(check.decision);
  });
});
