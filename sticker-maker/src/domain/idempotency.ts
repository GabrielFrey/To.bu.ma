/**
 * Credit spending is idempotent per `request_id`: the server records the id and
 * replays the previous result instead of charging twice. A retry of the *same*
 * user intent must therefore reuse the id, while a genuinely new intent must not.
 */

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    // 32-bit FNV prime multiplication without overflowing into float territory.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export type RequestScope = 'generate' | 'export';

/**
 * Deterministic id for an intent. Retrying the same export of the same stickers
 * produces the same id, so an interrupted export never double-charges.
 */
export function stableRequestId(scope: RequestScope, parts: readonly string[]): string {
  const normalized = [...parts].map((part) => part.trim().toLowerCase()).sort();
  return `${scope}_${fnv1a(normalized.join('\u0001'))}_${fnv1a(normalized.join('|').split('').reverse().join(''))}`;
}

export function exportRequestId(packId: string | null, stickerIds: readonly string[]): string {
  return stableRequestId('export', [packId ?? 'selection', ...stickerIds]);
}

export function generationRequestId(clientJobId: string): string {
  return stableRequestId('generate', [clientJobId]);
}
