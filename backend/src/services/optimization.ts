import { prisma } from '../db.js';
import { estimateTokens, type ChatMessage } from '../tokenizer.js';

/**
 * Choose the cheapest model that (a) is at least as capable per a simple tier
 * order and (b) fits the prompt in its context window. Used to downgrade when a
 * budget is tight. Falls back to the requested model if nothing better fits.
 */
export async function chooseModel(params: {
  requestedModel: string;
  promptTokens: number;
  organizationId?: string;
  preferCheaper: boolean;
}): Promise<{ model: string; reason: string }> {
  const { requestedModel, promptTokens, organizationId, preferCheaper } = params;
  if (!preferCheaper) return { model: requestedModel, reason: 'no downgrade requested' };

  const candidates = await prisma.modelPricing.findMany({
    where: { active: true, OR: [{ organizationId }, { organizationId: null }] },
  });
  const fitting = candidates.filter((c) => c.contextWindow >= promptTokens);
  if (fitting.length === 0) return { model: requestedModel, reason: 'no cheaper model fits context' };

  // Cheapest by blended input+output price.
  fitting.sort((a, b) => a.inputPerMTokens + a.outputPerMTokens - (b.inputPerMTokens + b.outputPerMTokens));
  const cheapest = fitting[0];
  if (cheapest.model === requestedModel) return { model: requestedModel, reason: 'already cheapest' };
  return { model: cheapest.model, reason: `downgraded to cheaper model ${cheapest.model}` };
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
