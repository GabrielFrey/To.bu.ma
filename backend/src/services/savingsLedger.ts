import { prisma } from '../db.js';
import { estimateCost } from '../pricing.js';

export interface SavingsByDecision {
  decision: string;
  count: number;
  savedUsd: number;
  savedTokens: number;
}

export interface SavingsLedgerResult {
  totalSavedUsd: number;
  totalSavedTokens: number;
  blockedRequests: number;
  optimizedRequests: number;
  byDecision: SavingsByDecision[];
  /** Top policy reasons driving savings (from policy_events). */
  topReasons: { reason: string; savedUsd: number; count: number }[];
  note: string;
}

const BLOCKING = new Set(['stop-agent', 'retry-limit', 'tool-limit', 'require-approval']);
const OPTIMIZING = new Set(['degrade', 'compress', 'summarize', 'truncate']);

/**
 * Counterfactual savings: what would have been spent without TBM enforcement/optimization.
 * Computed on read from llm_requests + token_usage + policy_events.
 */
export async function computeSavingsLedger(organizationId: string): Promise<SavingsLedgerResult> {
  const requests = await prisma.llmRequest.findMany({
    where: { organizationId },
    include: { usage: true },
  });

  const byDecisionMap = new Map<string, SavingsByDecision>();
  const reasonMap = new Map<string, { savedUsd: number; count: number }>();
  let totalSavedUsd = 0;
  let totalSavedTokens = 0;
  let blockedRequests = 0;
  let optimizedRequests = 0;

  for (const req of requests) {
    const decision = req.decision ?? 'allow';
    if (decision === 'allow' || decision === 'warn') continue;

    let savedUsd = 0;
    let savedTokens = 0;

    if (BLOCKING.has(decision) && req.status === 'blocked') {
      savedUsd = req.estimatedCostUsd;
      savedTokens = req.reservedTokens;
      blockedRequests++;
    } else if (OPTIMIZING.has(decision) && req.usage) {
      // Counterfactual: full reserved estimate vs actual recorded cost.
      savedUsd = Math.max(0, req.estimatedCostUsd - req.usage.costUsd);
      savedTokens = Math.max(0, req.reservedTokens - req.usage.totalTokens);
      optimizedRequests++;
    } else if (OPTIMIZING.has(decision) && !req.usage) {
      // Completed with optimization but estimate heuristic: ~20% token reduction typical.
      savedUsd = req.estimatedCostUsd * 0.2;
      savedTokens = Math.round(req.reservedTokens * 0.2);
      optimizedRequests++;
    } else if (decision === 'degrade' && req.usage) {
      // Try pricing delta if model changed vs a premium default in estimate.
      const baseline = await estimateCost(
        req.model.includes('mini') ? req.model.replace('-mini', '') : req.model,
        req.promptTokens,
        req.expectedCompletionTokens,
        organizationId
      );
      savedUsd = Math.max(0, baseline - req.usage.costUsd);
      savedTokens = 0;
      optimizedRequests++;
    }

    if (savedUsd <= 0 && savedTokens <= 0) continue;

    totalSavedUsd += savedUsd;
    totalSavedTokens += savedTokens;

    const row = byDecisionMap.get(decision) ?? { decision, count: 0, savedUsd: 0, savedTokens: 0 };
    row.count++;
    row.savedUsd += savedUsd;
    row.savedTokens += savedTokens;
    byDecisionMap.set(decision, row);

    const reasonKey = `${decision}: ${req.status}`;
    const rr = reasonMap.get(reasonKey) ?? { savedUsd: 0, count: 0 };
    rr.savedUsd += savedUsd;
    rr.count++;
    reasonMap.set(reasonKey, rr);
  }

  // Enrich with policy_event reasons for blocked traffic.
  const events = await prisma.policyEvent.findMany({
    where: { organizationId, decision: { in: [...BLOCKING, ...OPTIMIZING] } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  for (const ev of events) {
    const req = requests.find((r) => r.id === ev.requestId);
    const saved = req?.status === 'blocked' ? req.estimatedCostUsd : 0;
    if (saved <= 0) continue;
    const rr = reasonMap.get(ev.reason) ?? { savedUsd: 0, count: 0 };
    rr.savedUsd += saved;
    rr.count++;
    reasonMap.set(ev.reason, rr);
  }

  const byDecision = [...byDecisionMap.values()]
    .map((r) => ({
      ...r,
      savedUsd: Number(r.savedUsd.toFixed(6)),
      savedTokens: r.savedTokens,
    }))
    .sort((a, b) => b.savedUsd - a.savedUsd);

  const topReasons = [...reasonMap.entries()]
    .map(([reason, v]) => ({ reason, savedUsd: Number(v.savedUsd.toFixed(6)), count: v.count }))
    .sort((a, b) => b.savedUsd - a.savedUsd)
    .slice(0, 10);

  return {
    totalSavedUsd: Number(totalSavedUsd.toFixed(6)),
    totalSavedTokens,
    blockedRequests,
    optimizedRequests,
    byDecision,
    topReasons,
    note: 'Estimated counterfactual savings vs baseline (no TBM action). Blocked = full estimate; optimize = estimate minus actual.',
  };
}

/** Cost-per-resolved-task: spend divided by completed tasks (agent economics KPI). */
export async function costPerResolvedTask(organizationId: string) {
  const done = await prisma.task.count({ where: { session: { agent: { project: { organizationId } } }, status: 'done' } });
  const total = await prisma.tokenUsage.aggregate({
    where: { organizationId },
    _sum: { costUsd: true, totalTokens: true },
  });
  const cost = total._sum.costUsd ?? 0;
  return {
    completedTasks: done,
    totalCostUsd: Number(cost.toFixed(6)),
    costPerTaskUsd: done > 0 ? Number((cost / done).toFixed(6)) : null,
    totalTokens: total._sum.totalTokens ?? 0,
  };
}
