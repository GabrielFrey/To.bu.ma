import { prisma } from '../db.js';
import { config } from '../config.js';

export async function totalSpend(organizationId: string) {
  const agg = await prisma.tokenUsage.aggregate({
    where: { organizationId },
    _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedTokens: true, toolTokens: true, costUsd: true },
    _count: true,
  });
  return {
    totalTokens: agg._sum.totalTokens ?? 0,
    inputTokens: agg._sum.inputTokens ?? 0,
    outputTokens: agg._sum.outputTokens ?? 0,
    cachedTokens: agg._sum.cachedTokens ?? 0,
    toolTokens: agg._sum.toolTokens ?? 0,
    costUsd: Number((agg._sum.costUsd ?? 0).toFixed(6)),
    requests: agg._count,
  };
}

export async function spendByAgent(organizationId: string) {
  const rows = await prisma.tokenUsage.groupBy({
    by: ['agentId'],
    where: { organizationId },
    _sum: { totalTokens: true, costUsd: true },
    _count: true,
  });
  const agents = await prisma.agent.findMany({
    where: { id: { in: rows.map((r) => r.agentId).filter(Boolean) as string[] } },
  });
  const nameById = new Map(agents.map((a) => [a.id, a.name]));
  return rows.map((r) => ({
    agentId: r.agentId,
    agentName: r.agentId ? nameById.get(r.agentId) ?? r.agentId : '(none)',
    totalTokens: r._sum.totalTokens ?? 0,
    costUsd: Number((r._sum.costUsd ?? 0).toFixed(6)),
    requests: r._count,
  }));
}

export async function spendByTask(organizationId: string) {
  const rows = await prisma.tokenUsage.groupBy({
    by: ['taskId'],
    where: { organizationId },
    _sum: { totalTokens: true, costUsd: true },
    _count: true,
  });
  const tasks = await prisma.task.findMany({
    where: { id: { in: rows.map((r) => r.taskId).filter(Boolean) as string[] } },
  });
  const nameById = new Map(tasks.map((t) => [t.id, t.name ?? t.id]));
  return rows.map((r) => ({
    taskId: r.taskId,
    taskName: r.taskId ? nameById.get(r.taskId) ?? r.taskId : '(none)',
    totalTokens: r._sum.totalTokens ?? 0,
    costUsd: Number((r._sum.costUsd ?? 0).toFixed(6)),
    requests: r._count,
  }));
}

export async function spendByProject(organizationId: string) {
  const rows = await prisma.tokenUsage.groupBy({
    by: ['projectId'],
    where: { organizationId },
    _sum: { totalTokens: true, costUsd: true },
    _count: true,
  });
  const projects = await prisma.project.findMany({
    where: { id: { in: rows.map((r) => r.projectId).filter(Boolean) as string[] } },
  });
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    projectId: r.projectId,
    projectName: r.projectId ? nameById.get(r.projectId) ?? r.projectId : '(none)',
    totalTokens: r._sum.totalTokens ?? 0,
    costUsd: Number((r._sum.costUsd ?? 0).toFixed(6)),
    requests: r._count,
  }));
}

export async function activeBudgets(organizationId: string) {
  const budgets = await prisma.budget.findMany({ where: { organizationId, active: true } });
  const { resolveBudgets } = await import('./budgetEngine.js');
  // Report each budget's current utilization (no additional projected amount).
  const out = [];
  for (const b of budgets) {
    const statuses = await resolveBudgets(
      {
        organizationId,
        projectId: b.level === 'PROJECT' ? b.scopeId : undefined,
        agentId: b.level === 'AGENT' ? b.scopeId : undefined,
        sessionId: b.level === 'SESSION' ? b.scopeId : undefined,
        taskId: b.level === 'TASK' ? b.scopeId : undefined,
      },
      0,
      0
    );
    const s = statuses.find((x) => x.budgetId === b.id);
    if (s) out.push(s);
  }
  return out;
}

export async function warnings(organizationId: string) {
  return prisma.policyEvent.findMany({
    where: { organizationId, decision: { in: ['warn', 'degrade', 'compress', 'summarize'] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function blockedRequests(organizationId: string) {
  return prisma.policyEvent.findMany({
    where: { organizationId, decision: { in: ['stop-agent', 'require-approval', 'retry-limit', 'tool-limit', 'truncate'] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function expensivePrompts(organizationId: string) {
  const rows = await prisma.tokenUsage.findMany({
    where: { organizationId },
    orderBy: { costUsd: 'desc' },
    take: 10,
  });
  return rows.map((r) => ({
    requestId: r.requestId,
    model: r.model,
    totalTokens: r.totalTokens,
    costUsd: r.costUsd,
    agentId: r.agentId,
    taskId: r.taskId,
  }));
}

/** Inefficient loops: signatures repeated within a session above threshold. */
export async function inefficientLoops(organizationId: string) {
  const grouped = await prisma.llmRequest.groupBy({
    by: ['sessionId', 'signature'],
    where: { organizationId, signature: { not: null }, sessionId: { not: null } },
    _count: true,
    having: { signature: { _count: { gte: config.loopThreshold } } },
  });
  return grouped
    .map((g) => ({ sessionId: g.sessionId, signature: g.signature, repeats: g._count }))
    .sort((a, b) => b.repeats - a.repeats);
}

/** Simple heuristic optimization recommendations. */
export async function recommendations(organizationId: string) {
  const recs: { type: string; message: string; severity: 'info' | 'warn' }[] = [];

  const loops = await inefficientLoops(organizationId);
  if (loops.length > 0) {
    recs.push({
      type: 'loop',
      message: `${loops.length} repeated request loop(s) detected — enable stop-agent policy or add progress checks.`,
      severity: 'warn',
    });
  }

  const failed = await prisma.llmRequest.count({ where: { organizationId, status: 'failed' } });
  if (failed > 0) {
    recs.push({
      type: 'retries',
      message: `${failed} failed request(s) — consider a retry-limit policy to cap wasted spend.`,
      severity: 'warn',
    });
  }

  const cached = await prisma.tokenUsage.aggregate({ where: { organizationId }, _sum: { cachedTokens: true, inputTokens: true } });
  const cachedTok = cached._sum.cachedTokens ?? 0;
  const inputTok = cached._sum.inputTokens ?? 0;
  if (inputTok > 0 && cachedTok / inputTok < 0.1) {
    recs.push({
      type: 'caching',
      message: 'Low cached-token ratio — reuse a stable system prompt prefix to benefit from prompt caching.',
      severity: 'info',
    });
  }

  const byModel = await prisma.tokenUsage.groupBy({
    by: ['model'],
    where: { organizationId },
    _sum: { costUsd: true },
  });
  const topModel = byModel.sort((a, b) => (b._sum.costUsd ?? 0) - (a._sum.costUsd ?? 0))[0];
  if (topModel && (topModel._sum.costUsd ?? 0) > 0) {
    recs.push({
      type: 'model-routing',
      message: `Most spend is on "${topModel.model}" — route simple calls to a cheaper model via chooseModel().`,
      severity: 'info',
    });
  }

  return recs;
}
