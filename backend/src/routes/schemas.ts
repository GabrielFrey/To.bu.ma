import { z } from 'zod';

/**
 * Shared request schemas. These enums exist verbatim in the Prisma schema as
 * String columns; keeping one copy here is what stops the API and the engines
 * from drifting apart.
 */
export const budgetLevelSchema = z.enum([
  'ORGANIZATION',
  'PROJECT',
  'USER',
  'AGENT',
  'SESSION',
  'TASK',
  'TOOL_CALL',
  'REQUEST',
]);

export const budgetMetricSchema = z.enum(['TOKENS', 'COST_USD']);

export const resetPeriodSchema = z.enum(['NEVER', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']);

export const fallbackBehaviorSchema = z.enum([
  'BLOCK',
  'DEGRADE',
  'SUMMARIZE',
  'REQUIRE_APPROVAL',
  'STOP_AGENT',
]);

export const policyActionSchema = z.enum([
  'ALLOW',
  'WARN',
  'DEGRADE',
  'COMPRESS',
  'SUMMARIZE',
  'TRUNCATE',
  'REQUIRE_APPROVAL',
  'STOP_AGENT',
  'RETRY_LIMIT',
  'TOOL_LIMIT',
]);

export const scopeSchema = z.object({
  projectId: z.string().optional(),
  userId: z.string().optional(),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
});

/** Upper bounds keep a single request from turning into a tokenizer DoS. */
export const MAX_MESSAGES = 512;
export const MAX_MESSAGE_CHARS = 200_000;

export const messageSchema = z.object({
  role: z.string().min(1).max(32),
  content: z.string().max(MAX_MESSAGE_CHARS),
  name: z.string().max(128).optional(),
});

export const messagesSchema = z.array(messageSchema).max(MAX_MESSAGES);

/**
 * Proxy body validators. The transparent OpenAI-compatible proxy accepts
 * arbitrary provider fields (`.passthrough()` keeps them), but the parts that
 * drive tokenizer work — message/array count and per-string content size — must
 * be bounded. Without this, the flagship integration path hands an unbounded
 * body straight to tiktoken, which is a CPU-amplification vector. Violations are
 * surfaced by the proxy handler as an OpenAI-style 400, keeping the wire
 * contract intact rather than emitting the generic Zod error shape.
 */
const boundedString = z.string().max(MAX_MESSAGE_CHARS);

export const chatProxyBodySchema = z
  .object({
    model: z.string().max(128).optional(),
    messages: z
      .array(
        z
          .object({
            role: z.string().min(1).max(64),
            content: z.union([boundedString, z.array(z.any()).max(256)]).nullish(),
          })
          .passthrough()
      )
      .min(1)
      .max(MAX_MESSAGES),
    max_tokens: z.number().int().min(0).max(4_000_000).optional(),
  })
  .passthrough();

export const completionsProxyBodySchema = z
  .object({
    model: z.string().max(128).optional(),
    prompt: z.union([boundedString, z.array(z.any()).max(MAX_MESSAGES)]),
    max_tokens: z.number().int().min(0).max(4_000_000).optional(),
  })
  .passthrough();

export const embeddingsProxyBodySchema = z
  .object({
    model: z.string().max(128).optional(),
    input: z.union([boundedString, z.array(z.any()).max(MAX_MESSAGES)]),
  })
  .passthrough();

export const rangeQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const chargebackQuerySchema = rangeQuerySchema.extend({
  groupBy: z.enum(['agent', 'task', 'project', 'user']).default('agent'),
});

export function parseDateRange(q: { from?: string; to?: string }) {
  return {
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  };
}
