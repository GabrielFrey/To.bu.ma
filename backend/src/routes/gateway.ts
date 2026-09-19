import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRole } from '../auth.js';
import { decryptSecret } from '../crypto.js';
import { getProvider } from '../providers/index.js';
import { recordToolUsage, recordUsage } from '../services/accounting.js';
import { checkBudget } from '../services/gateway.js';
import { chooseModel, compressContextIfNeeded } from '../services/optimization.js';
import { requestSignature } from '../services/loopDetection.js';
import { lookupPromptCache } from '../services/promptCache.js';
import { assertScopeOwnership } from '../services/scopeGuard.js';
import { orgId } from './context.js';
import { messagesSchema, messageSchema, scopeSchema } from './schemas.js';
import { performance } from 'node:perf_hooks';
import { withSpan, recordOverhead, recordProviderTime } from '../telemetry.js';

export async function registerGatewayRoutes(v1: FastifyInstance) {
  // These endpoints spend money, so they need at least `member` — a viewer key
  // handed to a finance analyst must not be able to call an LLM.
  const canSpend = { preHandler: requireRole('member') };

  v1.post('/check-budget', canSpend, async (req, reply) => {
    const body = z
      .object({
        model: z.string(),
        provider: z.string().optional(),
        messages: messagesSchema,
        expectedCompletionTokens: z.number().int().positive().optional(),
        toolCalls: z.number().int().min(0).optional(),
        scope: scopeSchema.optional(),
      })
      .parse(req.body);
    const chain = await assertScopeOwnership(orgId(req), body.scope);
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

  v1.post('/record-usage', canSpend, async (req, reply) => {
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
    const result = await recordUsage({ ...body, organizationId: orgId(req) });
    return reply.send({ usage: result.usage, idempotent: result.idempotent });
  });

  v1.post('/record-tool-usage', canSpend, async (req, reply) => {
    const body = z
      .object({
        tool: z.string(),
        toolTokens: z.number().int().min(0),
        model: z.string().optional(),
        scope: scopeSchema.optional(),
      })
      .parse(req.body);
    const chain = await assertScopeOwnership(orgId(req), body.scope);
    const result = await recordToolUsage({
      chain,
      tool: body.tool,
      toolTokens: body.toolTokens,
      model: body.model,
    });
    return reply.send({ usage: result.usage });
  });

  // Convenience: check -> provider call -> record (proves end-to-end).
  // Traced as one span (tbm.llm_complete) with child spans for the budget check,
  // the provider call, and record-usage; the TBM overhead metric is reported as
  // total time minus the measured provider time.
  v1.post('/llm/complete', canSpend, async (req, reply) => {
    const body = z
      .object({
        model: z.string(),
        provider: z.string().default('mock'),
        messages: messagesSchema,
        maxTokens: z.number().int().positive().optional(),
        expectedCompletionTokens: z.number().int().positive().optional(),
        scope: scopeSchema.optional(),
        autoCompress: z.boolean().default(false),
      })
      .parse(req.body);
    const chain = await assertScopeOwnership(orgId(req), body.scope);

    return withSpan('tbm.llm_complete', async () => {
      const started = performance.now();
      let providerMs = 0;
      let decision = 'allow';
      try {
        let messages = body.messages;
        const check = await checkBudget({
          chain,
          model: body.model,
          provider: body.provider,
          messages,
          expectedCompletionTokens: body.expectedCompletionTokens ?? body.maxTokens,
        });
        decision = check.decision;

        if (!check.allowed) {
          return reply.code(402).send({ blocked: true, decision: check.decision, reason: check.reason, check });
        }

        // Apply compression if the policy asked for it (or the caller opted in).
        if (body.autoCompress && ['compress', 'summarize', 'degrade'].includes(check.decision)) {
          const budgetTokens = Math.max(256, check.forecast.reservedTokens);
          messages = compressContextIfNeeded({ messages, model: body.model, targetTokens: budgetTokens }).messages;
        }

        const model = check.recommendedModel ?? body.model;

        // Load the provider key (encrypted at rest) for real providers.
        let apiKey: string | undefined;
        if (body.provider === 'openai') {
          const pk = await prisma.providerKey.findFirst({
            where: { organizationId: chain.organizationId, provider: 'openai' },
          });
          if (pk) apiKey = decryptSecret(pk.ciphertext);
        }

        try {
          const provider = getProvider(body.provider);
          const providerStart = performance.now();
          const completion = await withSpan(
            'tbm.provider_call',
            () => provider.complete({ model, messages, maxTokens: body.maxTokens }, apiKey),
            { 'tbm.provider': body.provider, 'tbm.model': model }
          );
          providerMs = performance.now() - providerStart;

          const rec = await recordUsage({
            requestId: check.requestId!,
            organizationId: chain.organizationId,
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
            organizationId: chain.organizationId,
            usage: { inputTokens: check.forecast.promptTokens, outputTokens: 0 },
            status: 'failed',
          });
          return reply.code(502).send({ error: 'provider error', detail: (err as Error).message });
        }
      } finally {
        const attrs = { 'tbm.route': 'llm_complete', 'tbm.provider': body.provider, 'tbm.decision': decision };
        recordProviderTime(providerMs, attrs);
        recordOverhead(performance.now() - started - providerMs, attrs);
      }
    });
  });

  // ---- Optimization helpers ----
  v1.post('/optimize/compress', async (req) => {
    const body = z
      .object({
        model: z.string(),
        messages: messagesSchema,
        targetTokens: z.number().int().positive(),
      })
      .parse(req.body);
    return compressContextIfNeeded(body);
  });

  v1.post('/optimize/choose-model', async (req) => {
    const body = z
      .object({
        requestedModel: z.string(),
        promptTokens: z.number().int().min(0),
        expectedCompletionTokens: z.number().int().min(0).optional(),
        remainingBudgetUsd: z.number().min(0).optional(),
        remainingBudgetTokens: z.number().min(0).optional(),
        preferCheaper: z.boolean().default(true),
      })
      .parse(req.body);
    return chooseModel({ ...body, organizationId: orgId(req) });
  });

  v1.post('/optimize/cache-hint', async (req) => {
    const body = z
      .object({
        model: z.string(),
        messages: z.array(messageSchema),
        maxAgeMs: z.number().int().positive().optional(),
      })
      .parse(req.body);
    return lookupPromptCache({
      organizationId: orgId(req),
      signature: requestSignature(body.messages, body.model),
      maxAgeMs: body.maxAgeMs,
    });
  });
}
