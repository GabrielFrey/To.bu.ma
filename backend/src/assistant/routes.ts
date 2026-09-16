import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { requireRole } from '../auth.js';
import { actor, orgId } from '../routes/context.js';
import { ASSISTANT_AGENT, ensureAssistantIdentity } from './identity.js';
import { confirmationSchema, runChatTurn, type StreamEvent } from './runner.js';
import {
  alwaysGatedTools,
  conditionallyGatedTools,
  TOOLS,
  zodToJsonSchema,
} from './tools.js';

const chatSchema = z
  .object({
    conversationId: z.string().optional(),
    message: z.string().min(1).max(8_000).optional(),
    confirmations: z.array(confirmationSchema).max(10).optional(),
  })
  .refine((b) => !!b.message || (b.confirmations?.length ?? 0) > 0, {
    message: 'send a message, a confirmation, or both',
  });

export async function registerAssistantRoutes(v1: FastifyInstance) {
  // The assistant can change configuration, so it needs a real write role. The
  // per-tool confirmation gate is defence in depth on top of this, not instead.
  const canChat = { preHandler: requireRole('member') };

  /** What the assistant can do, and which calls will stop for confirmation. */
  v1.get('/assistant/tools', async () => ({
    provider: config.assistantProvider,
    model: config.assistantModel,
    alwaysConfirm: alwaysGatedTools(),
    conditionallyConfirm: conditionallyGatedTools(),
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      risk: t.risk,
      confirmation: t.risk === 'destructive' ? 'always' : t.classify ? 'conditional' : 'never',
      parameters: zodToJsonSchema(t.schema),
    })),
  }));

  /** The assistant's own metered spend — the dogfooding view. */
  v1.get('/assistant/spend', async (req) => {
    const organizationId = orgId(req);
    const identity = await ensureAssistantIdentity(organizationId);
    const [usage, budget, conversations, toolCalls] = await Promise.all([
      prisma.tokenUsage.aggregate({
        where: { organizationId, agentId: identity.agentId },
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, costUsd: true },
        _count: true,
      }),
      prisma.budget.findFirst({ where: { id: identity.budgetId } }),
      prisma.assistantConversation.count({ where: { organizationId } }),
      prisma.assistantToolCall.count({ where: { organizationId } }),
    ]);
    const totalTokens = usage._sum.totalTokens ?? 0;
    return {
      agent: ASSISTANT_AGENT,
      agentId: identity.agentId,
      paused: identity.paused,
      requests: usage._count,
      inputTokens: usage._sum.inputTokens ?? 0,
      outputTokens: usage._sum.outputTokens ?? 0,
      totalTokens,
      costUsd: Number((usage._sum.costUsd ?? 0).toFixed(6)),
      conversations,
      toolCalls,
      budget: budget
        ? {
            id: budget.id,
            name: budget.name,
            metric: budget.metric,
            hardLimit: budget.hardLimit,
            resetPeriod: budget.resetPeriod,
            utilization: budget.hardLimit > 0 ? totalTokens / budget.hardLimit : 0,
          }
        : null,
    };
  });

  v1.get('/assistant/conversations', async (req) =>
    prisma.assistantConversation.findMany({
      where: { organizationId: orgId(req) },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    })
  );

  v1.get('/assistant/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const convo = await prisma.assistantConversation.findFirst({
      where: { id, organizationId: orgId(req) },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, include: { toolCalls: true } },
      },
    });
    if (!convo) return reply.code(404).send({ error: 'conversation not found' });
    return convo;
  });

  v1.delete('/assistant/conversations/:id', canChat, async (req, reply) => {
    const { id } = req.params as { id: string };
    const convo = await prisma.assistantConversation.findFirst({
      where: { id, organizationId: orgId(req) },
    });
    if (!convo) return reply.code(404).send({ error: 'conversation not found' });
    await prisma.assistantToolCall.deleteMany({ where: { conversationId: id } });
    await prisma.assistantMessage.deleteMany({ where: { conversationId: id } });
    await prisma.assistantConversation.delete({ where: { id } });
    return reply.send({ deleted: true });
  });

  v1.post('/assistant/chat', canChat, async (req, reply) => {
    const body = chatSchema.parse(req.body);
    const response = await runChatTurn({
      organizationId: orgId(req),
      conversationId: body.conversationId,
      message: body.message,
      confirmations: body.confirmations,
      actor: actor(req),
    });
    return reply.send(response);
  });

  /**
   * Streaming variant. Emits the same turn as newline-delimited SSE events
   * (`tool_call`, `tool_result`, `pending_confirmation`, `usage`, `delta`,
   * `blocked`, `done`) so the UI can show tool activity as it happens. The final
   * `done` event carries the identical payload as the non-streaming route.
   */
  v1.post('/assistant/chat/stream', canChat, async (req, reply) => {
    const body = chatSchema.parse(req.body);
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const send = (event: StreamEvent) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await runChatTurn({
        organizationId: orgId(req),
        conversationId: body.conversationId,
        message: body.message,
        confirmations: body.confirmations,
        actor: actor(req),
        onEvent: send,
      });
    } catch (err) {
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ type: 'error', error: (err as Error).message })}\n\n`
      );
    } finally {
      reply.raw.write('event: end\ndata: {}\n\n');
      reply.raw.end();
    }
    return reply;
  });
}
