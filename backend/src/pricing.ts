import { prisma } from './db.js';

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  toolTokens?: number;
}

/** Resolve pricing for a model, preferring org-specific over global defaults. */
export async function getPricing(model: string, organizationId?: string) {
  const rows = await prisma.modelPricing.findMany({
    where: { model, active: true, OR: [{ organizationId }, { organizationId: null }] },
  });
  if (rows.length === 0) return null;
  // Prefer org-scoped pricing if present.
  return rows.sort((a, b) => (a.organizationId ? -1 : 1) - (b.organizationId ? -1 : 1))[0];
}

/** Compute cost in USD from actual token usage. */
export async function computeCost(
  model: string,
  usage: UsageTokens,
  organizationId?: string
): Promise<number> {
  const p = await getPricing(model, organizationId);
  if (!p) return 0;
  const input = usage.inputTokens ?? 0;
  const cached = usage.cachedTokens ?? 0;
  const billableInput = Math.max(0, input - cached);
  const cost =
    (billableInput / 1_000_000) * p.inputPerMTokens +
    (cached / 1_000_000) * p.cachedPerMTokens +
    ((usage.outputTokens ?? 0) / 1_000_000) * p.outputPerMTokens;
  return Number(cost.toFixed(6));
}

/** Estimate cost pre-request from prompt + expected completion tokens. */
export async function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  organizationId?: string
): Promise<number> {
  return computeCost(model, { inputTokens: promptTokens, outputTokens: completionTokens }, organizationId);
}
