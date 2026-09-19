import { prisma } from '../db.js';
import type { BudgetLevel, ScopeChain } from '../types.js';
import { getReservationStore } from './reservations.js';

export interface BudgetStatus {
  budgetId: string;
  name: string;
  level: BudgetLevel;
  metric: 'TOKENS' | 'COST_USD';
  hardLimit: number;
  softLimit: number | null;
  warningThreshold: number;
  priority: number;
  fallbackBehavior: string;
  used: number;
  reserved: number;
  /** used + reserved + this call's projected amount */
  projected: number;
  remaining: number;
  utilization: number; // projected / hardLimit
  exceedsHard: boolean;
  exceedsSoft: boolean;
  atWarning: boolean;
}

export function resetWindowStart(period: string, now = new Date()): Date | null {
  const d = new Date(now);
  switch (period) {
    case 'HOURLY':
      d.setMinutes(0, 0, 0);
      return d;
    case 'DAILY':
      d.setHours(0, 0, 0, 0);
      return d;
    case 'WEEKLY': {
      const day = d.getDay();
      d.setDate(d.getDate() - day);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case 'MONTHLY':
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d;
    case 'NEVER':
    default:
      return null;
  }
}

/**
 * REQUEST-level budgets cap a single call, so they never aggregate history:
 * `used` and `reserved` are zero and only the incoming projection is compared
 * against the limit.
 */
const PER_CALL_LEVELS: ReadonlySet<string> = new Set(['REQUEST']);

/**
 * Build the where-filter that maps a budget's (level, scopeId) onto usage rows.
 * `TokenUsage` has no `userId` column, so USER-level budgets filter through the
 * owning request. TOOL_CALL narrows the summed field rather than the row set
 * (see `usageSumField`).
 */
function scopeFilter(level: string, scopeId: string | null, chain: ScopeChain) {
  switch (level) {
    case 'PROJECT':
      return { projectId: scopeId ?? chain.projectId ?? '__none__' };
    case 'AGENT':
      return { agentId: scopeId ?? chain.agentId ?? '__none__' };
    case 'SESSION':
      return { sessionId: scopeId ?? chain.sessionId ?? '__none__' };
    case 'TASK':
      return { taskId: scopeId ?? chain.taskId ?? '__none__' };
    case 'USER':
      return { request: { userId: scopeId ?? chain.userId ?? '__none__' } };
    case 'ORGANIZATION':
    case 'TOOL_CALL':
    default:
      return { organizationId: chain.organizationId };
  }
}

/** Does this budget apply to the given scope chain? */
function budgetApplies(level: string, scopeId: string | null, chain: ScopeChain): boolean {
  switch (level) {
    case 'ORGANIZATION':
      return true; // org-wide always applies within the org
    case 'PROJECT':
      return !scopeId || scopeId === chain.projectId;
    case 'AGENT':
      return !scopeId || scopeId === chain.agentId;
    case 'SESSION':
      return !scopeId || scopeId === chain.sessionId;
    case 'TASK':
      return !scopeId || scopeId === chain.taskId;
    case 'USER':
      return !scopeId || scopeId === chain.userId;
    default:
      return true;
  }
}

async function computeUsed(
  level: string,
  scopeId: string | null,
  chain: ScopeChain,
  metric: string,
  windowStart: Date | null
): Promise<number> {
  if (PER_CALL_LEVELS.has(level)) return 0;
  const where: Record<string, unknown> = {
    organizationId: chain.organizationId,
    ...scopeFilter(level, scopeId, chain),
  };
  if (windowStart) where.createdAt = { gte: windowStart };
  const agg = await prisma.tokenUsage.aggregate({
    where,
    _sum: { totalTokens: true, toolTokens: true, costUsd: true },
  });
  if (metric === 'COST_USD') return agg._sum.costUsd ?? 0;
  // A TOOL_CALL budget caps tool-call tokens, not the whole conversation.
  if (level === 'TOOL_CALL') return agg._sum.toolTokens ?? 0;
  return agg._sum.totalTokens ?? 0;
}

/**
 * Resolve every budget that applies to the scope chain and classify each against
 * a projected additional amount (tokens or cost for the incoming call).
 */
export async function resolveBudgets(
  chain: ScopeChain,
  projectedTokens: number,
  projectedCost: number
): Promise<BudgetStatus[]> {
  const reservations = getReservationStore();
  await reservations.expireStale({ organizationId: chain.organizationId });
  const budgets = await prisma.budget.findMany({
    where: { organizationId: chain.organizationId, active: true },
  });

  const applicable = budgets.filter((b) => budgetApplies(b.level, b.scopeId, chain));
  // Two aggregates per budget: issue them concurrently rather than serially.
  return Promise.all(
    applicable.map(async (b) => {
      const windowStart = resetWindowStart(b.resetPeriod);
      const [used, reserved] = await Promise.all([
        computeUsed(b.level, b.scopeId, chain, b.metric, windowStart),
        reservations.reserved(chain, b.level, b.scopeId, b.metric as 'TOKENS' | 'COST_USD'),
      ]);
      const projectedAmount = b.metric === 'COST_USD' ? projectedCost : projectedTokens;
      const projected = used + reserved + projectedAmount;
      return {
        budgetId: b.id,
        name: b.name,
        level: b.level as BudgetLevel,
        metric: b.metric as 'TOKENS' | 'COST_USD',
        hardLimit: b.hardLimit,
        softLimit: b.softLimit,
        warningThreshold: b.warningThreshold,
        priority: b.priority,
        fallbackBehavior: b.fallbackBehavior,
        used,
        reserved,
        projected,
        remaining: Math.max(0, b.hardLimit - (used + reserved)),
        utilization: b.hardLimit > 0 ? projected / b.hardLimit : 0,
        exceedsHard: projected > b.hardLimit,
        exceedsSoft: b.softLimit != null && projected > b.softLimit,
        atWarning: projected > b.warningThreshold * b.hardLimit,
      } satisfies BudgetStatus;
    })
  );
}
