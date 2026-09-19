import { prisma } from '../db.js';
import { estimateCost } from '../pricing.js';
import { estimateTokens, type ChatMessage } from '../tokenizer.js';

export interface ChooseModelParams {
  requestedModel: string;
  promptTokens: number;
  expectedCompletionTokens?: number;
  /** Tightest remaining COST_USD budget (USD). Models whose estimate exceeds this are skipped. */
  remainingBudgetUsd?: number;
  /** Tightest remaining TOKENS budget. Models whose reserved tokens exceed this are skipped. */
  remainingBudgetTokens?: number;
  organizationId?: string;
  preferCheaper: boolean;
}

export interface ChooseModelResult {
  model: string;
  reason: string;
  estimatedCostUsd: number;
  reservedTokens: number;
  candidatesConsidered: number;
  fitsRemainingBudget: boolean;
  /**
   * Whether the reserved tokens fit the tightest remaining TOKENS budget. This
   * is invariant across models (switching models cannot change token count), so
   * it is reported separately from the cost constraint.
   */
  fitsTokenBudget: boolean;
  /** Whether the selected model's estimated cost fits the tightest remaining COST_USD budget. */
  fitsCostBudget: boolean;
}

function blendedPrice(c: { inputPerMTokens: number; outputPerMTokens: number }): number {
  return c.inputPerMTokens + c.outputPerMTokens;
}

/**
 * Price-aware routing: pick the cheapest model that still fits the prompt's
 * context window *and* the remaining hierarchical budget (USD and/or tokens).
 * When `preferCheaper` is false, keep the requested model if it still fits.
 */
export async function chooseModel(params: ChooseModelParams): Promise<ChooseModelResult> {
  const {
    requestedModel,
    promptTokens,
    organizationId,
    preferCheaper,
    remainingBudgetUsd,
    remainingBudgetTokens,
  } = params;
  const expectedCompletionTokens = params.expectedCompletionTokens ?? 256;
  const reservedTokens = promptTokens + expectedCompletionTokens;

  // The token constraint is candidate-invariant: no model swap changes how many
  // tokens the prompt+completion reserve. Compute it once, up front, so it is
  // never re-evaluated inside the per-candidate cost filter (that bug made every
  // candidate look budget-unfit whenever the token budget alone was too tight).
  const tokensOk = remainingBudgetTokens == null || reservedTokens <= remainingBudgetTokens;

  const requestedCost = await estimateCost(
    requestedModel,
    promptTokens,
    expectedCompletionTokens,
    organizationId
  );
  const requestedCostOk = remainingBudgetUsd == null || requestedCost <= remainingBudgetUsd;
  const requestedFitsBudget = requestedCostOk && tokensOk;

  if (!preferCheaper && requestedFitsBudget) {
    return {
      model: requestedModel,
      reason: 'no downgrade requested',
      estimatedCostUsd: requestedCost,
      reservedTokens,
      candidatesConsidered: 0,
      fitsRemainingBudget: requestedFitsBudget,
      fitsTokenBudget: tokensOk,
      fitsCostBudget: requestedCostOk,
    };
  }

  const candidates = await prisma.modelPricing.findMany({
    where: { active: true, OR: [{ organizationId }, { organizationId: null }] },
  });
  const byModel = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    const prev = byModel.get(c.model);
    if (!prev || (c.organizationId && !prev.organizationId)) byModel.set(c.model, c);
  }
  const unique = [...byModel.values()].filter((c) => c.contextWindow >= promptTokens);
  if (unique.length === 0) {
    return {
      model: requestedModel,
      reason: 'no cheaper model fits context',
      estimatedCostUsd: requestedCost,
      reservedTokens,
      candidatesConsidered: 0,
      fitsRemainingBudget: requestedFitsBudget,
      fitsTokenBudget: tokensOk,
      fitsCostBudget: requestedCostOk,
    };
  }

  const scored: Array<(typeof unique)[number] & { estimatedCostUsd: number }> = [];
  for (const c of unique) {
    const estimatedCostUsd = await estimateCost(
      c.model,
      promptTokens,
      expectedCompletionTokens,
      organizationId
    );
    scored.push({ ...c, estimatedCostUsd });
  }
  scored.sort((a, b) => blendedPrice(a) - blendedPrice(b) || a.estimatedCostUsd - b.estimatedCostUsd);

  // Cost is the only per-candidate constraint; the token constraint (`tokensOk`)
  // is handled separately above. Selecting the cheapest model can help cost, but
  // never tokens, so a token-budget breach must not empty the candidate pool.
  const costFit = scored.filter((c) => remainingBudgetUsd == null || c.estimatedCostUsd <= remainingBudgetUsd);

  const pool = costFit.length > 0 ? costFit : scored;
  const pick = pool[0];
  const fitsCostBudget = costFit.some((c) => c.model === pick.model);
  const fitsTokenBudget = tokensOk;
  const fitsRemainingBudget = fitsCostBudget && fitsTokenBudget;

  if (pick.model === requestedModel) {
    return {
      model: requestedModel,
      reason: fitsRemainingBudget
        ? 'already cheapest that fits remaining budget'
        : !fitsTokenBudget
          ? 'already cheapest; reserved tokens exceed the remaining token budget (no model can fix this)'
          : 'already cheapest',
      estimatedCostUsd: pick.estimatedCostUsd,
      reservedTokens,
      candidatesConsidered: scored.length,
      fitsRemainingBudget,
      fitsTokenBudget,
      fitsCostBudget,
    };
  }

  const reason = fitsRemainingBudget
    ? `downgraded to cheaper model ${pick.model} that fits remaining budget`
    : !fitsTokenBudget
      ? `selected cheapest ${pick.model}; reserved tokens exceed the remaining token budget (no model can fix this)`
      : `no model fits remaining cost budget; selected cheapest ${pick.model}`;

  return {
    model: pick.model,
    reason,
    estimatedCostUsd: pick.estimatedCostUsd,
    reservedTokens,
    candidatesConsidered: scored.length,
    fitsRemainingBudget,
    fitsTokenBudget,
    fitsCostBudget,
  };
}

/** Deduplicate consecutive identical messages (prompt deduplication). */
export function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && prev.content === m.content) continue;
    out.push(m);
  }
  return out;
}

/**
 * Context pruning: keep the system message and the most recent messages that fit
 * within `targetTokens`, dropping the oldest middle turns first.
 */
export function pruneContext(
  messages: ChatMessage[],
  model: string,
  targetTokens: number
): { messages: ChatMessage[]; prunedCount: number } {
  if (estimateTokens(messages, model) <= targetTokens) return { messages, prunedCount: 0 };
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const kept: ChatMessage[] = [];
  let running = estimateTokens(system, model);
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = estimateTokens([rest[i]], model);
    if (running + t > targetTokens) break;
    running += t;
    kept.unshift(rest[i]);
  }
  const result = [...system, ...kept];
  return { messages: result, prunedCount: messages.length - result.length };
}

/**
 * Memory summarization stub: replaces old turns with a single summary message.
 * MVP uses a deterministic extractive placeholder; a real implementation would
 * call a cheap summarizer model. Documented in README/optimization TODO.
 */
export function summarizeContext(
  messages: ChatMessage[],
  keepRecent = 4
): { messages: ChatMessage[]; summarized: boolean } {
  const rest = messages.filter((m) => m.role !== 'system');
  if (rest.length <= keepRecent) return { messages, summarized: false };
  const system = messages.filter((m) => m.role === 'system');
  const toSummarize = rest.slice(0, rest.length - keepRecent);
  const recent = rest.slice(rest.length - keepRecent);
  const summary: ChatMessage = {
    role: 'system',
    content:
      `Summary of ${toSummarize.length} earlier turns: ` +
      toSummarize.map((m) => `${m.role} said "${m.content.slice(0, 60)}"`).join('; '),
  };
  return { messages: [...system, summary, ...recent], summarized: true };
}

/**
 * compressContextIfNeeded: apply dedup → prune → summarize until under the
 * target budget. Returns the transformed messages and what was applied.
 */
export function compressContextIfNeeded(params: {
  messages: ChatMessage[];
  model: string;
  targetTokens: number;
}): { messages: ChatMessage[]; applied: string[]; before: number; after: number } {
  const { model, targetTokens } = params;
  const applied: string[] = [];
  const before = estimateTokens(params.messages, model);
  let msgs = params.messages;
  if (before <= targetTokens) return { messages: msgs, applied, before, after: before };

  msgs = dedupeMessages(msgs);
  applied.push('dedupe');

  if (estimateTokens(msgs, model) > targetTokens) {
    const s = summarizeContext(msgs);
    if (s.summarized) {
      msgs = s.messages;
      applied.push('summarize');
    }
  }
  if (estimateTokens(msgs, model) > targetTokens) {
    const p = pruneContext(msgs, model, targetTokens);
    msgs = p.messages;
    applied.push('prune');
  }
  return { messages: msgs, applied, before, after: estimateTokens(msgs, model) };
}
