import presets from '../../supabase/functions/_shared/emotions.json';

export type EmotionCategory = 'reaction' | 'celebration' | 'daily' | 'work' | 'love' | 'animal';

export interface EmotionPreset {
  /** Stable id stored on the generation row; never localize this. */
  id: string;
  emoji: string;
  /** Emoji suggested for the WhatsApp sticker metadata. */
  stickerEmojis: string[];
  /** English prompt fragment sent to the image model. */
  prompt: string;
  category: EmotionCategory;
}

/**
 * The presets live in `supabase/functions/_shared/emotions.json` so the Edge Function
 * that actually builds the model prompt and the app that renders the picker can never
 * drift apart. The app treats the prompt text as a preview: the server rebuilds it.
 */
export const EMOTION_PRESETS: readonly EmotionPreset[] = presets as EmotionPreset[];

export const EMOTION_CATEGORIES: readonly EmotionCategory[] = [
  'reaction',
  'celebration',
  'daily',
  'work',
  'love',
  'animal',
];

export function findEmotion(id: string | null | undefined): EmotionPreset | undefined {
  if (!id) return undefined;
  return EMOTION_PRESETS.find((preset) => preset.id === id);
}

export function emotionsByCategory(category: EmotionCategory): EmotionPreset[] {
  return EMOTION_PRESETS.filter((preset) => preset.category === category);
}

export function randomEmotion(random: () => number = Math.random): EmotionPreset {
  const index = Math.floor(random() * EMOTION_PRESETS.length) % EMOTION_PRESETS.length;
  // EMOTION_PRESETS is seeded from a non-empty JSON file, so the index is populated.
  return EMOTION_PRESETS[index] as EmotionPreset;
}
