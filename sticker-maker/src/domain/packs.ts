import { LIMITS } from './limits';
import type { ExportTarget, PackSticker } from './types';

export type PackValidationCode =
  | 'too_few_stickers'
  | 'too_many_stickers'
  | 'missing_tray_icon'
  | 'missing_webp'
  | 'name_too_long'
  | 'empty_name';

export interface PackValidationIssue {
  code: PackValidationCode;
  /** Numbers the UI needs for an interpolated message, e.g. "3 more stickers needed". */
  meta?: Record<string, number>;
}

export interface PackValidationResult {
  valid: boolean;
  issues: PackValidationIssue[];
}

export interface PackForValidation {
  name: string;
  trayStickerId: string | null;
  stickers: PackSticker[];
}

export function validatePackForTarget(
  pack: PackForValidation,
  target: ExportTarget,
): PackValidationResult {
  const issues: PackValidationIssue[] = [];
  const name = pack.name.trim();

  if (name.length === 0) {
    issues.push({ code: 'empty_name' });
  }
  if (name.length > LIMITS.packNameMaxLength) {
    issues.push({ code: 'name_too_long', meta: { max: LIMITS.packNameMaxLength } });
  }

  if (target === 'whatsapp') {
    const { minStickers, maxStickers } = LIMITS.whatsapp;
    if (pack.stickers.length < minStickers) {
      issues.push({
        code: 'too_few_stickers',
        meta: { required: minStickers, missing: minStickers - pack.stickers.length },
      });
    }
    if (pack.stickers.length > maxStickers) {
      issues.push({
        code: 'too_many_stickers',
        meta: { max: maxStickers, over: pack.stickers.length - maxStickers },
      });
    }
    if (!pack.trayStickerId) {
      issues.push({ code: 'missing_tray_icon' });
    }
    if (pack.stickers.some((sticker) => !sticker.webpPath)) {
      issues.push({
        code: 'missing_webp',
        meta: { count: pack.stickers.filter((sticker) => !sticker.webpPath).length },
      });
    }
  }

  if (target === 'telegram' && pack.stickers.length > LIMITS.telegram.maxStickers) {
    issues.push({
      code: 'too_many_stickers',
      meta: { max: LIMITS.telegram.maxStickers },
    });
  }

  if (
    (target === 'gallery' || target === 'share' || target === 'imessage') &&
    pack.stickers.length === 0
  ) {
    issues.push({ code: 'too_few_stickers', meta: { required: 1, missing: 1 } });
  }

  return { valid: issues.length === 0, issues };
}

/** Reindexes positions after a drag so the server never stores gaps or duplicates. */
export function reorderStickers(
  stickers: PackSticker[],
  fromIndex: number,
  toIndex: number,
): PackSticker[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= stickers.length ||
    toIndex >= stickers.length
  ) {
    return stickers.map((sticker, index) => ({ ...sticker, position: index }));
  }
  const next = [...stickers];
  const [moved] = next.splice(fromIndex, 1);
  if (moved) {
    next.splice(toIndex, 0, moved);
  }
  return next.map((sticker, index) => ({ ...sticker, position: index }));
}

export function nextPosition(stickers: PackSticker[]): number {
  return stickers.reduce((max, sticker) => Math.max(max, sticker.position + 1), 0);
}
