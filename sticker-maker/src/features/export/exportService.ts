import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

import {
  isAppInstalled,
  sendPackToTelegram,
  sendPackToWhatsApp,
  copyStickersToAppGroup,
  type NativePackPayload,
  type TelegramPackPayload,
} from '../../../modules/sticker-export';
import { env } from '../../config/env';
import { exportCost } from '../../domain/credits';
import { exportRequestId } from '../../domain/idempotency';
import type { ExportTarget, Sticker } from '../../domain/types';
import { track } from '../../lib/observability';
import { localStickerUri } from '../../lib/storage';
import { invokeEdgeFunction, supabase } from '../../lib/supabase';

export type ExportOutcome = 'exported' | 'cancelled' | 'fell_back_to_share';

export interface ExportResult {
  outcome: ExportOutcome;
  target: ExportTarget;
  stickerCount: number;
  /** Credits actually spent; zero when the user backed out. */
  creditsCharged: number;
}

export interface ExportInput {
  target: ExportTarget;
  /** Required for WhatsApp and Telegram: those targets install a whole pack. */
  packId: string | null;
  stickers: Sticker[];
}

/**
 * Credits are charged *after* the hand-off succeeded, never before.
 *
 * The user-visible rule is "you pay for stickers that left the app". Backing out of the
 * WhatsApp confirmation sheet, or dismissing the share sheet, must cost nothing. The
 * request id is derived from the sticker set, so if the charge call itself is retried the
 * server replays the first result instead of charging twice.
 */
export async function runExport(input: ExportInput): Promise<ExportResult> {
  const { target, packId, stickers } = input;

  if (stickers.length === 0) {
    throw Object.assign(new Error('Nothing to export'), { code: 'invalid_request' });
  }

  track('export_started', { target, count: stickers.length });

  const outcome = await handOff(input);

  if (outcome === 'cancelled') {
    track('export_cancelled', { target });
    return { outcome, target, stickerCount: stickers.length, creditsCharged: 0 };
  }

  const cost = exportCost(stickers.length);
  await chargeExport({
    packId,
    stickerIds: stickers.map((sticker) => sticker.id),
    cost,
  });

  // The first successful export unlocks a small bonus; the RPC is one-shot per user.
  await supabase.rpc('claim_first_export_bonus');

  track('export_succeeded', { target, count: stickers.length, credits: cost });
  return { outcome, target, stickerCount: stickers.length, creditsCharged: cost };
}

async function handOff({ target, packId, stickers }: ExportInput): Promise<ExportOutcome> {
  switch (target) {
    case 'gallery':
      return saveToPhotos(stickers);
    case 'share':
      return shareSticker(stickers);
    case 'imessage':
      return addToMessages(stickers);
    case 'whatsapp':
      return sendToWhatsApp(requirePackId(packId));
    case 'telegram':
      return sendToTelegram(requirePackId(packId));
  }
}

function requirePackId(packId: string | null): string {
  if (!packId) {
    throw Object.assign(new Error('This target needs a pack'), { code: 'invalid_request' });
  }
  return packId;
}

async function saveToPhotos(stickers: Sticker[]): Promise<ExportOutcome> {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) {
    throw Object.assign(new Error('Photo library write permission denied'), {
      code: 'photo_permission',
    });
  }

  for (const sticker of stickers) {
    const uri = await localStickerUri(sticker.pngPath);
    await MediaLibrary.saveToLibraryAsync(uri);
  }

  return 'exported';
}

/**
 * The iOS share sheet takes a single file, so this target is offered for one sticker at a
 * time; multiple stickers go to Photos or into a pack instead.
 */
async function shareSticker(stickers: Sticker[]): Promise<ExportOutcome> {
  if (!(await Sharing.isAvailableAsync())) {
    throw Object.assign(new Error('Sharing is unavailable'), { code: 'forbidden' });
  }

  const first = stickers[0];
  if (!first) {
    throw Object.assign(new Error('Nothing to share'), { code: 'invalid_request' });
  }

  const uri = await localStickerUri(first.pngPath);
  await Sharing.shareAsync(uri, {
    mimeType: 'image/png',
    UTI: 'public.png',
  });

  // iOS never reports whether the user actually sent it, so the hand-off counts as done.
  return 'exported';
}

async function addToMessages(stickers: Sticker[]): Promise<ExportOutcome> {
  const uris = await Promise.all(
    stickers.map((sticker) => localStickerUri(sticker.pngPath)),
  );
  await copyStickersToAppGroup(env.appGroup, uris);
  return 'exported';
}

async function sendToWhatsApp(packId: string): Promise<ExportOutcome> {
  if (!isAppInstalled('whatsapp')) {
    throw Object.assign(new Error('WhatsApp is not installed'), { code: 'app_not_installed' });
  }

  const response = await invokeEdgeFunction<{
    target: 'whatsapp';
    stickerIds: string[];
    payload: NativePackPayload;
  }>('export-pack', { packId, target: 'whatsapp' });

  const accepted = await sendPackToWhatsApp(response.payload);
  return accepted ? 'exported' : 'cancelled';
}

async function sendToTelegram(packId: string): Promise<ExportOutcome> {
  if (!isAppInstalled('telegram')) {
    throw Object.assign(new Error('Telegram is not installed'), { code: 'app_not_installed' });
  }

  const response = await invokeEdgeFunction<{
    target: 'telegram';
    stickerIds: string[];
    payload: TelegramPackPayload;
  }>('export-pack', { packId, target: 'telegram' });

  const accepted = await sendPackToTelegram(response.payload);
  if (accepted) return 'exported';

  // Telegram's import URL is undocumented and version dependent. Rather than telling the
  // user it failed, fall back to the share sheet with the first sticker.
  const firstSticker = response.payload.stickers[0];
  if (!firstSticker || !(await Sharing.isAvailableAsync())) {
    return 'cancelled';
  }

  const path = `${FileSystem.cacheDirectory ?? ''}telegram-fallback.webp`;
  await FileSystem.writeAsStringAsync(path, firstSticker.data, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await Sharing.shareAsync(path, { mimeType: firstSticker.mimeType });

  return 'fell_back_to_share';
}

interface ChargeInput {
  packId: string | null;
  stickerIds: string[];
  cost: number;
}

async function chargeExport({ packId, stickerIds, cost }: ChargeInput): Promise<void> {
  const { error } = await supabase.rpc('consume_credits', {
    p_kind: 'export',
    p_amount: cost,
    p_request_id: exportRequestId(packId, stickerIds),
    p_ref_type: packId ? 'pack' : 'selection',
    p_ref_id: packId,
  });

  if (error) {
    const insufficient = /insufficient_credits/.test(error.message);
    throw Object.assign(new Error(error.message), {
      code: insufficient ? 'insufficient_credits' : 'internal_error',
    });
  }
}

export interface TargetAvailability {
  target: ExportTarget;
  available: boolean;
  /** Set when the target exists but cannot be used right now. */
  reason?: 'app_not_installed' | 'needs_pack' | 'single_sticker_only';
}

/** Drives the export sheet: a target the user cannot complete is shown disabled, not hidden. */
export function availableTargets(packId: string | null, stickerCount: number): TargetAvailability[] {
  return [
    { target: 'gallery', available: stickerCount > 0 },
    {
      target: 'whatsapp',
      available: packId !== null && isAppInstalled('whatsapp'),
      ...(packId === null
        ? { reason: 'needs_pack' as const }
        : isAppInstalled('whatsapp')
          ? {}
          : { reason: 'app_not_installed' as const }),
    },
    {
      target: 'telegram',
      available: packId !== null && isAppInstalled('telegram'),
      ...(packId === null
        ? { reason: 'needs_pack' as const }
        : isAppInstalled('telegram')
          ? {}
          : { reason: 'app_not_installed' as const }),
    },
    {
      target: 'share',
      available: stickerCount === 1,
      ...(stickerCount === 1 ? {} : { reason: 'single_sticker_only' as const }),
    },
    { target: 'imessage', available: stickerCount > 0 },
  ];
}
