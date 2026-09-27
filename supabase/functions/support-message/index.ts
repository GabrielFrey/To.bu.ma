import { z } from 'zod';

import { FunctionError, errorResponse, handleOptions, json } from '../_shared/http.ts';
import { sanitizeUserText } from '../_shared/prompt.ts';
import { authenticate, enforceRateLimit, serviceClient } from '../_shared/supabase.ts';

/**
 * In-app support contact (App Store guideline 1.2 wants a reachable channel). The
 * diagnostics blob is attached automatically so users do not have to describe their
 * build; it deliberately contains no photos and no tokens.
 */
const BodySchema = z.object({
  subject: z.string().min(2).max(120),
  body: z.string().min(5).max(4000),
  diagnostics: z
    .object({
      appVersion: z.string().max(40).optional(),
      buildNumber: z.string().max(40).optional(),
      platform: z.string().max(20).optional(),
      osVersion: z.string().max(40).optional(),
      locale: z.string().max(10).optional(),
      lastGenerationId: z.string().max(64).optional(),
      lastErrorCode: z.string().max(64).optional(),
    })
    .default({}),
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

    await enforceRateLimit(caller.userId, 'support', 10);

    const { error } = await serviceClient()
      .from('support_messages')
      .insert({
        user_id: caller.userId,
        subject: sanitizeUserText(parsed.data.subject, 120),
        body: parsed.data.body.slice(0, 4000),
        diagnostics: parsed.data.diagnostics,
      });

    if (error) {
      throw new FunctionError('internal_error', error.message);
    }

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
});
