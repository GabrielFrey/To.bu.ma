import { z } from 'zod';

import { FunctionError, envInt, errorResponse, handleOptions, json } from '../_shared/http.ts';
import { moderateText } from '../_shared/moderation.ts';
import { sanitizeUserText } from '../_shared/prompt.ts';
import { imageProvider } from '../_shared/providers/index.ts';
import { authenticate, enforceRateLimit } from '../_shared/supabase.ts';

const BodySchema = z.object({
  topic: z.string().min(2).max(60),
  locale: z.string().max(10).default('en'),
  count: z.number().int().min(1).max(8).default(5),
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

    await enforceRateLimit(caller.userId, 'suggest', envInt('RATE_LIMIT_SUGGEST_PER_HOUR', 60));

    const topic = sanitizeUserText(parsed.data.topic, 60);
    const verdict = moderateText(topic);
    if (!verdict.allowed) {
      throw new FunctionError('moderation_blocked', verdict.reason ?? 'text_policy');
    }

    const ideas = await imageProvider().suggestIdeas({
      topic,
      locale: parsed.data.locale,
      count: parsed.data.count,
    });

    if (ideas.length === 0) {
      throw new FunctionError('provider_error', 'No ideas returned');
    }

    return json({ ideas: ideas.map((idea) => sanitizeUserText(idea, 120)) });
  } catch (error) {
    return errorResponse(error);
  }
});
