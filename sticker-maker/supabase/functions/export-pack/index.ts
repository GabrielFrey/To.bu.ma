import { z } from 'zod';

import { FunctionError, errorResponse, handleOptions, json } from '../_shared/http.ts';
import { base64Encode, toPngThumbnail } from '../_shared/image.ts';
import { authenticate, serviceClient } from '../_shared/supabase.ts';

/**
 * Builds the payload the native module hands to WhatsApp or Telegram. It deliberately
 * does NOT charge credits: the app charges through `consume_credits` only after the
 * hand-off actually succeeded, so a user who backs out of WhatsApp keeps their credits.
 * The request id is derived from the sticker set, so a retry cannot double charge.
 */

const BodySchema = z.object({
  packId: z.string().uuid(),
  target: z.enum(['whatsapp', 'telegram']),
});

const WHATSAPP_MIN = 3;
const WHATSAPP_MAX = 30;

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;

  try {
    const caller = await authenticate(request);
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new FunctionError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid body');
    }
    const { packId, target } = parsed.data;

    const service = serviceClient();

    const { data: pack, error: packError } = await service
      .from('packs')
      .select('id, user_id, name, publisher, tray_sticker_id')
      .eq('id', packId)
      .maybeSingle();

    if (packError) throw new FunctionError('internal_error', packError.message);
    if (!pack) throw new FunctionError('not_found', 'Pack not found');
    if (pack.user_id !== caller.userId) throw new FunctionError('forbidden', 'Not your pack');

    const { data: rows, error: rowsError } = await service
      .from('pack_stickers')
      .select('position, stickers!inner(id, png_path, webp_path, emojis)')
      .eq('pack_id', packId)
      .order('position', { ascending: true });

    if (rowsError) throw new FunctionError('internal_error', rowsError.message);

    const stickers = (rows ?? []).map((row) => {
      const sticker = row.stickers as unknown as {
        id: string;
        png_path: string;
        webp_path: string | null;
        emojis: string[];
      };
      return { position: row.position as number, ...sticker };
    });

    if (target === 'whatsapp') {
      if (stickers.length < WHATSAPP_MIN || stickers.length > WHATSAPP_MAX) {
        throw new FunctionError(
          'invalid_request',
          `WhatsApp accepts ${WHATSAPP_MIN}-${WHATSAPP_MAX} stickers, this pack has ${stickers.length}`,
        );
      }
      if (!pack.tray_sticker_id) {
        throw new FunctionError('invalid_request', 'Pack has no tray icon');
      }
    }
    if (stickers.length === 0) {
      throw new FunctionError('invalid_request', 'Pack is empty');
    }

    const encoded = await Promise.all(
      stickers.map(async (sticker) => {
        const path = target === 'whatsapp' ? sticker.webp_path : (sticker.webp_path ?? sticker.png_path);
        if (!path) {
          throw new FunctionError('invalid_request', `Sticker ${sticker.id} has no webp file yet`);
        }
        const bytes = await downloadBytes(service, path);
        return {
          id: sticker.id,
          data: base64Encode(bytes),
          mimeType: path.endsWith('.webp') ? 'image/webp' : 'image/png',
          emojis: (sticker.emojis ?? []).slice(0, 3),
        };
      }),
    );

    const stickerIds = stickers.map((sticker) => sticker.id);

    if (target === 'telegram') {
      const thumbnailSource = encoded[0];
      return json({
        target,
        stickerIds,
        payload: {
          software: 'Sticker Studio',
          isAnimated: false,
          thumbnailData: thumbnailSource ? thumbnailSource.data : undefined,
          stickers: encoded.map((sticker) => ({
            data: sticker.data,
            mimeType: sticker.mimeType,
            emojis: sticker.emojis,
          })),
        },
      });
    }

    const trayStickerPath = stickers.find((sticker) => sticker.id === pack.tray_sticker_id)?.png_path;
    if (!trayStickerPath) {
      throw new FunctionError('invalid_request', 'Tray sticker is not part of the pack');
    }
    const trayBytes = await toPngThumbnail(await downloadBytes(service, trayStickerPath), 96);

    return json({
      target,
      stickerIds,
      payload: {
        identifier: pack.id,
        name: pack.name,
        publisher: pack.publisher,
        trayImageData: base64Encode(trayBytes),
        stickers: encoded.map((sticker) => ({
          imageData: sticker.data,
          emojis: sticker.emojis,
        })),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
});

async function downloadBytes(
  service: ReturnType<typeof serviceClient>,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await service.storage.from('stickers').download(path);
  if (error || !data) {
    throw new FunctionError('not_found', `Missing sticker file ${path}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}
