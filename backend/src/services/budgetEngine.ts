import { prisma } from '../db.js';
import { config } from '../config.js';
import type { BudgetLevel, ScopeChain } from '../types.js';
import { expireStaleReservations } from './accounting.js';

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

/** Build the where-filter that maps a budget's (level, scopeId) onto usage rows. */
function scopeFilter(level: string, scopeId: string | null, chain: ScopeChain) {
  switch (level) {
    case 'ORGANIZATION':
      return { organizationId: chain.organizationId };
    case 'PROJECT':
      return { projectId: scopeId ?? chain.projectId ?? '__none__' };
    case 'AGENT':
      return { agentId: scopeId ?? chain.agentId ?? '__none__' };
    case 'SESSION':
      return { sessionId: scopeId ?? chain.sessionId ?? '__none__' };
    case 'TASK':
      return { taskId: scopeId ?? chain.taskId ?? '__none__' };
    case 'USER':
    case 'TOOL_CALL':
    case 'REQUEST':
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
  const where: Record<string, unknown> = {
    organizationId: chain.organizationId,
    ...scopeFilter(level, scopeId, chain),
  };
  if (windowStart) where.createdAt = { gte: windowStart };
  const agg = await prisma.tokenUsage.aggregate({
    where,
    _sum: { totalTokens: true, costUsd: true },
  });
  return metric === 'COST_USD' ? agg._sum.costUsd ?? 0 : agg._sum.totalTokens ?? 0;
}

async function computeReserved(
  level: string,
  scopeId: string | null,
  chain: ScopeChain,
  metric: string
): Promise<number> {
  const cutoff = new Date(Date.now() - config.reservationTtlMs);
  const where: Record<string, unknown> = {
    organizationId: chain.organizationId,
    status: 'reserved',
    createdAt: { gte: cutoff },
    ...scopeFilter(level, scopeId, chain),
  };
  const agg = await prisma.llmRequest.aggregate({
    where,
    _sum: { reservedTokens: true, estimatedCostUsd: true },
  });
  return metric === 'COST_USD' ? agg._sum.estimatedCostUsd ?? 0 : agg._sum.reservedTokens ?? 0;
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
  await expireStaleReservations();
  const budgets = await prisma.budget.findMany({
    where: { organizationId: chain.organizationId, active: true },
  });

  const statuses: BudgetStatus[] = [];
  for (const b of budgets) {
    if (!budgetApplies(b.level, b.scopeId, chain)) continue;
    const windowStart = resetWindowStart(b.resetPeriod);
    const used = await computeUsed(b.level, b.scopeId, chain, b.metric, windowStart);
    const reserved = await computeReserved(b.level, b.scopeId, chain, b.metric);
    const projectedAmount = b.metric === 'COST_USD' ? projectedCost : projectedTokens;
    const projected = used + reserved + projectedAmount;
    const utilization = b.hardLimit > 0 ? projected / b.hardLimit : 0;
    statuses.push({
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
      utilization,
      exceedsHard: projected > b.hardLimit,
      exceedsSoft: b.softLimit != null && projected > b.softLimit,
      atWarning: projected > b.warningThreshold * b.hardLimit,
    });
  }
  return statuses;
}
