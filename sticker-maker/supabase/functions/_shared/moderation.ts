import { base64Encode } from './image.ts';
import { optionalEnv } from './http.ts';

/**
 * Two gates before a photo reaches the image model:
 *  - the prompt text, which the user partially controls;
 *  - the photo itself.
 *
 * App Store guideline 1.2 expects a real filter on user generated content, and the
 * generation providers charge for refusals, so this runs first.
 */

export interface ModerationVerdict {
  allowed: boolean;
  reason?: string;
  categories?: string[];
}

const BLOCKED_TEXT_PATTERNS: RegExp[] = [
  /\bnude|naked|nsfw|porn|sex(ual)?\b/i,
  /\bnazi|swastika|isis\b/i,
  /\bkill|behead|gore|mutilat/i,
  // Public figures: generating a recognizable likeness of a real celebrity is out.
  /\b(president|prime minister|pope)\b/i,
];

export function moderateText(text: string): ModerationVerdict {
  const match = BLOCKED_TEXT_PATTERNS.find((pattern) => pattern.test(text));
  if (match) {
    return { allowed: false, reason: 'text_policy', categories: ['text'] };
  }
  return { allowed: true };
}

interface OpenAiModerationResponse {
  results?: {
    flagged?: boolean;
    categories?: Record<string, boolean>;
    category_scores?: Record<string, number>;
  }[];
}

export async function moderateImage(
  image: Uint8Array,
  mimeType: string,
): Promise<ModerationVerdict> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    // No moderation provider configured: fail open in development, but say so loudly.
    console.warn('image moderation skipped: OPENAI_API_KEY is not set');
    return { allowed: true, reason: 'moderation_unavailable' };
  }

  const threshold = Number.parseFloat(optionalEnv('MODERATION_BLOCK_THRESHOLD', '0.7'));

  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: optionalEnv('MODERATION_MODEL', 'omni-moderation-latest'),
        input: [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Encode(image)}` },
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('moderation call failed', response.status, await response.text());
      return { allowed: true, reason: 'moderation_unavailable' };
    }

    const payload = (await response.json()) as OpenAiModerationResponse;
    const result = payload.results?.[0];
    if (!result) return { allowed: true };

    const scores = result.category_scores ?? {};
    const overThreshold = Object.entries(scores)
      .filter(([, score]) => score >= threshold)
      .map(([category]) => category);

    if (result.flagged && overThreshold.length > 0) {
      return { allowed: false, reason: 'image_policy', categories: overThreshold };
    }
    return { allowed: true };
  } catch (error) {
    console.error('moderation error', error);
    return { allowed: true, reason: 'moderation_unavailable' };
  }
}
