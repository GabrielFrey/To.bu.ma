import { prisma } from '../db.js';
import { resolveBudgets } from './budgetEngine.js';
import { detectLoopSignals } from './loopDetection.js';
import { evaluatePolicies } from './policyEngine.js';
import { config } from '../config.js';
import type { ScopeChain } from '../types.js';

export interface HypotheticalPolicy {
  name: string;
  condition: string;
  action: string;
  priority?: number;
  params?: Record<string, unknown>;
}

export interface SimulationInput {
  organizationId: string;
  budgetId?: string;
  hypotheticalPolicies: HypotheticalPolicy[];
  lookbackHours?: number;
  sampleLimit?: number;
}

export interface SimulationExample {
  requestId: string;
  model: string;
  actualDecision: string | null;
  simulatedDecision: string;
  wouldChange: boolean;
  estimatedCostUsd: number;
}

export interface SimulationResult {
  sampleSize: number;
  wouldAllow: number;
  wouldWarn: number;
  wouldDegrade: number;
  wouldBlock: number;
  projectedSavingsUsd: number;
  examples: SimulationExample[];
  note: string;
}

const BLOCKING = new Set(['stop-agent', 'retry-limit', 'tool-limit', 'require-approval', 'truncate']);

/**
 * Dry-run hypothetical policies against historical traffic without persisting.
 * Replays stored request context through evaluatePolicies with merged policies.
 */
export async function simulatePolicies(input: SimulationInput): Promise<SimulationResult> {
  const lookback = input.lookbackHours ?? 168;
  const limit = input.sampleLimit ?? 500;
  const since = new Date(Date.now() - lookback * 3600_000);

  const requests = await prisma.llmRequest.findMany({
    where: { organizationId: input.organizationId, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  let wouldAllow = 0;
  let wouldWarn = 0;
  let wouldDegrade = 0;
  let wouldBlock = 0;
  let projectedSavingsUsd = 0;
  const examples: SimulationExample[] = [];

  for (const req of requests) {
    const chain: ScopeChain = {
      organizationId: req.organizationId,
      projectId: req.projectId,
      userId: req.userId,
      agentId: req.agentId,
      sessionId: req.sessionId,
      taskId: req.taskId,
    };

    const budgets = await resolveBudgets(chain, req.reservedTokens, req.estimatedCostUsd);
    const loop = await detectLoopSignals({
      sessionId: req.sessionId,
      taskId: req.taskId,
      signature: req.signature ?? '',
      loopThreshold: config.loopThreshold,
      retryThreshold: config.retryThreshold,
    });

    // Inject hypothetical policies as if attached to the first applicable budget.
    const targetBudgetId = input.budgetId ?? budgets[0]?.budgetId;
    if (targetBudgetId && input.hypotheticalPolicies.length > 0) {
      // Temporarily create in-memory evaluation by attaching synthetic policies via evaluatePolicies
      // after merging with DB policies — we pass custom conditions through loop/cost signals.
      for (const hp of input.hypotheticalPolicies) {
        if (hp.condition.trim().toLowerCase() === 'loop' && loop.isLoop) {
          // Synthetic match handled below via evaluatePolicies + manual override check
        }
      }
    }

    const policy = await evaluatePolicies({
      chain,
      budgets,
      loop,
      requestCost: req.estimatedCostUsd,
      persist: false,
    });

    // Re-evaluate with hypothetical policies overlaid (strongest wins).
    let simulatedDecision = policy.decision;
    let simulatedBlocked = policy.blocked;
    for (const hp of input.hypotheticalPolicies) {
      const cond = hp.condition.trim().toLowerCase();
      let matches = false;
      if (cond === 'loop') matches = loop.isLoop;
      else if (cond.startsWith('utilization')) {
        const m = cond.match(/utilization\s*(>=|>)\s*([\d.]+)/);
        if (m) {
          const util = budgets[0]?.utilization ?? 0;
          matches = m[1] === '>=' ? util >= Number(m[2]) : util > Number(m[2]);
        }
      } else if (cond.startsWith('requestcost')) {
        const m = cond.match(/requestcost\s*(>=|>)\s*([\d.]+)/);
        if (m) matches = req.estimatedCostUsd >= Number(m[2]);
      }

      if (matches) {
        const action = hp.action.toLowerCase().replace(/_/g, '-');
        simulatedDecision = action as typeof simulatedDecision;
        simulatedBlocked = BLOCKING.has(action);
      }
    }

    const actual = req.decision ?? 'allow';
    const wouldChange = actual !== simulatedDecision;

    if (simulatedBlocked) {
      wouldBlock++;
      projectedSavingsUsd += req.estimatedCostUsd;
    } else if (['degrade', 'compress', 'summarize'].includes(simulatedDecision)) {
      wouldDegrade++;
    } else if (simulatedDecision === 'warn') {
      wouldWarn++;
    } else {
      wouldAllow++;
    }

    if (wouldChange && examples.length < 5) {
      examples.push({
        requestId: req.id,
        model: req.model,
        actualDecision: actual,
        simulatedDecision,
        wouldChange: true,
        estimatedCostUsd: req.estimatedCostUsd,
      });
    }
  }

  return {
    sampleSize: requests.length,
    wouldAllow,
    wouldWarn,
    wouldDegrade,
    wouldBlock,
    projectedSavingsUsd: Number(projectedSavingsUsd.toFixed(6)),
    examples,
    note: 'Simulation replays historical requests; does not persist policy_events or modify budgets.',
  };
}
