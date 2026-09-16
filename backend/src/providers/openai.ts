import { config } from '../config.js';
import { estimateTokens } from '../tokenizer.js';
import type {
  ChatRequest,
  ChatResult,
  CompletionRequest,
  CompletionResult,
  Provider,
  ToolCallRequest,
} from './types.js';

async function postChatCompletions(body: unknown, apiKey?: string): Promise<any> {
  const key = apiKey ?? config.openaiApiKey;
  if (!key) throw new Error('No OpenAI API key configured');
  const res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

/**
 * Real OpenAI-compatible adapter. Works with the OpenAI API and any
 * OpenAI-compatible endpoint (set OPENAI_BASE_URL). Uses fetch (Node >=18).
 * The provider key is passed in from the encrypted store and never logged.
 */
export const openaiProvider: Provider = {
  name: 'openai',
  async complete(req: CompletionRequest, apiKey?: string): Promise<CompletionResult> {
    const data = await postChatCompletions(
      {
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.7,
      },
      apiKey
    );
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

  /** Tool-calling turn used by the in-product assistant. */
  async chat(req: ChatRequest, apiKey?: string): Promise<ChatResult> {
    const data = await postChatCompletions(
      {
        model: req.model,
        messages: req.messages.map((m) => {
          if (m.role === 'tool') {
            return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
          }
          if (m.toolCalls?.length) {
            return {
              role: m.role,
              content: m.content || null,
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.arguments) },
              })),
            };
          }
          return { role: m.role, content: m.content };
        }),
        tools: req.tools?.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: req.tools?.length ? 'auto' : undefined,
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.2,
      },
      apiKey
    );

    const choice = data.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const content: string = message.content ?? '';
    const toolCalls: ToolCallRequest[] = (message.tool_calls ?? []).map((c: any) => ({
      id: c.id,
      name: c.function?.name ?? '',
      arguments: safeParseArgs(c.function?.arguments),
    }));
    const usage = data.usage ?? {};
    const finish = choice.finish_reason === 'tool_calls' || toolCalls.length > 0
      ? 'tool_calls'
      : choice.finish_reason === 'length'
        ? 'length'
        : 'stop';

    return {
      content,
      model: data.model ?? req.model,
      usage: {
        inputTokens:
          usage.prompt_tokens ??
          estimateTokens(req.messages.map((m) => ({ role: m.role, content: m.content })), req.model),
        outputTokens: usage.completion_tokens ?? estimateTokens(content, req.model),
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        toolTokens: 0,
      },
      toolCalls,
      finishReason: finish,
    };
  },
};

/** Models occasionally emit malformed JSON arguments; treat that as "no args". */
function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
