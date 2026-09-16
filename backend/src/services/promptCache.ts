import { prisma } from '../db.js';

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PromptCacheHint {
  hit: boolean;
  priorRequestId?: string;
  ageMs?: number;
  suggestedCachedTokens?: number;
  hint?: string;
}

/**
 * If an identical prompt+model signature completed recently, tell the caller they
 * can reuse provider prompt-cache pricing (stable prefix) or skip a duplicate call.
 */
export async function lookupPromptCache(params: {
  organizationId: string;
  signature: string;
  maxAgeMs?: number;
}): Promise<PromptCacheHint> {
  const maxAgeMs = params.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const since = new Date(Date.now() - maxAgeMs);
  const prior = await prisma.llmRequest.findFirst({
    where: {
      organizationId: params.organizationId,
      signature: params.signature,
      status: 'completed',
      completedAt: { gte: since },
    },
    include: { usage: true },
    orderBy: { completedAt: 'desc' },
  });
  if (!prior) return { hit: false };
  const ageMs = prior.completedAt ? Date.now() - prior.completedAt.getTime() : 0;
  const suggestedCachedTokens = prior.usage?.inputTokens ?? prior.promptTokens;
  return {
    hit: true,
    priorRequestId: prior.id,
    ageMs,
    suggestedCachedTokens,
    hint:
      'Identical prompt completed recently — keep a stable system-prefix for provider cached-input discounts, or skip a duplicate upstream call.',
  };
}
