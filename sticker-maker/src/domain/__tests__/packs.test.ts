import { nextPosition, reorderStickers, validatePackForTarget } from '../packs';
import type { PackSticker } from '../types';

function sticker(id: string, position: number, webp: string | null = `w/${id}`): PackSticker {
  return {
    id,
    generationId: null,
    pngPath: `p/${id}`,
    webpPath: webp,
    emojis: ['😄'],
    createdAt: '2026-01-01T00:00:00.000Z',
    position,
  };
}

const three = [sticker('a', 0), sticker('b', 1), sticker('c', 2)];

describe('validatePackForTarget - whatsapp', () => {
  it('accepts a complete pack', () => {
    const result = validatePackForTarget(
      { name: 'Team', trayStickerId: 'a', stickers: three },
      'whatsapp',
    );
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('blocks a pack below the three sticker minimum and says how many are missing', () => {
    const result = validatePackForTarget(
      { name: 'Team', trayStickerId: 'a', stickers: three.slice(0, 1) },
      'whatsapp',
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      code: 'too_few_stickers',
      meta: { required: 3, missing: 2 },
    });
  });

  it('blocks a pack over thirty stickers', () => {
    const many = Array.from({ length: 31 }, (_, index) => sticker(`s${index}`, index));
    const result = validatePackForTarget(
      { name: 'Team', trayStickerId: 's0', stickers: many },
      'whatsapp',
    );
    expect(result.issues).toContainEqual({
      code: 'too_many_stickers',
      meta: { max: 30, over: 1 },
    });
  });

  it('requires a tray icon and server side webp files', () => {
    const result = validatePackForTarget(
      { name: 'Team', trayStickerId: null, stickers: [...three.slice(0, 2), sticker('c', 2, null)] },
      'whatsapp',
    );
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['missing_tray_icon', 'missing_webp']),
    );
  });

  it('rejects an empty or overlong name', () => {
    expect(
      validatePackForTarget({ name: '   ', trayStickerId: 'a', stickers: three }, 'whatsapp').issues,
    ).toContainEqual({ code: 'empty_name' });
    expect(
      validatePackForTarget({ name: 'n'.repeat(40), trayStickerId: 'a', stickers: three }, 'whatsapp')
        .issues,
    ).toContainEqual({ code: 'name_too_long', meta: { max: 32 } });
  });
});

describe('validatePackForTarget - other targets', () => {
  it('lets a single sticker go to Telegram, the gallery and the share sheet', () => {
    const one = { name: 'One', trayStickerId: null, stickers: [sticker('a', 0)] };
    expect(validatePackForTarget(one, 'telegram').valid).toBe(true);
    expect(validatePackForTarget(one, 'gallery').valid).toBe(true);
    expect(validatePackForTarget(one, 'share').valid).toBe(true);
  });

  it('still refuses to export nothing', () => {
    const empty = { name: 'Empty', trayStickerId: null, stickers: [] };
    expect(validatePackForTarget(empty, 'gallery').valid).toBe(false);
    expect(validatePackForTarget(empty, 'imessage').valid).toBe(false);
  });
});

describe('reorderStickers', () => {
  it('moves a sticker and reindexes positions without gaps', () => {
    const result = reorderStickers(three, 0, 2);
    expect(result.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(result.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  it('normalizes positions even when the move is a no-op or out of range', () => {
    const shuffled = [sticker('a', 5), sticker('b', 9)];
    expect(reorderStickers(shuffled, 1, 1).map((item) => item.position)).toEqual([0, 1]);
    expect(reorderStickers(shuffled, 0, 99).map((item) => item.position)).toEqual([0, 1]);
  });
});

describe('nextPosition', () => {
  it('appends after the highest position', () => {
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([sticker('a', 0), sticker('b', 7)])).toBe(8);
  });
});
