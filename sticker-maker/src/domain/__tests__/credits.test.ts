import { applyDelta, canAfford, exportCost, generationCost, isOutOfCredits } from '../credits';
import type { CreditBalance } from '../types';

const balance: CreditBalance = { generation: 2, export: 1 };

describe('credit arithmetic', () => {
  it('charges one credit per generation', () => {
    expect(generationCost()).toBe(1);
  });

  it('charges per sticker on export', () => {
    expect(exportCost(0)).toBe(0);
    expect(exportCost(5)).toBe(5);
  });

  it('rejects nonsensical sticker counts instead of charging garbage', () => {
    expect(() => exportCost(-1)).toThrow(RangeError);
    expect(() => exportCost(1.5)).toThrow(RangeError);
  });

  it('reports exactly how many credits are missing', () => {
    expect(canAfford(balance, 'generation', 1)).toEqual({
      affordable: true,
      cost: 1,
      missing: 0,
    });
    expect(canAfford(balance, 'export', 4)).toEqual({
      affordable: false,
      cost: 4,
      missing: 3,
    });
  });

  it('never lets an optimistic update drive a balance negative', () => {
    expect(applyDelta(balance, 'export', -5)).toEqual({ generation: 2, export: 0 });
    expect(applyDelta(balance, 'generation', 3)).toEqual({ generation: 5, export: 1 });
  });

  it('detects an empty bucket per kind', () => {
    expect(isOutOfCredits({ generation: 0, export: 4 }, 'generation')).toBe(true);
    expect(isOutOfCredits({ generation: 0, export: 4 }, 'export')).toBe(false);
  });
});
