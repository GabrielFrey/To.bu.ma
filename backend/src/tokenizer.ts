import { getEncoding, type Tiktoken } from 'js-tiktoken';

// Map model families to their tiktoken encoding.
function encodingForModel(model: string): 'o200k_base' | 'cl100k_base' {
  if (/^(gpt-4o|gpt-4\.1|o1|o3|o4|gpt-5|chatgpt-4o)/i.test(model)) return 'o200k_base';
  return 'cl100k_base';
}

const encoderCache = new Map<string, Tiktoken>();

function getEncoder(name: 'o200k_base' | 'cl100k_base'): Tiktoken {
  let enc = encoderCache.get(name);
  if (!enc) {
    enc = getEncoding(name);
    encoderCache.set(name, enc);
  }
  return enc;
}

export interface ChatMessage {
  role: string;
  content: string;
  name?: string;
}

/**
 * Accurate token estimation using tiktoken with a documented fallback heuristic.
 * The heuristic (ceil(chars/4) + small per-message overhead) is used when the
 * encoding is unknown or tiktoken throws.
 */
export function estimateTokens(input: string | ChatMessage[], model = 'gpt-4o-mini'): number {
  const messages: ChatMessage[] = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
  try {
    const enc = getEncoder(encodingForModel(model));
    // Per OpenAI's chat format accounting: ~3 tokens per message + 3 priming.
    let tokens = 3;
    for (const m of messages) {
      tokens += 3;
      tokens += enc.encode(m.content ?? '').length;
      if (m.name) tokens += enc.encode(m.name).length;
      tokens += enc.encode(m.role ?? '').length;
    }
    return tokens;
  } catch {
    return heuristicTokens(messages);
  }
}

/** Fallback heuristic: ~4 chars per token plus per-message overhead. */
export function heuristicTokens(input: string | ChatMessage[]): number {
  const messages: ChatMessage[] = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
  let chars = 0;
  for (const m of messages) chars += (m.content ?? '').length + (m.role ?? '').length + 4;
  return Math.ceil(chars / 4) + 3;
}
