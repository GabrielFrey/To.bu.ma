import { exportRequestId, generationRequestId, stableRequestId } from '../idempotency';

describe('request ids', () => {
  it('is stable for the same intent so a retry does not double charge', () => {
    expect(exportRequestId('pack-1', ['a', 'b'])).toBe(exportRequestId('pack-1', ['a', 'b']));
  });

  it('ignores sticker ordering, because the charge is the same', () => {
    expect(exportRequestId('pack-1', ['a', 'b'])).toBe(exportRequestId('pack-1', ['b', 'a']));
  });

  it('differs when the stickers differ', () => {
    expect(exportRequestId('pack-1', ['a', 'b'])).not.toBe(exportRequestId('pack-1', ['a', 'c']));
  });

  it('differs when the pack differs', () => {
    expect(exportRequestId('pack-1', ['a'])).not.toBe(exportRequestId('pack-2', ['a']));
  });

  it('separates scopes so an export id can never satisfy a generation charge', () => {
    expect(stableRequestId('export', ['x'])).not.toBe(stableRequestId('generate', ['x']));
    expect(generationRequestId('job-1')).toMatch(/^generate_/);
  });

  it('treats a selection without a pack as its own scope key', () => {
    expect(exportRequestId(null, ['a'])).not.toBe(exportRequestId('selection-pack', ['a']));
  });
});
