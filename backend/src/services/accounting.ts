import { prisma } from '../db.js';
import { config } from '../config.js';
import { computeCost, type UsageTokens } from '../pricing.js';
import type { ScopeChain } from '../types.js';
import { getReservationStore } from './reservations.js';
import { withSpan } from '../telemetry.js';

/**
 * Mark reservations older than TTL with no recorded usage as expired so they
 * no longer consume concurrent budget headroom. Pass an `organizationId` on the
 * request hot path so a single tenant's check never writes other tenants' rows;
 * the background sweep in server.ts runs unscoped.
 */
export async function expireStaleReservations(
  opts: { organizationId?: string; now?: Date } = {}
): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - config.reservationTtlMs);
  const result = await prisma.llmRequest.updateMany({
    where: {
      status: 'reserved',
      createdAt: { lt: cutoff },
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
    },
    data: { status: 'expired' },
  });
  return result.count;
}

export interface ReservationInput {
  chain: ScopeChain;
  model: string;
  provider: string;
  promptTokens: number;
  expectedCompletionTokens: number;
  reservedTokens: number;
  estimatedCostUsd: number;
  signature: string;
  decision: string;
  status: 'reserved' | 'blocked';
}

/** Create an llm_request row (a reservation or a blocked record). Every call is accounted. */
export async function createReservation(input: ReservationInput) {
  return prisma.llmRequest.create({
    data: {
      organizationId: input.chain.organizationId,
      projectId: input.chain.projectId ?? undefined,
      userId: input.chain.userId ?? undefined,
      agentId: input.chain.agentId ?? undefined,
      sessionId: input.chain.sessionId ?? undefined,
      taskId: input.chain.taskId ?? undefined,
      model: input.model,
      provider: input.provider,
      status: input.status,
      signature: input.signature,
      promptTokens: input.promptTokens,
      expectedCompletionTokens: input.expectedCompletionTokens,
      reservedTokens: input.reservedTokens,
      estimatedCostUsd: input.estimatedCostUsd,
      decision: input.decision,
    },
  });
}

/**
 * Demote an already-created reservation to `blocked`. Used by the gateway's
 * reserve-then-verify pass when a concurrent request consumed the headroom this
 * one was counting on.
 */
export async function blockReservation(requestId: string, decision: string) {
  await prisma.llmRequest.update({
    where: { id: requestId },
    data: { status: 'blocked', decision },
  });
  // A blocked reservation no longer holds headroom.
  await getReservationStore().release(requestId);
}

export interface RecordUsageInput {
  requestId: string;
  /**
   * Tenant that owns the reservation. Required: without it any authenticated
   * caller could finalize another organization's request and write usage into
   * their tenant.
   */
  organizationId: string;
  model?: string;
  usage: UsageTokens;
  status?: 'completed' | 'failed';
}

export class UnknownRequestError extends Error {
  statusCode = 404;
  constructor(requestId: string) {
    super(`Unknown request ${requestId}`);
    this.name = 'UnknownRequestError';
  }
}

/**
 * Finalize a reservation with actual usage. Idempotent per requestId: a second
 * call returns the existing usage row instead of double-counting.
 */
export async function recordUsage(input: RecordUsageInput) {
  return withSpan('tbm.record_usage', () => recordUsageImpl(input), {
    'tbm.request_id': input.requestId,
  });
}

async function recordUsageImpl(input: RecordUsageInput) {
  // Prisma silently drops `undefined` filters, so a missing tenant would turn the
  // ownership check below into a plain findFirst-by-id. Fail loudly instead.
  if (!input.organizationId) throw new Error('recordUsage requires organizationId');
  const request = await prisma.llmRequest.findFirst({
    where: { id: input.requestId, organizationId: input.organizationId },
    include: { usage: true },
  });
  if (!request) throw new UnknownRequestError(input.requestId);
  if (request.usage) return { request, usage: request.usage, idempotent: true };

  const model = input.model ?? request.model;
  const input_ = input.usage.inputTokens ?? 0;
  const output = input.usage.outputTokens ?? 0;
  const cached = input.usage.cachedTokens ?? 0;
  const tool = input.usage.toolTokens ?? 0;
  const total = input_ + output + tool;
  const costUsd = await computeCost(model, input.usage, request.organizationId);
  const status = input.status ?? 'completed';

  const usage = await prisma.tokenUsage.create({
    data: {
      requestId: request.id,
      organizationId: request.organizationId,
      projectId: request.projectId,
      agentId: request.agentId,
      sessionId: request.sessionId,
      taskId: request.taskId,
      model,
      inputTokens: input_,
      outputTokens: output,
      cachedTokens: cached,
      toolTokens: tool,
      totalTokens: total,
      costUsd,
    },
  });

  await prisma.llmRequest.update({
    where: { id: request.id },
    data: { status, model, completedAt: new Date() },
  });

  // The reservation is finalized; release the outstanding headroom it held.
  await getReservationStore().release(request.id);

  return { request, usage, idempotent: false };
}

/** Record standalone tool-call token usage (attaches to a synthetic request). */
export async function recordToolUsage(params: {
  chain: ScopeChain;
  tool: string;
  toolTokens: number;
  model?: string;
}) {
  const req = await prisma.llmRequest.create({
    data: {
      organizationId: params.chain.organizationId,
      projectId: params.chain.projectId ?? undefined,
      agentId: params.chain.agentId ?? undefined,
      sessionId: params.chain.sessionId ?? undefined,
      taskId: params.chain.taskId ?? undefined,
      model: params.model ?? 'tool',
      provider: 'tool',
      status: 'completed',
      decision: 'allow',
      reservedTokens: 0,
      completedAt: new Date(),
    },
  });
  const usage = await prisma.tokenUsage.create({
    data: {
      requestId: req.id,
      organizationId: params.chain.organizationId,
      projectId: params.chain.projectId,
      agentId: params.chain.agentId,
      sessionId: params.chain.sessionId,
      taskId: params.chain.taskId,
      model: params.model ?? 'tool',
      toolTokens: params.toolTokens,
      totalTokens: params.toolTokens,
      costUsd: 0,
    },
  });
  return { request: req, usage };
}
