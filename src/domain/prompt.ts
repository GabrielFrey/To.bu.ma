import { findEmotion } from './emotions';
import { LIMITS } from './limits';

export interface PromptInput {
  emotionId?: string | null;
  /** Free-form idea coming from `suggest-idea` or typed by the user. */
  customIdea?: string | null;
  stickerText?: string | null;
  additionalInstructions?: string | null;
}

export interface BuiltPrompt {
  prompt: string;
  emotionId: string | null;
  stickerText: string | null;
  additionalInstructions: string | null;
}

const BASE_STYLE = [
  'Turn the person or pet in the reference photo into a die-cut messaging sticker.',
  'Keep the subject clearly recognizable: preserve face shape, hair, skin tone and distinctive features.',
  'Bold clean outline, vivid colors, subtle shading, centered composition, full body or bust.',
  'Fully transparent background, no drop shadow on the background, no frame, no watermark.',
].join(' ');

/**
 * User text reaches an LLM prompt, so strip the characters that let it break out of
 * its section, then clamp. This is defence in depth — the Edge Function repeats it.
 */
export function sanitizeUserText(value: string | null | undefined, maxLength: number): string {
  if (!value) return '';
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[`{}<>|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function buildPrompt(input: PromptInput): BuiltPrompt {
  const emotion = findEmotion(input.emotionId);
  const customIdea = sanitizeUserText(input.customIdea, LIMITS.additionalInstructionsMaxLength);
  const stickerText = sanitizeUserText(input.stickerText, LIMITS.stickerTextMaxLength);
  const additional = sanitizeUserText(
    input.additionalInstructions,
    LIMITS.additionalInstructionsMaxLength,
  );

  const ideaFragment = emotion?.prompt ?? customIdea;
  if (!ideaFragment) {
    throw new Error('buildPrompt requires either a known emotionId or a customIdea');
  }

  const sections = [BASE_STYLE, `Scene: ${ideaFragment}.`];

  if (emotion && customIdea) {
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
    emotionId: emotion?.id ?? null,
    stickerText: stickerText.length > 0 ? stickerText : null,
    additionalInstructions: additional.length > 0 ? additional : null,
  };
}

export function promptSignature(built: BuiltPrompt): string {
  return [built.emotionId ?? 'custom', built.stickerText ?? '', built.additionalInstructions ?? '']
    .join('|')
    .toLowerCase();
}
