import type { FastifyInstance } from 'fastify';
import * as analytics from '../services/analytics.js';
import { listAuditLog } from '../services/audit.js';
import { chargebackReport, exportChargebackCsv } from '../services/chargeback.js';
import { computeSavingsLedger, costPerResolvedTask } from '../services/savingsLedger.js';
import { orgId } from './context.js';
import { chargebackQuerySchema, parseDateRange, rangeQuerySchema } from './schemas.js';

function rangeOf(req: { query: unknown }): analytics.DateRange {
  return parseDateRange(rangeQuerySchema.parse(req.query));
}

export async function registerAnalyticsRoutes(v1: FastifyInstance) {
  v1.get('/analytics/total', async (req) => analytics.totalSpend(orgId(req), rangeOf(req)));
  v1.get('/analytics/by-agent', async (req) => analytics.spendByAgent(orgId(req), rangeOf(req)));
  v1.get('/analytics/by-task', async (req) => analytics.spendByTask(orgId(req), rangeOf(req)));
  v1.get('/analytics/by-project', async (req) => analytics.spendByProject(orgId(req), rangeOf(req)));
  v1.get('/analytics/active-budgets', async (req) => analytics.activeBudgets(orgId(req)));
  v1.get('/analytics/warnings', async (req) => analytics.warnings(orgId(req), rangeOf(req)));
  v1.get('/analytics/blocked', async (req) => analytics.blockedRequests(orgId(req), rangeOf(req)));
  v1.get('/analytics/expensive-prompts', async (req) => analytics.expensivePrompts(orgId(req), rangeOf(req)));
  v1.get('/analytics/loops', async (req) => analytics.inefficientLoops(orgId(req), rangeOf(req)));
  v1.get('/analytics/recommendations', async (req) => analytics.recommendations(orgId(req), rangeOf(req)));
  v1.get('/analytics/recent-requests', async (req) => analytics.recentRequests(orgId(req), rangeOf(req)));
  v1.get('/analytics/savings-ledger', async (req) => computeSavingsLedger(orgId(req)));
  v1.get('/analytics/cost-per-task', async (req) => costPerResolvedTask(orgId(req)));
  v1.get('/audit-log', async (req) => listAuditLog(orgId(req)));

  v1.get('/analytics/chargeback', async (req) => {
    const q = chargebackQuerySchema.parse(req.query);
    const { from, to } = parseDateRange(q);
    return chargebackReport(orgId(req), q.groupBy, from, to);
  });

  v1.get('/analytics/chargeback.csv', async (req, reply) => {
    const q = chargebackQuerySchema.parse(req.query);
    const { from, to } = parseDateRange(q);
    const { csv, filename } = await exportChargebackCsv(orgId(req), q.groupBy, from, to);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    return reply.send(csv);
  });
}
