import { estimateCost } from '../pricing.js';
import { resolveBudgets, type BudgetStatus } from './budgetEngine.js';
import type { ScopeChain } from '../types.js';

export interface RunForecastInput {
  chain: ScopeChain;
  model: string;
  /** Expected LLM calls in the agent run (planning + tool + synthesis). */
  estimatedSteps: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  /** Optional tool-call tokens per step (embedded search, APIs, etc.). */
  toolCallsPerStep?: number;
  avgToolTokens?: number;
}

export interface RunForecastResult {
  projectedRunTokens: number;
  projectedRunCostUsd: number;
  perStepTokens: number;
  perStepCostUsd: number;
  estimatedSteps: number;
  currentUsed: { tokens: number; costUsd: number };
  remainingAtTightestBudget: { tokens: number; costUsd: number };
  willExceedHardLimit: boolean;
  /** Estimated steps before the tightest hard budget is exhausted (0 if already over). */
  stepsUntilHardLimit: number;
  limitingBudget: BudgetStatus | null;
  bindingBudgets: BudgetStatus[];
  recommendation: 'proceed' | 'reduce-steps' | 'downgrade-model' | 'abort';
  reason: string;
}

/**
 * Forecast whether a multi-step agent RUN will exceed hierarchical budgets before
 * it starts. Uses linear per-step burn from caller hints + historical utilization.
 */
export async function forecastRun(input: RunForecastInput): Promise<RunForecastResult> {
  const steps = Math.max(1, input.estimatedSteps);
  const toolPerStep = (input.toolCallsPerStep ?? 0) * (input.avgToolTokens ?? 0);
  const perStepTokens = input.avgPromptTokens + input.avgCompletionTokens + toolPerStep;
  const perStepCostUsd = await estimateCost(
    input.model,
    input.avgPromptTokens + toolPerStep,
    input.avgCompletionTokens,
    input.chain.organizationId
  );
  const projectedRunTokens = perStepTokens * steps;
  const projectedRunCostUsd = perStepCostUsd * steps;

  // Resolve budgets with zero additional reservation (current snapshot).
  const budgets = await resolveBudgets(input.chain, 0, 0);

  const bindingBudgets = budgets.filter((b) => b.exceedsHard || b.atWarning);
  let limitingBudget: BudgetStatus | null = null;
  let willExceed = false;
  let stepsUntilHardLimit = steps;

  for (const b of budgets) {
    const usedPlusReserved = b.used + b.reserved;
    const remainingTokens = b.metric === 'TOKENS' ? Math.max(0, b.hardLimit - usedPlusReserved) : Infinity;
    const remainingCost = b.metric === 'COST_USD' ? Math.max(0, b.hardLimit - usedPlusReserved) : Infinity;

    const stepsByTokens =
      b.metric === 'TOKENS' && perStepTokens > 0 ? Math.floor(remainingTokens / perStepTokens) : steps;
    const stepsByCost =
      b.metric === 'COST_USD' && perStepCostUsd > 0 ? Math.floor(remainingCost / perStepCostUsd) : steps;
    const stepsForBudget = Math.min(stepsByTokens, stepsByCost);

    const projected = b.metric === 'COST_USD' ? usedPlusReserved + projectedRunCostUsd : usedPlusReserved + projectedRunTokens;
    if (projected > b.hardLimit) {
      willExceed = true;
      if (stepsForBudget < stepsUntilHardLimit) {
        stepsUntilHardLimit = stepsForBudget;
        limitingBudget = b;
      }
    }
  }

  if (!limitingBudget && willExceed) {
    limitingBudget = budgets.find((b) => b.exceedsHard) ?? budgets[0] ?? null;
  }

  // Tightest remaining across token and cost budgets.
  let remTokens = Infinity;
  let remCost = Infinity;
  let usedTokens = 0;
  let usedCost = 0;
  for (const b of budgets) {
    const u = b.used + b.reserved;
    if (b.metric === 'TOKENS') {
      usedTokens = Math.max(usedTokens, u);
      remTokens = Math.min(remTokens, Math.max(0, b.hardLimit - u));
    } else {
      usedCost = Math.max(usedCost, u);
      remCost = Math.min(remCost, Math.max(0, b.hardLimit - u));
    }
  }

  let recommendation: RunForecastResult['recommendation'] = 'proceed';
  let reason = 'Run fits within all applicable budgets.';
  if (willExceed) {
    if (stepsUntilHardLimit <= 0) {
      recommendation = 'abort';
      reason = limitingBudget
        ? `Budget "${limitingBudget.name}" (${limitingBudget.level}) is already at or over its hard limit.`
        : 'A hard budget is already exhausted.';
    } else if (stepsUntilHardLimit < steps * 0.5) {
      recommendation = 'reduce-steps';
      reason = `Projected ${steps} steps but only ~${stepsUntilHardLimit} fit before "${limitingBudget?.name ?? 'budget'}" hard limit.`;
    } else {
      recommendation = 'downgrade-model';
      reason = `Run may exceed "${limitingBudget?.name ?? 'budget'}" — consider a cheaper model or fewer steps.`;
    }
  }

  return {
    projectedRunTokens,
    projectedRunCostUsd: Number(projectedRunCostUsd.toFixed(6)),
    perStepTokens,
    perStepCostUsd: Number(perStepCostUsd.toFixed(6)),
    estimatedSteps: steps,
    currentUsed: { tokens: usedTokens, costUsd: Number(usedCost.toFixed(6)) },
    remainingAtTightestBudget: {
      tokens: remTokens === Infinity ? 0 : remTokens,
      costUsd: remCost === Infinity ? 0 : Number(remCost.toFixed(6)),
    },
    willExceedHardLimit: willExceed,
    stepsUntilHardLimit: Math.max(0, stepsUntilHardLimit),
    limitingBudget,
    bindingBudgets,
    recommendation,
    reason,
  };
}
