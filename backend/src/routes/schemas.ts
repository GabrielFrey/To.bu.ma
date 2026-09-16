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

export const chargebackQuerySchema = z.object({
  groupBy: z.enum(['agent', 'task', 'project', 'user']).default('agent'),
  from: z.string().optional(),
  to: z.string().optional(),
});

export function parseDateRange(q: { from?: string; to?: string }) {
  return {
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  };
}
