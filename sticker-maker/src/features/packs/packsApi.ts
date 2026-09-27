import { nextPosition } from '../../domain/packs';
import type { Pack, PackSticker } from '../../domain/types';
import { supabase } from '../../lib/supabase';
import { mapSticker } from '../stickers/stickersApi';

interface PackRow {
  id: string;
  name: string;
  publisher: string;
  tray_sticker_id: string | null;
  created_at: string;
}

export async function fetchPacks(): Promise<Pack[]> {
  const { data, error } = await supabase
    .from('packs')
    .select('id, name, publisher, tray_sticker_id, created_at, pack_stickers(count)')
    .order('created_at', { ascending: false });

  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });

  return (data ?? []).map((row) => {
    const counts = row.pack_stickers as unknown as { count: number }[] | null;
    return {
      id: row.id,
      name: row.name,
      publisher: row.publisher,
      trayStickerId: row.tray_sticker_id,
      createdAt: row.created_at,
      stickerCount: counts?.[0]?.count ?? 0,
    };
  });
}

export async function fetchPack(id: string): Promise<Pack> {
  const { data, error } = await supabase
    .from('packs')
    .select('id, name, publisher, tray_sticker_id, created_at, pack_stickers(count)')
    .eq('id', id)
    .single();

  if (error) throw Object.assign(new Error(error.message), { code: 'not_found' });

  const row = data as PackRow & { pack_stickers: { count: number }[] | null };
  return {
    id: row.id,
    name: row.name,
    publisher: row.publisher,
    trayStickerId: row.tray_sticker_id,
    createdAt: row.created_at,
    stickerCount: row.pack_stickers?.[0]?.count ?? 0,
  };
}

export async function fetchPackStickers(packId: string): Promise<PackSticker[]> {
  const { data, error } = await supabase
    .from('pack_stickers')
    .select('position, stickers!inner(id, generation_id, png_path, webp_path, emojis, created_at)')
    .eq('pack_id', packId)
    .order('position', { ascending: true });

  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });

  return (data ?? []).map((row) => ({
    ...mapSticker(row.stickers as unknown as Parameters<typeof mapSticker>[0]),
    position: row.position as number,
  }));
}

export async function createPack(
  userId: string,
  name: string,
  publisher: string,
): Promise<Pack> {
  const { data, error } = await supabase
    .from('packs')
    .insert({ user_id: userId, name, publisher })
    .select('id, name, publisher, tray_sticker_id, created_at')
    .single();

  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });

  const row = data as PackRow;
  return {
    id: row.id,
    name: row.name,
    publisher: row.publisher,
    trayStickerId: row.tray_sticker_id,
    createdAt: row.created_at,
    stickerCount: 0,
  };
}

export async function renamePack(packId: string, name: string): Promise<void> {
  const { error } = await supabase.from('packs').update({ name }).eq('id', packId);
  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });
}

export async function deletePack(packId: string): Promise<void> {
  const { error } = await supabase.from('packs').delete().eq('id', packId);
  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });
}

export async function setTraySticker(packId: string, stickerId: string): Promise<void> {
  const { error } = await supabase
    .from('packs')
    .update({ tray_sticker_id: stickerId })
    .eq('id', packId);
  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });
}

/**
 * Appends after the current last position. `(pack_id, position)` is unique, so the
 * positions are read first rather than guessed from the count, which would collide after
 * a removal.
 */
export async function addStickersToPack(packId: string, stickerIds: string[]): Promise<void> {
  if (stickerIds.length === 0) return;

  const existing = await fetchPackStickers(packId);
  const alreadyIn = new Set(existing.map((sticker) => sticker.id));
  const toAdd = stickerIds.filter((id) => !alreadyIn.has(id));
  if (toAdd.length === 0) return;

  let position = nextPosition(existing);
  const rows = toAdd.map((stickerId) => ({
    pack_id: packId,
    sticker_id: stickerId,
    position: position++,
  }));

  const { error } = await supabase.from('pack_stickers').insert(rows);
  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });

  // The first sticker added becomes the tray icon so a new pack is exportable sooner.
  const pack = await fetchPack(packId);
  if (!pack.trayStickerId) {
    const firstId = toAdd[0];
    if (firstId) await setTraySticker(packId, firstId);
  }
}

export async function removeStickerFromPack(
  packId: string,
  stickerId: string,
): Promise<void> {
  const { error } = await supabase
    .from('pack_stickers')
    .delete()
    .eq('pack_id', packId)
    .eq('sticker_id', stickerId);

  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });

  const remaining = await fetchPackStickers(packId);
  await reorderPack(
    packId,
    remaining.map((sticker) => sticker.id),
  );

  const pack = await fetchPack(packId);
  if (pack.trayStickerId === stickerId) {
    const replacement = remaining[0];
    const { error: trayError } = await supabase
      .from('packs')
      .update({ tray_sticker_id: replacement?.id ?? null })
      .eq('id', packId);
    if (trayError) {
      throw Object.assign(new Error(trayError.message), { code: 'internal_error' });
    }
  }
}

/**
 * The whole order is written by one SECURITY DEFINER function: positions are unique per
 * pack, so updating them row by row would collide halfway through a reorder.
 */
export async function reorderPack(packId: string, stickerIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_pack_stickers', {
    p_pack_id: packId,
    p_sticker_ids: stickerIds,
  });

  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });
}
