import { config } from '../config.js';
import { estimateTokens, type ChatMessage } from '../tokenizer.js';

export type UpstreamMode = 'openai' | 'mock';
export type UpstreamKind = 'chat' | 'completions' | 'embeddings';

export interface ForwardParams {
  kind: UpstreamKind;
  mode: UpstreamMode;
  payload: any;
  apiKey?: string;
  baseUrl?: string;
}

const enc = new TextEncoder();

function upstreamPath(kind: UpstreamKind): string {
  return kind === 'chat' ? '/chat/completions' : kind === 'completions' ? '/completions' : '/embeddings';
}

/**
 * Forward a request to the upstream provider and return a standard `Response`.
 * Both real (OpenAI-compatible) and mock modes return a `Response` so the proxy
 * route can handle JSON and streaming bodies uniformly.
 */
export async function forwardUpstream(params: ForwardParams): Promise<Response> {
  if (params.mode === 'mock') return mockResponse(params);

  const key = params.apiKey ?? config.openaiApiKey;
  if (!key) throw new Error('No upstream API key configured (set OPENAI_API_KEY or store a provider key)');
  const base = (params.baseUrl ?? config.openaiBaseUrl).replace(/\/$/, '');
  return fetch(`${base}${upstreamPath(params.kind)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(params.payload),
  });
}

function promptTextFromPayload(kind: UpstreamKind, payload: any): { text: string; model: string } {
  const model = payload.model ?? 'gpt-4o-mini';
  if (kind === 'chat') {
    const msgs: ChatMessage[] = payload.messages ?? [];
    return { text: msgs.map((m) => `${m.role}: ${m.content}`).join('\n'), model };
  }
  if (kind === 'embeddings') {
    const input = payload.input;
    const text = Array.isArray(input) ? input.join('\n') : String(input ?? '');
    return { text, model };
  }
  return { text: String(payload.prompt ?? ''), model };
}

/** Build a deterministic, wire-compatible mock upstream Response. */
function mockResponse(params: ForwardParams): Response {
  const { kind, payload } = params;
  const { model } = promptTextFromPayload(kind, payload);
  const created = Math.floor(Date.now() / 1000);
  const id = `mock-${created}`;

  if (kind === 'embeddings') {
    const inputs = Array.isArray(payload.input) ? payload.input : [payload.input ?? ''];
    const promptTokens = inputs.reduce((s: number, t: string) => s + estimateTokens(String(t), model), 0);
    const body = {
      object: 'list',
      data: inputs.map((_: string, i: number) => ({ object: 'embedding', index: i, embedding: [0.01, -0.02, 0.03] })),
      model,
      usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
    };
    return jsonResponse(body);
  }

  const promptTokens =
    kind === 'chat'
      ? estimateTokens(payload.messages ?? [], model)
      : estimateTokens(String(payload.prompt ?? ''), model);
  const content = `[mock:${model}] response to ${promptTokens} prompt tokens`;
  const completionTokens = Math.min(payload.max_tokens ?? 64, 64);
  const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };

  if (payload.stream) {
    return sseResponse(makeMockSseChunks(kind, { id, created, model, content, usage, includeUsage: !!payload.stream_options?.include_usage }));
  }

  if (kind === 'chat') {
    return jsonResponse({
      id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage,
    });
  }
  // legacy completions
  return jsonResponse({
    id, object: 'text_completion', created, model,
    choices: [{ text: content, index: 0, finish_reason: 'stop' }],
    usage,
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function makeMockSseChunks(
  kind: UpstreamKind,
  opts: { id: string; created: number; model: string; content: string; usage: any; includeUsage: boolean }
): string[] {
  const { id, created, model, content, usage, includeUsage } = opts;
  const words = content.split(' ');
  const out: string[] = [];
  const base = { id, created, model, object: kind === 'chat' ? 'chat.completion.chunk' : 'text_completion' };
  words.forEach((w, i) => {
    const delta =
      kind === 'chat'
        ? { choices: [{ index: 0, delta: i === 0 ? { role: 'assistant', content: w + ' ' } : { content: w + ' ' }, finish_reason: null }] }
        : { choices: [{ index: 0, text: w + ' ', finish_reason: null }] };
    out.push(`data: ${JSON.stringify({ ...base, ...delta })}\n\n`);
  });
  const fin =
    kind === 'chat'
      ? { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
      : { choices: [{ index: 0, text: '', finish_reason: 'stop' }] };
  out.push(`data: ${JSON.stringify({ ...base, ...fin, ...(includeUsage ? { usage } : {}) })}\n\n`);
  out.push('data: [DONE]\n\n');
  return out;
}

/**
 * Parse an SSE byte stream: forward every chunk to `onChunk` and capture the
 * assistant content + any final `usage` object. Returns accumulated content and
 * usage (usage is null if upstream never sent it).
 */
export async function pipeAndCaptureSse(
  body: ReadableStream<Uint8Array>,
  onChunk: (bytes: Uint8Array) => void
): Promise<{ content: string; usage: any | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage: any | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      onChunk(value);
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of event.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]' || !data) continue;
          try {
            const json = JSON.parse(data);
            if (json.usage) usage = json.usage;
            const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text;
            if (typeof delta === 'string') content += delta;
          } catch {
            /* ignore keep-alive / partial */
          }
        }
      }
    }
  }
  return { content, usage };
}
