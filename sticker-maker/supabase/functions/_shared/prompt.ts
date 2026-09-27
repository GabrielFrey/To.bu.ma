import emotions from './emotions.json' with { type: 'json' };

import { FunctionError } from './http.ts';

/**
 * The prompt the model sees is always rebuilt here. The client sends an emotion id and
 * its own text; it never sends a finished prompt, so a patched client cannot steer the
 * model past the moderation rules baked into the base style.
 */

interface EmotionPreset {
  id: string;
  prompt: string;
  stickerEmojis: string[];
}

const PRESETS = emotions as EmotionPreset[];

const STICKER_TEXT_MAX = 24;
const INSTRUCTIONS_MAX = 255;

const BASE_STYLE = [
  'Turn the person or pet in the reference photo into a die-cut messaging sticker.',
  'Keep the subject clearly recognizable: preserve face shape, hair, skin tone and distinctive features.',
  'Bold clean outline, vivid colors, subtle shading, centered composition, full body or bust.',
  'Fully transparent background, no drop shadow on the background, no frame, no watermark.',
].join(' ');

export function sanitizeUserText(value: string | null | undefined, maxLength: number): string {
  if (!value) return '';
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[`{}<>|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export interface PromptInput {
  emotionId?: string | null;
  customIdea?: string | null;
  stickerText?: string | null;
  additionalInstructions?: string | null;
}

export interface BuiltPrompt {
  prompt: string;
  emotionId: string | null;
  stickerText: string | null;
  additionalInstructions: string | null;
  stickerEmojis: string[];
}

export function buildPrompt(input: PromptInput): BuiltPrompt {
  const preset = input.emotionId
    ? PRESETS.find((candidate) => candidate.id === input.emotionId)
    : undefined;

  if (input.emotionId && !preset) {
    throw new FunctionError('invalid_request', `Unknown emotion id ${input.emotionId}`);
  }

  const customIdea = sanitizeUserText(input.customIdea, INSTRUCTIONS_MAX);
  const stickerText = sanitizeUserText(input.stickerText, STICKER_TEXT_MAX);
  const additional = sanitizeUserText(input.additionalInstructions, INSTRUCTIONS_MAX);

  const idea = preset?.prompt ?? customIdea;
  if (!idea) {
    throw new FunctionError('invalid_request', 'Either emotionId or customIdea is required');
  }

  const sections = [BASE_STYLE, `Scene: ${idea}.`];
  if (preset && customIdea) {
    sections.push(`Extra idea: ${customIdea}.`);
  }
  if (stickerText) {
    sections.push(
      `Render the caption "${stickerText}" as part of the sticker in a bold rounded font with a contrasting outline, placed so it never covers the face.`,
    );
  } else {
    sections.push('Do not add any text, letters or numbers to the sticker.');
  }
  if (additional) {
    sections.push(`User refinement: ${additional}.`);
  }

  return {
    prompt: sections.join(' '),
    emotionId: preset?.id ?? null,
    stickerText: stickerText.length > 0 ? stickerText : null,
    additionalInstructions: additional.length > 0 ? additional : null,
    stickerEmojis: preset?.stickerEmojis?.slice(0, 3) ?? [],
  };
}
