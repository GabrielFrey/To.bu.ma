import { z } from 'zod';

import { FunctionError, envInt, errorResponse, handleOptions, json } from '../_shared/http.ts';
import { normalizeSticker } from '../_shared/image.ts';
import { moderateImage, moderateText } from '../_shared/moderation.ts';
import { buildPrompt } from '../_shared/prompt.ts';
import { imageProvider } from '../_shared/providers/index.ts';
import { sendStickerReadyPush } from '../_shared/push.ts';
import { authenticate, consumeCredits, enforceRateLimit, serviceClient } from '../_shared/supabase.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const BodySchema = z.object({
  requestId: z.string().min(8).max(120),
  sourcePath: z.string().min(3).max(300),
  emotionId: z.string().max(60).nullish(),
  customIdea: z.string().max(255).nullish(),
  stickerText: z.string().max(60).nullish(),
  additionalInstructions: z.string().max(400).nullish(),
  locale: z.string().max(10).default('en'),
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
    const body = parsed.data;

    // The source path must belong to the caller: the storage policy enforces it too,
    // but checking here keeps the error understandable.
    if (!body.sourcePath.startsWith(`${caller.userId}/`)) {
      throw new FunctionError('forbidden', 'sourcePath does not belong to the caller');
    }

    await enforceRateLimit(caller.userId, 'generate', envInt('RATE_LIMIT_GENERATE_PER_HOUR', 30));

    const built = buildPrompt(body);
    const textVerdict = moderateText(
      [body.customIdea, built.stickerText, built.additionalInstructions].filter(Boolean).join(' '),
    );
    if (!textVerdict.allowed) {
      throw new FunctionError('moderation_blocked', textVerdict.reason ?? 'text_policy');
    }

    const service = serviceClient();

    // A retried request must return the original job instead of starting a second one.
    const { data: existing } = await service
      .from('generations')
      .select('id, status')
      .eq('user_id', caller.userId)
      .eq('request_id', body.requestId)
      .maybeSingle();

    if (existing) {
      return json({ generationId: existing.id, status: existing.status, replayed: true });
    }

    const credits = await consumeCredits(caller.client, 'generation', 1, body.requestId);

    const { data: generation, error: insertError } = await service
      .from('generations')
      .insert({
        user_id: caller.userId,
        status: 'queued',
        source_path: body.sourcePath,
        emotion: built.emotionId,
        sticker_text: built.stickerText,
        additional_instructions: built.additionalInstructions,
        prompt: built.prompt,
        request_id: body.requestId,
      })
      .select('id')
      .single();

    if (insertError || !generation) {
      throw new FunctionError('internal_error', insertError?.message ?? 'Could not queue the job');
    }

    const work = runGeneration({
      generationId: generation.id,
      userId: caller.userId,
      sourcePath: body.sourcePath,
      prompt: built.prompt,
      emojis: built.stickerEmojis,
      locale: body.locale,
    });

    // Answer immediately: the app watches the row over Realtime and gets a push.
    if (typeof EdgeRuntime !== 'undefined') {
      EdgeRuntime.waitUntil(work);
    } else {
      void work;
    }

    return json({
      generationId: generation.id,
      status: 'queued',
      credits: {
        generation: credits.generationCredits,
        export: credits.exportCredits,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
});

interface GenerationJob {
  generationId: string;
  userId: string;
  sourcePath: string;
  prompt: string;
  emojis: string[];
  locale: string;
}

async function runGeneration(job: GenerationJob): Promise<void> {
  const service = serviceClient();

  const fail = async (code: string) => {
    await service
      .from('generations')
      .update({ status: 'failed', error_code: code, completed_at: new Date().toISOString() })
      .eq('id', job.generationId);
    // The user keeps the credit: a failure is ours, not theirs.
    await service.rpc('refund_generation', { p_generation_id: job.generationId });
    await notify(service, job, true);
  };

  try {
    await service.from('generations').update({ status: 'running' }).eq('id', job.generationId);

    const download = await service.storage.from('sources').download(job.sourcePath);
    if (download.error || !download.data) {
      await fail('invalid_image');
      return;
    }
    const sourceBytes = new Uint8Array(await download.data.arrayBuffer());
    const sourceMime = download.data.type || 'image/jpeg';

    const imageVerdict = await moderateImage(sourceBytes, sourceMime);
    if (!imageVerdict.allowed) {
      await fail('moderation_blocked');
      return;
    }

    const provider = imageProvider();
    const result = await provider.generate({
      image: sourceBytes,
      imageMimeType: sourceMime,
      prompt: job.prompt,
    });

    const normalized = await normalizeSticker(result.png);

    const base = `${job.userId}/${job.generationId}`;
    const uploads = await Promise.all([
      service.storage
        .from('stickers')
        .upload(`${base}.png`, normalized.png, { contentType: 'image/png', upsert: true }),
      service.storage
        .from('stickers')
        .upload(`${base}.webp`, normalized.webp, { contentType: 'image/webp', upsert: true }),
      service.storage
        .from('stickers')
        .upload(`${base}_tray.png`, normalized.tray, { contentType: 'image/png', upsert: true }),
    ]);

    const failedUpload = uploads.find((upload) => upload.error);
    if (failedUpload?.error) {
      console.error('sticker upload failed', failedUpload.error.message);
      await fail('provider_error');
      return;
    }

    const { error: stickerError } = await service.from('stickers').insert({
      user_id: job.userId,
      generation_id: job.generationId,
      png_path: `${base}.png`,
      webp_path: `${base}.webp`,
      emojis: job.emojis,
    });
    if (stickerError) {
      console.error('sticker row insert failed', stickerError.message);
      await fail('provider_error');
      return;
    }

    await service
      .from('generations')
      .update({
        status: 'done',
        provider: result.provider,
        model: result.model,
        result_path: `${base}.png`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.generationId);

    await notify(service, job, false);
  } catch (error) {
    console.error('generation failed', error);
    const code =
      error instanceof FunctionError && error.code === 'provider_timeout'
        ? 'provider_timeout'
        : error instanceof FunctionError && error.code === 'moderation_blocked'
          ? 'moderation_blocked'
          : 'provider_error';
    await fail(code);
  }
}

async function notify(
  service: ReturnType<typeof serviceClient>,
  job: GenerationJob,
  failed: boolean,
): Promise<void> {
  const { data: profile } = await service
    .from('profiles')
    .select('push_token, locale')
    .eq('id', job.userId)
    .maybeSingle();

  if (!profile?.push_token) return;

  await sendStickerReadyPush({
    pushToken: profile.push_token,
    generationId: job.generationId,
    locale: profile.locale ?? job.locale,
    failed,
  });
}
