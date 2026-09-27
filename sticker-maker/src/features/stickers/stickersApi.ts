import { LIMITS } from '../../domain/limits';
import type { Sticker } from '../../domain/types';
import { removeFromCache } from '../../lib/fileCache';
import { supabase } from '../../lib/supabase';

const STICKER_COLUMNS = 'id, generation_id, png_path, webp_path, emojis, created_at';

interface StickerRow {
  id: string;
  generation_id: string | null;
  png_path: string;
  webp_path: string | null;
  emojis: string[] | null;
  created_at: string;
}

export function mapSticker(row: StickerRow): Sticker {
  return {
    id: row.id,
    generationId: row.generation_id,
    pngPath: row.png_path,
    webpPath: row.webp_path,
    emojis: row.emojis ?? [],
    createdAt: row.created_at,
  };
}

export interface StickerPage {
  stickers: Sticker[];
  /** `created_at` of the last row; `null` when the end is reached. */
  nextCursor: string | null;
}

/**
 * Keyset pagination on `created_at` instead of offset: the library grows at the top while
 * the user scrolls, and an offset would silently repeat or skip rows.
 */
export async function fetchStickerPage(cursor: string | null): Promise<StickerPage> {
  let query = supabase
    .from('stickers')
    .select(STICKER_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(LIMITS.libraryPageSize);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;
  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });

  const stickers = (data as StickerRow[]).map(mapSticker);
  const last = stickers[stickers.length - 1];

  return {
    stickers,
    nextCursor: stickers.length === LIMITS.libraryPageSize && last ? last.createdAt : null,
  };
}

export async function fetchSticker(id: string): Promise<Sticker> {
  const { data, error } = await supabase
    .from('stickers')
    .select(STICKER_COLUMNS)
    .eq('id', id)
    .single();

  if (error) throw Object.assign(new Error(error.message), { code: 'not_found' });
  return mapSticker(data as StickerRow);
}

export async function fetchStickersByIds(ids: string[]): Promise<Sticker[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('stickers')
    .select(STICKER_COLUMNS)
    .in('id', ids);

  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });

  const byId = new Map((data as StickerRow[]).map((row) => [row.id, mapSticker(row)]));
  // Preserve the caller's order: an export payload is order-sensitive.
  return ids.flatMap((id) => {
    const sticker = byId.get(id);
    return sticker ? [sticker] : [];
  });
}

/**
 * Deletes the rows first, because that is what makes the sticker disappear from the
 * library and from every pack, then the files. If the file cleanup fails the user sees a
 * consistent app and only some bytes are left behind, which is the better failure.
 */
export async function deleteStickers(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { data, error } = await supabase
    .from('stickers')
    .delete()
    .in('id', ids)
    .select('png_path, webp_path');

  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });

  const paths = (data ?? []).flatMap((row) => {
    const png = row.png_path;
    const derivedTray = png.replace(/\.png$/, '_tray.png');
    return [png, row.webp_path, derivedTray].filter(
      (path): path is string => typeof path === 'string',
    );
  });

  if (paths.length > 0) {
    await supabase.storage.from('stickers').remove(paths);
    await Promise.all(paths.map((path) => removeFromCache(path).catch(() => undefined)));
  }
}
