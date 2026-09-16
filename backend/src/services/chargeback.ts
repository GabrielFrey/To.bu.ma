import { prisma } from '../db.js';

export type ChargebackDimension = 'agent' | 'task' | 'project' | 'user';

export interface ChargebackRow {
  dimension: ChargebackDimension;
  id: string;
  name: string;
  totalTokens: number;
  costUsd: number;
  requests: number;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function dateWhere(from?: Date, to?: Date): { createdAt?: { gte?: Date; lte?: Date } } {
  if (!from && !to) return {};
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) createdAt.gte = from;
  if (to) createdAt.lte = to;
  return { createdAt };
}

export async function chargebackReport(
  organizationId: string,
  groupBy: ChargebackDimension,
  from?: Date,
  to?: Date
): Promise<ChargebackRow[]> {
  const where = { organizationId, ...dateWhere(from, to) };
  const usages = await prisma.tokenUsage.findMany({
    where,
    select: {
      totalTokens: true,
      costUsd: true,
      agentId: true,
      projectId: true,
      taskId: true,
      request: { select: { userId: true } },
    },
  });

  type Acc = { id: string; tokens: number; cost: number; requests: number };
  const buckets = new Map<string, Acc>();
  const bump = (id: string, tokens: number, cost: number) => {
    const cur = buckets.get(id) ?? { id, tokens: 0, cost: 0, requests: 0 };
    cur.tokens += tokens;
    cur.cost += cost;
    cur.requests += 1;
    buckets.set(id, cur);
  };

  for (const u of usages) {
    const id =
      groupBy === 'agent'
        ? u.agentId ?? ''
        : groupBy === 'task'
          ? u.taskId ?? ''
          : groupBy === 'project'
            ? u.projectId ?? ''
            : u.request.userId ?? '';
    bump(id, u.totalTokens, u.costUsd);
  }

  const ids = [...buckets.keys()].filter(Boolean);
  const nameById = new Map<string, string>();
  if (groupBy === 'agent' && ids.length) {
    const rows = await prisma.agent.findMany({ where: { id: { in: ids } } });
    for (const r of rows) nameById.set(r.id, r.name);
  } else if (groupBy === 'task' && ids.length) {
    const rows = await prisma.task.findMany({ where: { id: { in: ids } } });
    for (const r of rows) nameById.set(r.id, r.name ?? r.id);
  } else if (groupBy === 'project' && ids.length) {
    const rows = await prisma.project.findMany({ where: { id: { in: ids } } });
    for (const r of rows) nameById.set(r.id, r.name);
  } else if (groupBy === 'user' && ids.length) {
    const rows = await prisma.user.findMany({ where: { id: { in: ids } } });
    for (const r of rows) nameById.set(r.id, r.email);
  }

  return [...buckets.values()]
    .map((b) => ({
      dimension: groupBy,
      id: b.id || '(none)',
      name: b.id ? nameById.get(b.id) ?? b.id : '(unattributed)',
      totalTokens: b.tokens,
      costUsd: Number(b.cost.toFixed(6)),
      requests: b.requests,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

export function chargebackToCsv(rows: ChargebackRow[]): string {
  const header = 'dimension,id,name,total_tokens,cost_usd,requests';
  const lines = rows.map((r) =>
    [r.dimension, csvEscape(r.id), csvEscape(r.name), r.totalTokens, r.costUsd.toFixed(6), r.requests].join(',')
  );
  return [header, ...lines].join('\n') + (lines.length ? '\n' : '\n');
}

export async function exportChargebackCsv(
  organizationId: string,
  groupBy: ChargebackDimension,
  from?: Date,
  to?: Date
): Promise<{ csv: string; filename: string; rows: ChargebackRow[] }> {
  const rows = await chargebackReport(organizationId, groupBy, from, to);
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    csv: chargebackToCsv(rows),
    filename: `tbm-chargeback-${groupBy}-${stamp}.csv`,
    rows,
  };
}
