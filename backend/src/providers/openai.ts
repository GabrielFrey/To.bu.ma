import { config } from '../config.js';
import { estimateTokens } from '../tokenizer.js';
import type { CompletionRequest, CompletionResult, Provider } from './types.js';

/**
 * Real OpenAI-compatible adapter. Works with the OpenAI API and any
 * OpenAI-compatible endpoint (set OPENAI_BASE_URL). Uses fetch (Node >=18).
 * The provider key is passed in from the encrypted store and never logged.
 */
export const openaiProvider: Provider = {
  name: 'openai',
  async complete(req: CompletionRequest, apiKey?: string): Promise<CompletionResult> {
    const key = apiKey ?? config.openaiApiKey;
    if (!key) throw new Error('No OpenAI API key configured');

    const res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 500)}`);
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage ?? {};
    return {
      content,
      model: data.model ?? req.model,
      usage: {
        inputTokens: usage.prompt_tokens ?? estimateTokens(req.messages, req.model),
        outputTokens: usage.completion_tokens ?? estimateTokens(content, req.model),
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        toolTokens: 0,
      },
    };
  },
};
