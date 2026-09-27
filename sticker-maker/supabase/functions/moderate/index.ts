import { z } from 'zod';

import { FunctionError, errorResponse, handleOptions, json } from '../_shared/http.ts';
import { moderateImage, moderateText } from '../_shared/moderation.ts';
import { sanitizeUserText } from '../_shared/prompt.ts';
import { authenticate, enforceRateLimit, serviceClient } from '../_shared/supabase.ts';

/**
 * Pre-flight check the app runs right after the photo is uploaded and before a credit
 * is spent, so a rejected photo costs the user nothing. `generate-sticker` repeats the
 * check server-side — this endpoint is a courtesy, not the enforcement point.
 */
const BodySchema = z.object({
  sourcePath: z.string().min(3).max(300),
  text: z.string().max(400).nullish(),
});

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;

  try {
    const caller = await authenticate(request);
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new FunctionError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid body');
    }
    if (!parsed.data.sourcePath.startsWith(`${caller.userId}/`)) {
      throw new FunctionError('forbidden', 'sourcePath does not belong to the caller');
    }

    await enforceRateLimit(caller.userId, 'moderate', 60);

    const textVerdict = moderateText(sanitizeUserText(parsed.data.text, 400));
    if (!textVerdict.allowed) {
      return json({ allowed: false, reason: textVerdict.reason, categories: textVerdict.categories });
    }

    const service = serviceClient();
    const { data, error } = await service.storage.from('sources').download(parsed.data.sourcePath);
    if (error || !data) {
      throw new FunctionError('invalid_image', 'Source image not found');
    }

    const verdict = await moderateImage(
      new Uint8Array(await data.arrayBuffer()),
      data.type || 'image/jpeg',
    );

    return json({
      allowed: verdict.allowed,
      reason: verdict.reason,
      categories: verdict.categories,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
