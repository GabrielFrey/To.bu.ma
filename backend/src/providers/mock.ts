import { estimateTokens } from '../tokenizer.js';
import type { CompletionRequest, CompletionResult, Provider } from './types.js';

/**
 * Deterministic offline provider for tests and the demo. Produces a canned
 * response and a realistic `usage` object derived from tiktoken estimates so
 * the full check → call → record → analytics flow works with no network.
 */
export const mockProvider: Provider = {
  name: 'mock',
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const inputTokens = estimateTokens(req.messages, req.model);
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const content = `[mock:${req.model}] echo of ${(lastUser?.content ?? '').length} chars`;
    // Emulate a completion sized to the caller's cap (or a default), never over.
    const outputTokens = Math.min(req.maxTokens ?? 64, 64);
    return {
      content,
      model: req.model,
      usage: { inputTokens, outputTokens, cachedTokens: 0, toolTokens: 0 },
    };
  },
};
