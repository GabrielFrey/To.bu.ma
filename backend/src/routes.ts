import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from './db.js';
import { authenticate, requireRole } from './auth.js';
import { checkBudget } from './services/gateway.js';
import { recordUsage, recordToolUsage } from './services/accounting.js';
import { getProvider } from './providers/index.js';
import { decryptSecret } from './crypto.js';
import * as analytics from './services/analytics.js';
import { compressContextIfNeeded, chooseModel } from './services/optimization.js';
import { emitEvent, EVENT_TYPES, verifyApprovalActionToken } from './services/events.js';
import type { ScopeChain } from './types.js';

const scopeSchema = z.object({
  projectId: z.string().optional(),
  userId: z.string().optional(),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
});

const messageSchema = z.object({ role: z.string(), content: z.string(), name: z.string().optional() });

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true }));

  // Actionable approval link (no API key; verified by signed token). Lets a
  // Slack/email recipient approve or deny with one click.
  app.get('/v1/approvals/:id/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = z.object({ action: z.enum(['approve', 'deny']), token: z.string() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'action and token required' });
    const { action, token } = q.data;
    if (!verifyApprovalActionToken(id, action, token)) return reply.code(403).send({ error: 'invalid token' });
    const appr = await prisma.approval.findUnique({ where: { id } });
    if (!appr) return reply.code(404).send({ error: 'approval not found' });
    if (appr.status !== 'pending') return reply.send({ status: appr.status, note: 'already resolved' });
    if (action === 'approve') {
      await prisma.llmRequest.update({ where: { id: appr.requestId }, data: { status: 'reserved', decision: 'allow' } });
    } else {
      await prisma.llmRequest.update({ where: { id: appr.requestId }, data: { status: 'blocked' } });
    }
    const updated = await prisma.approval.update({
      where: { id },
      data: { status: action === 'approve' ? 'approved' : 'denied', decidedAt: new Date() },
    });
    await emitEvent({
      organizationId: appr.organizationId,
      type: 'approval_resolved',
      data: { approvalId: id, status: updated.status, reason: appr.reason, via: 'link' },
    }).catch(() => {});
    return reply.send({ status: updated.status });
  });

  // All /v1 routes require authentication.
  app.register(async (v1) => {
    v1.addHook('preHandler', authenticate);

    // ---- Budgets ----
    v1.post('/budgets', { preHandler: requireRole('admin') }, async (req, reply) => {
      const schema = z.object({
        name: z.string(),
        level: z.enum(['ORGANIZATION', 'PROJECT', 'USER', 'AGENT', 'SESSION', 'TASK', 'TOOL_CALL', 'REQUEST']),
        scopeId: z.string().optional(),
        metric: z.enum(['TOKENS', 'COST_USD']).default('TOKENS'),
        hardLimit: z.number().positive(),
        softLimit: z.number().positive().optional(),
        warningThreshold: z.number().min(0).max(1).default(0.8),
        resetPeriod: z.enum(['NEVER', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']).default('MONTHLY'),
        priority: z.number().int().default(5),
        fallbackBehavior: z.enum(['BLOCK', 'DEGRADE', 'SUMMARIZE', 'REQUIRE_APPROVAL', 'STOP_AGENT']).default('BLOCK'),
      });
      const body = schema.parse(req.body);
      const budget = await prisma.budget.create({
        data: { ...body, organizationId: req.auth!.organizationId },
      });
      return reply.code(201).send(budget);
    });

    v1.patch('/budgets/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          name: z.string().optional(),
          hardLimit: z.number().positive().optional(),
          softLimit: z.number().positive().optional(),
          warningThreshold: z.number().min(0).max(1).optional(),
          resetPeriod: z.enum(['NEVER', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']).optional(),
          priority: z.number().int().optional(),
          fallbackBehavior: z.enum(['BLOCK', 'DEGRADE', 'SUMMARIZE', 'REQUIRE_APPROVAL', 'STOP_AGENT']).optional(),
          active: z.boolean().optional(),
        })
        .parse(req.body);
      const existing = await prisma.budget.findFirst({ where: { id, organizationId: req.auth!.organizationId } });
      if (!existing) return reply.code(404).send({ error: 'budget not found' });
      const budget = await prisma.budget.update({ where: { id }, data: body });
      return budget;
    });

    v1.get('/budgets', async (req) => {
      return prisma.budget.findMany({
        where: { organizationId: req.auth!.organizationId },
        include: { policies: true },
      });
    });

    // ---- Policies ----
    v1.post('/policies', { preHandler: requireRole('admin') }, async (req, reply) => {
      const body = z
        .object({
          budgetId: z.string(),
          name: z.string(),
          condition: z.string(),
          action: z.enum([
            'ALLOW', 'WARN', 'DEGRADE', 'COMPRESS', 'SUMMARIZE', 'TRUNCATE',
            'REQUIRE_APPROVAL', 'STOP_AGENT', 'RETRY_LIMIT', 'TOOL_LIMIT',
          ]),
          params: z.record(z.unknown()).optional(),
          priority: z.number().int().default(5),
        })
        .parse(req.body);
      const budget = await prisma.budget.findFirst({
        where: { id: body.budgetId, organizationId: req.auth!.organizationId },
      });
      if (!budget) return reply.code(404).send({ error: 'budget not found' });
      const policy = await prisma.budgetPolicy.create({
        data: {
          budgetId: body.budgetId,
          name: body.name,
          condition: body.condition,
          action: body.action,
          params: body.params ? JSON.stringify(body.params) : null,
          priority: body.priority,
        },
      });
      return reply.code(201).send(policy);
    });

    // ---- Check budget (pre-request) ----
    v1.post('/check-budget', async (req, reply) => {
      const body = z
        .object({
          model: z.string(),
          provider: z.string().optional(),
          messages: z.array(messageSchema),
          expectedCompletionTokens: z.number().int().positive().optional(),
          toolCalls: z.number().int().min(0).optional(),
          scope: scopeSchema.optional(),
        })
        .parse(req.body);
      const chain: ScopeChain = { organizationId: req.auth!.organizationId, ...body.scope };
      const result = await checkBudget({
        chain,
        model: body.model,
        provider: body.provider,
        messages: body.messages,
        expectedCompletionTokens: body.expectedCompletionTokens,
        toolCalls: body.toolCalls,
      });
      return reply.send(result);
    });

    // ---- Record usage (post-request) ----
    v1.post('/record-usage', async (req, reply) => {
      const body = z
        .object({
          requestId: z.string(),
          model: z.string().optional(),
          usage: z.object({
            inputTokens: z.number().int().min(0),
            outputTokens: z.number().int().min(0),
            cachedTokens: z.number().int().min(0).optional(),
            toolTokens: z.number().int().min(0).optional(),
          }),
          status: z.enum(['completed', 'failed']).optional(),
        })
        .parse(req.body);
      const result = await recordUsage(body);
      return reply.send({ usage: result.usage, idempotent: result.idempotent });
    });

    // ---- Record tool usage ----
    v1.post('/record-tool-usage', async (req, reply) => {
      const body = z
        .object({ tool: z.string(), toolTokens: z.number().int().min(0), model: z.string().optional(), scope: scopeSchema.optional() })
        .parse(req.body);
      const chain: ScopeChain = { organizationId: req.auth!.organizationId, ...body.scope };
      const result = await recordToolUsage({ chain, tool: body.tool, toolTokens: body.toolTokens, model: body.model });
      return reply.send({ usage: result.usage });
    });

    // ---- Convenience: check -> provider call -> record (proves end-to-end) ----
    v1.post('/llm/complete', async (req, reply) => {
      const body = z
        .object({
          model: z.string(),
          provider: z.string().default('mock'),
          messages: z.array(messageSchema),
          maxTokens: z.number().int().positive().optional(),
          expectedCompletionTokens: z.number().int().positive().optional(),
          scope: scopeSchema.optional(),
          autoCompress: z.boolean().default(false),
        })
        .parse(req.body);
      const chain: ScopeChain = { organizationId: req.auth!.organizationId, ...body.scope };

      let messages = body.messages;
      const check = await checkBudget({
        chain,
        model: body.model,
        provider: body.provider,
        messages,
        expectedCompletionTokens: body.expectedCompletionTokens ?? body.maxTokens,
      });

      if (!check.allowed) {
        return reply.code(402).send({ blocked: true, decision: check.decision, reason: check.reason, check });
      }

      // Apply compression if the policy asked for it (or caller opted in).
      if (body.autoCompress && ['compress', 'summarize', 'degrade'].includes(check.decision)) {
        const budgetTokens = Math.max(256, check.forecast.reservedTokens);
        const comp = compressContextIfNeeded({ messages, model: body.model, targetTokens: budgetTokens });
        messages = comp.messages;
      }

      const model = check.recommendedModel ?? body.model;

      // Load provider key (encrypted at rest) for real providers.
      let apiKey: string | undefined;
      if (body.provider === 'openai') {
        const pk = await prisma.providerKey.findFirst({
          where: { organizationId: chain.organizationId, provider: 'openai' },
        });
        if (pk) apiKey = decryptSecret(pk.ciphertext);
      }

      try {
        const provider = getProvider(body.provider);
        const completion = await provider.complete(
          { model, messages, maxTokens: body.maxTokens },
          apiKey
        );
        const rec = await recordUsage({
          requestId: check.requestId!,
          model: completion.model,
          usage: completion.usage,
          status: 'completed',
        });
        return reply.send({
          content: completion.content,
          model: completion.model,
          decision: check.decision,
          usage: rec.usage,
          check,
        });
      } catch (err) {
        await recordUsage({
          requestId: check.requestId!,
          usage: { inputTokens: check.forecast.promptTokens, outputTokens: 0 },
          status: 'failed',
        });
        return reply.code(502).send({ error: 'provider error', detail: (err as Error).message });
      }
    });

    // ---- Optimization helpers ----
    v1.post('/optimize/compress', async (req) => {
      const body = z
        .object({ model: z.string(), messages: z.array(messageSchema), targetTokens: z.number().int().positive() })
        .parse(req.body);
      return compressContextIfNeeded(body);
    });

    v1.post('/optimize/choose-model', async (req) => {
      const body = z
        .object({ requestedModel: z.string(), promptTokens: z.number().int().min(0), preferCheaper: z.boolean().default(true) })
        .parse(req.body);
      return chooseModel({ ...body, organizationId: req.auth!.organizationId });
    });

    // ---- Agent pause / resume ----
    v1.post('/agents/:id/pause', { preHandler: requireRole('member') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const agent = await prisma.agent.findFirst({
        where: { id, project: { organizationId: req.auth!.organizationId } },
      });
      if (!agent) return reply.code(404).send({ error: 'agent not found' });
      const updated = await prisma.agent.update({ where: { id }, data: { status: 'paused' } });
      await emitEvent({ organizationId: req.auth!.organizationId, type: 'agent_paused', data: { agentId: id, agentName: agent.name } }).catch(() => {});
      return updated;
    });

    v1.post('/agents/:id/resume', { preHandler: requireRole('member') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const agent = await prisma.agent.findFirst({
        where: { id, project: { organizationId: req.auth!.organizationId } },
      });
      if (!agent) return reply.code(404).send({ error: 'agent not found' });
      const updated = await prisma.agent.update({ where: { id }, data: { status: 'active' } });
      await emitEvent({ organizationId: req.auth!.organizationId, type: 'agent_resumed', data: { agentId: id, agentName: agent.name } }).catch(() => {});
      return updated;
    });

    // ---- Approvals ----
    v1.get('/approvals', async (req) => {
      return prisma.approval.findMany({
        where: { organizationId: req.auth!.organizationId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      });
    });

    v1.post('/approvals/:id/approve', { preHandler: requireRole('admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const appr = await prisma.approval.findFirst({ where: { id, organizationId: req.auth!.organizationId } });
      if (!appr) return reply.code(404).send({ error: 'approval not found' });
      await prisma.llmRequest.update({ where: { id: appr.requestId }, data: { status: 'reserved', decision: 'allow' } });
      const updated = await prisma.approval.update({ where: { id }, data: { status: 'approved', decidedAt: new Date() } });
      await emitEvent({ organizationId: req.auth!.organizationId, type: 'approval_resolved', data: { approvalId: id, status: 'approved', reason: appr.reason } }).catch(() => {});
      return updated;
    });

    v1.post('/approvals/:id/deny', { preHandler: requireRole('admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const appr = await prisma.approval.findFirst({ where: { id, organizationId: req.auth!.organizationId } });
      if (!appr) return reply.code(404).send({ error: 'approval not found' });
      await prisma.llmRequest.update({ where: { id: appr.requestId }, data: { status: 'blocked' } });
      const updated = await prisma.approval.update({ where: { id }, data: { status: 'denied', decidedAt: new Date() } });
      await emitEvent({ organizationId: req.auth!.organizationId, type: 'approval_resolved', data: { approvalId: id, status: 'denied', reason: appr.reason } }).catch(() => {});
      return updated;
    });

    // ---- Webhooks / notification channels ----
    v1.post('/webhooks', { preHandler: requireRole('admin') }, async (req, reply) => {
      const body = z
        .object({
          kind: z.enum(['generic', 'slack', 'http', 'email']).default('generic'),
          url: z.string().url().optional(),
          target: z.string().optional(), // email address for kind=email
          secret: z.string().optional(),
          events: z.union([z.literal('all'), z.array(z.enum(EVENT_TYPES))]).default('all'),
        })
        .parse(req.body);
      if (body.kind === 'email' && !body.target) return reply.code(400).send({ error: 'email channel requires target' });
      if (body.kind !== 'email' && !body.url) return reply.code(400).send({ error: 'this channel requires url' });
      const events = Array.isArray(body.events) ? body.events.join(',') : 'all';
      const wh = await prisma.webhook.create({
        data: {
          organizationId: req.auth!.organizationId,
          kind: body.kind,
          url: body.url,
          target: body.target,
          secret: body.secret ?? 'whsec_' + randomBytes(24).toString('hex'),
          events,
        },
      });
      return reply.code(201).send(wh);
    });

    v1.get('/webhooks', async (req) =>
      prisma.webhook.findMany({ where: { organizationId: req.auth!.organizationId }, orderBy: { createdAt: 'desc' } })
    );

    v1.delete('/webhooks/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const wh = await prisma.webhook.findFirst({ where: { id, organizationId: req.auth!.organizationId } });
      if (!wh) return reply.code(404).send({ error: 'webhook not found' });
      await prisma.webhookDelivery.deleteMany({ where: { webhookId: id } });
      await prisma.webhook.delete({ where: { id } });
      return reply.send({ deleted: true });
    });

    v1.get('/webhooks/:id/deliveries', async (req, reply) => {
      const { id } = req.params as { id: string };
      const wh = await prisma.webhook.findFirst({ where: { id, organizationId: req.auth!.organizationId } });
      if (!wh) return reply.code(404).send({ error: 'webhook not found' });
      return prisma.webhookDelivery.findMany({ where: { webhookId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    });

    // Fire a synthetic event to test wiring.
    v1.post('/webhooks/test', { preHandler: requireRole('admin') }, async (req) => {
      const result = await emitEvent({
        organizationId: req.auth!.organizationId,
        type: 'warning_threshold',
        data: { budgetName: 'test budget', utilization: 0.85, test: true },
      });
      return { emitted: true, ...result };
    });

    v1.get('/events', async (req) =>
      prisma.eventLog.findMany({ where: { organizationId: req.auth!.organizationId }, orderBy: { createdAt: 'desc' }, take: 100 })
    );

    // ---- Analytics ----
    const org = (req: any) => req.auth!.organizationId as string;
    v1.get('/analytics/total', async (req) => analytics.totalSpend(org(req)));
    v1.get('/analytics/by-agent', async (req) => analytics.spendByAgent(org(req)));
    v1.get('/analytics/by-task', async (req) => analytics.spendByTask(org(req)));
    v1.get('/analytics/by-project', async (req) => analytics.spendByProject(org(req)));
    v1.get('/analytics/active-budgets', async (req) => analytics.activeBudgets(org(req)));
    v1.get('/analytics/warnings', async (req) => analytics.warnings(org(req)));
    v1.get('/analytics/blocked', async (req) => analytics.blockedRequests(org(req)));
    v1.get('/analytics/expensive-prompts', async (req) => analytics.expensivePrompts(org(req)));
    v1.get('/analytics/loops', async (req) => analytics.inefficientLoops(org(req)));
    v1.get('/analytics/recommendations', async (req) => analytics.recommendations(org(req)));

    // ---- Directory helpers for the dashboard ----
    v1.get('/agents', async (req) => {
      return prisma.agent.findMany({ where: { project: { organizationId: req.auth!.organizationId } } });
    });
  }, { prefix: '/v1' });
}
