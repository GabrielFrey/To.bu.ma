import { afterEach, describe, expect, it } from 'vitest';
import {
  semanticCompress,
  compressContextIfNeeded,
} from '../src/services/optimization.js';
import {
  LocalEmbeddingProvider,
  cosineSimilarity,
  setEmbeddingProvider,
  getEmbeddingProvider,
  type EmbeddingProvider,
} from '../src/services/embeddings.js';
import type { ChatMessage } from '../src/tokenizer.js';

const local = new LocalEmbeddingProvider();

// A non-consecutive exact duplicate: heuristic (consecutive-only) dedupe cannot
// remove it, but semantic dedupe can.
const messages: ChatMessage[] = [
  { role: 'system', content: 'You are a финансовый assistant. Keep answers short.' },
  { role: 'user', content: 'Summarize the Q3 revenue figures for the board deck in detail.' },
  { role: 'assistant', content: 'Q3 revenue was 12M, up 8% QoQ, driven by enterprise.' },
  { role: 'user', content: 'Also include churn and net revenue retention numbers please.' },
  { role: 'user', content: 'Summarize the Q3 revenue figures for the board deck in detail.' },
];

afterEach(() => setEmbeddingProvider(undefined));

describe('LocalEmbeddingProvider + cosine', () => {
  it('is deterministic and scores identical text as ~1', async () => {
    const [a, b] = await local.embed(['hello world', 'hello world']);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
  it('scores unrelated text well below the dedupe threshold', async () => {
    const [a, b] = await local.embed(['token budget enforcement', 'the cat sat quietly']);
    expect(cosineSimilarity(a, b)).toBeLessThan(0.5);
  });
});

describe('semanticCompress', () => {
  it('drops a non-consecutive semantic duplicate, keeping system + order', async () => {
    const out = await semanticCompress(messages, local);
    expect(out.applied.some((a) => a.startsWith('semantic-dedupe'))).toBe(true);
    // One of the two identical user messages is removed.
    expect(out.messages.length).toBe(messages.length - 1);
    // System message is always kept and stays first.
    expect(out.messages[0].role).toBe('system');
    // The duplicated content still appears exactly once.
    const dupText = 'Summarize the Q3 revenue figures for the board deck in detail.';
    expect(out.messages.filter((m) => m.content === dupText)).toHaveLength(1);
  });

  it('is a no-op when there is nothing semantically redundant', async () => {
    const distinct: ChatMessage[] = [
      { role: 'user', content: 'What is the org token budget?' },
      { role: 'assistant', content: 'One million tokens per month.' },
    ];
    const out = await semanticCompress(distinct, local);
    expect(out.applied).toHaveLength(0);
    expect(out.messages).toHaveLength(2);
  });
});

describe('compressContextIfNeeded strategy selection', () => {
  const model = 'gpt-4o-mini';

  it('uses the semantic strategy when an embedding provider is configured', async () => {
    setEmbeddingProvider(local);
    const before = messages;
    const target = 20; // force compression
    const out = await compressContextIfNeeded({ messages: before, model, targetTokens: target });
    expect(out.strategy.startsWith('semantic')).toBe(true);
    expect(out.applied.some((a) => a.startsWith('semantic-dedupe'))).toBe(true);
    expect(out.after).toBeLessThan(out.before);
  });

  it('falls back to the heuristic strategy when no provider is configured', async () => {
    setEmbeddingProvider(null);
    const out = await compressContextIfNeeded({ messages, model, targetTokens: 20 });
    expect(out.strategy).toBe('heuristic');
    expect(out.after).toBeLessThan(out.before);
  });

  it('defaults to no embedding provider (heuristic) in a plain environment', async () => {
    setEmbeddingProvider(undefined); // let it recompute from config (TBM_EMBEDDING_PROVIDER unset)
    expect(getEmbeddingProvider()).toBeNull();
  });

  it('falls back to the heuristic strategy if the embedding provider throws', async () => {
    const boom: EmbeddingProvider = {
      name: 'boom',
      embed: async () => {
        throw new Error('embedding backend down');
      },
    };
    setEmbeddingProvider(boom);
    const out = await compressContextIfNeeded({ messages, model, targetTokens: 20 });
    expect(out.strategy).toBe('heuristic');
    expect(out.after).toBeLessThan(out.before);
  });

  it('does nothing when already under the token target', async () => {
    setEmbeddingProvider(local);
    const out = await compressContextIfNeeded({ messages, model, targetTokens: 100_000 });
    expect(out.strategy).toBe('none');
    expect(out.messages).toEqual(messages);
  });
});
