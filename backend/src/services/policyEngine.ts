import { prisma } from '../db.js';
import {
  BLOCKING_DECISIONS,
  DECISION_STRENGTH,
  type Decision,
  type ScopeChain,
} from '../types.js';
import type { BudgetStatus } from './budgetEngine.js';
import type { LoopSignals } from './loopDetection.js';

export interface PolicyDecision {
  decision: Decision;
  blocked: boolean;
  reason: string;
  /** Contributing budget (if any) that drove the decision. */
  budgetId?: string;
  utilization?: number;
  /** Optional model downgrade / truncation hints for the caller. */
  params?: Record<string, unknown>;
}

export function fallbackToDecision(fallback: string): Decision {
  switch (fallback) {
    case 'DEGRADE':
      return 'degrade';
    case 'SUMMARIZE':
      return 'summarize';
    case 'REQUIRE_APPROVAL':
      return 'require-approval';
    case 'STOP_AGENT':
      return 'stop-agent';
    case 'BLOCK':
    default:
      return 'stop-agent'; // BLOCK maps to a blocking decision the gateway refuses
  }
}

function stronger(a: PolicyDecision, b: PolicyDecision): PolicyDecision {
  return DECISION_STRENGTH[b.decision] > DECISION_STRENGTH[a.decision] ? b : a;
}

export interface ConditionContext {
  utilization: number;
  loop: LoopSignals;
  toolCalls: number;
  requestCost: number;
}

/**
 * Evaluate a data-driven condition string against the runtime signals. Exported
 * so policy *simulation* uses the identical matcher as enforcement — a dry-run
 * that disagrees with production is worse than no dry-run.
 */
export function conditionMatches(condition: string, ctx: ConditionContext): boolean {
  const c = condition.trim().toLowerCase();
  if (c === 'loop') return ctx.loop.isLoop;
  const m = c.match(/^(utilization|retries|toolcalls|requestcost)\s*(>=|>|<=|<)\s*([\d.]+)$/);
  if (!m) return false;
  const [, key, op, valStr] = m;
  const val = Number(valStr);
  const lhs =
    key === 'utilization'
      ? ctx.utilization
      : key === 'retries'
        ? ctx.loop.failedAttempts
        : key === 'toolcalls'
          ? ctx.toolCalls
          : ctx.requestCost;
  switch (op) {
    case '>=':
      return lhs >= val;
    case '>':
      return lhs > val;
    case '<=':
      return lhs <= val;
    case '<':
      return lhs < val;
    default:
      return false;
  }
}

const ACTION_TO_DECISION: Record<string, Decision> = {
  ALLOW: 'allow',
  WARN: 'warn',
  DEGRADE: 'degrade',
  COMPRESS: 'compress',
  SUMMARIZE: 'summarize',
  TRUNCATE: 'truncate',
  REQUIRE_APPROVAL: 'require-approval',
  STOP_AGENT: 'stop-agent',
  RETRY_LIMIT: 'retry-limit',
  TOOL_LIMIT: 'tool-limit',
};

/**
 * Compute the effective decision (most-restrictive-wins) from budget statuses,
 * custom policies, and loop/retry signals. Persists a policy_event when the
 * decision is not a plain allow.
 */
export async function evaluatePolicies(params: {
  chain: ScopeChain;
  budgets: BudgetStatus[];
  loop: LoopSignals;
  toolCalls?: number;
  requestCost: number;
  agentPaused?: boolean;
  requestId?: string;
  persist?: boolean;
}): Promise<PolicyDecision> {
  const { chain, budgets, loop, requestCost, agentPaused } = params;
  const toolCalls = params.toolCalls ?? 0;

  let effective: PolicyDecision = { decision: 'allow', blocked: false, reason: 'within budget' };

  // 0. Paused agent short-circuits everything.
  if (agentPaused) {
    effective = { decision: 'stop-agent', blocked: true, reason: 'agent is paused' };
  }

  // 1. Hard-limit budgets → blocking via their fallback behavior (most-restrictive-wins).
  for (const b of budgets) {
    if (b.exceedsHard) {
      const dec = fallbackToDecision(b.fallbackBehavior);
      const cand: PolicyDecision = {
        decision: dec,
        blocked: BLOCKING_DECISIONS.has(dec),
        reason: `hard limit reached on "${b.name}" (${b.level})`,
        budgetId: b.budgetId,
        utilization: b.utilization,
      };
      effective = stronger(effective, cand);
    } else if (b.exceedsSoft) {
      effective = stronger(effective, {
        decision: 'degrade',
        blocked: false,
        reason: `soft limit exceeded on "${b.name}"`,
        budgetId: b.budgetId,
        utilization: b.utilization,
      });
    } else if (b.atWarning) {
      effective = stronger(effective, {
        decision: 'warn',
        blocked: false,
        reason: `warning threshold crossed on "${b.name}"`,
        budgetId: b.budgetId,
        utilization: b.utilization,
      });
    }
  }

  // 2. Custom data-driven policies attached to applicable budgets.
  const budgetIds = budgets.map((b) => b.budgetId);
  if (budgetIds.length > 0) {
    const policies = await prisma.budgetPolicy.findMany({
      where: { budgetId: { in: budgetIds }, active: true },
      orderBy: { priority: 'desc' },
    });
    for (const p of policies) {
      const bs = budgets.find((b) => b.budgetId === p.budgetId);
      const utilization = bs?.utilization ?? 0;
      if (conditionMatches(p.condition, { utilization, loop, toolCalls, requestCost })) {
        const dec = ACTION_TO_DECISION[p.action] ?? 'warn';
        effective = stronger(effective, {
          decision: dec,
          blocked: BLOCKING_DECISIONS.has(dec),
          reason: `policy "${p.name}" matched (${p.condition})`,
          budgetId: p.budgetId,
          utilization,
          params: p.params ? safeJson(p.params) : undefined,
        });
      }
    }
  }

  // 3. Built-in loop / repeated-failure guards (fire even without explicit policies).
  if (loop.isLoop) {
    effective = stronger(effective, {
      decision: 'stop-agent',
      blocked: true,
      reason: `useless loop detected (${loop.signatureRepeats} identical requests)`,
    });
  }
  if (loop.isRepeatedFailure) {
    effective = stronger(effective, {
      decision: 'retry-limit',
      blocked: true,
      reason: `repeated failed attempts (${loop.failedAttempts})`,
    });
  }

  if (params.persist && effective.decision !== 'allow') {
    await prisma.policyEvent.create({
      data: {
        organizationId: chain.organizationId,
        budgetId: effective.budgetId,
        requestId: params.requestId,
        agentId: chain.agentId ?? undefined,
        taskId: chain.taskId ?? undefined,
        decision: effective.decision,
        reason: effective.reason,
        utilization: effective.utilization,
      },
    });
  }

  return effective;
}

function safeJson(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
