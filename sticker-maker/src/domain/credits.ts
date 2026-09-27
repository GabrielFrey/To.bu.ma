import { COSTS } from './limits';
import type { CreditBalance, CreditKind } from './types';

export interface AffordabilityResult {
  affordable: boolean;
  cost: number;
  missing: number;
}

export function generationCost(): number {
  return COSTS.generation;
}

export function exportCost(stickerCount: number): number {
  if (!Number.isInteger(stickerCount) || stickerCount < 0) {
    throw new RangeError(`stickerCount must be a non-negative integer, got ${stickerCount}`);
  }
  return stickerCount * COSTS.exportPerSticker;
}

export function canAfford(
  balance: CreditBalance,
  kind: CreditKind,
  cost: number,
): AffordabilityResult {
  const available = kind === 'generation' ? balance.generation : balance.export;
  const missing = Math.max(0, cost - available);
  return { affordable: missing === 0, cost, missing };
}

/**
 * Mirrors the server-side ledger rule: the balance is always the sum of deltas, so
 * an optimistic client update must use the same arithmetic to avoid drift.
 */
export function applyDelta(balance: CreditBalance, kind: CreditKind, delta: number): CreditBalance {
  const next: CreditBalance = { ...balance };
  if (kind === 'generation') {
    next.generation = Math.max(0, balance.generation + delta);
  } else {
    next.export = Math.max(0, balance.export + delta);
  }
  return next;
}

export function isOutOfCredits(balance: CreditBalance, kind: CreditKind): boolean {
  return (kind === 'generation' ? balance.generation : balance.export) <= 0;
}
