import { config } from '../config.js';

/**
 * Pluggable embedding provider used by semantic context compression. Kept
 * deliberately tiny — one `embed()` call — so it can be backed by a real
 * provider (OpenAI) or a deterministic offline one, and so semantic compression
 * degrades cleanly to the heuristic path when no provider is configured.
 */
export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Cosine similarity; returns 0 for a zero-length vector. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const LOCAL_DIM = 128;

/**
 * Deterministic, offline embedding: a hashed bag-of-tokens vector, L2-normalized.
 * Not semantically deep, but stable and dependency-free — it lets the semantic
 * strategy (and its tests/demo) run with no network or API key. Near-duplicate
 * texts map to near-identical vectors, which is exactly what dedup needs.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }
  private embedOne(text: string): number[] {
    const vec = new Array<number>(LOCAL_DIM).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const tok of tokens) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      vec[Math.abs(h) % LOCAL_DIM] += 1;
    }
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    return norm === 0 ? vec : vec.map((x) => x / norm);
  }
}

/** OpenAI-compatible embeddings endpoint. Used only when a key is configured. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = config.openaiBaseUrl,
    private readonly model: string = config.embeddingModel
  ) {}
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`embedding provider error ${res.status}`);
    const json: any = await res.json();
    return (json.data ?? []).map((d: any) => d.embedding as number[]);
  }
}

let provider: EmbeddingProvider | null | undefined;

/**
 * Memoized embedding provider chosen from config. Returns `null` when none is
 * configured (or an OpenAI provider is requested with no key) so callers fall
 * back to the heuristic compressor.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (provider !== undefined) return provider;
  switch (config.embeddingProvider) {
    case 'local':
      provider = new LocalEmbeddingProvider();
      break;
    case 'openai':
      provider = config.openaiApiKey ? new OpenAIEmbeddingProvider(config.openaiApiKey) : null;
      break;
    default:
      provider = null;
  }
  return provider;
}

/** Test hook: inject/override the embedding provider (pass `undefined` to reset). */
export function setEmbeddingProvider(next: EmbeddingProvider | null | undefined): void {
  provider = next;
}
