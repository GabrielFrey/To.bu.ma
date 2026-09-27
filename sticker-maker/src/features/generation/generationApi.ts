import * as Crypto from 'expo-crypto';

import { generationRequestId } from '../../domain/idempotency';
import { LIMITS } from '../../domain/limits';
import { sanitizeUserText } from '../../domain/prompt';
import type { Generation, GenerationStatus } from '../../domain/types';
import { uploadSourcePhoto } from '../../lib/storage';
import { invokeEdgeFunction, supabase } from '../../lib/supabase';

const GENERATION_COLUMNS =
  'id, status, emotion, sticker_text, additional_instructions, prompt, result_path, error_code, created_at, completed_at';

interface GenerationRow {
  id: string;
  status: GenerationStatus;
  emotion: string | null;
  sticker_text: string | null;
  additional_instructions: string | null;
  prompt: string;
  result_path: string | null;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

export function mapGeneration(row: GenerationRow): Generation {
  return {
    id: row.id,
    status: row.status,
    emotion: row.emotion,
    stickerText: row.sticker_text,
    additionalInstructions: row.additional_instructions,
    prompt: row.prompt,
    resultPath: row.result_path,
    errorCode: row.error_code,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export interface StartGenerationInput {
  userId: string;
  /** Local file URI produced by the crop screen. */
  photoUri: string;
  emotionId: string | null;
  customIdea: string | null;
  stickerText: string | null;
  additionalInstructions: string | null;
  locale: string;
  /** Reused across retries of the *same* attempt so a network hiccup cannot double charge. */
  clientJobId?: string;
}

export interface StartGenerationResult {
  generationId: string;
  status: GenerationStatus;
  replayed: boolean;
  sourcePath: string;
}

export function newClientJobId(): string {
  return Crypto.randomUUID();
}

/**
 * Upload first, then charge: the Edge Function refuses a source path outside the caller's
 * own folder, and a moderation rejection happens before any credit is spent.
 */
export async function startGeneration(
  input: StartGenerationInput,
): Promise<StartGenerationResult> {
  const sourcePath = await uploadSourcePhoto(input.userId, input.photoUri);
  const clientJobId = input.clientJobId ?? newClientJobId();

  const response = await invokeEdgeFunction<{
    generationId: string;
    status: GenerationStatus;
    replayed?: boolean;
  }>('generate-sticker', {
    requestId: generationRequestId(clientJobId),
    sourcePath,
    emotionId: input.emotionId,
    customIdea: input.customIdea,
    stickerText: input.stickerText,
    additionalInstructions: input.additionalInstructions,
    locale: input.locale,
  });

  return {
    generationId: response.generationId,
    status: response.status,
    replayed: response.replayed ?? false,
    sourcePath,
  };
}

/** Optional pre-flight so an unusable photo never costs a credit. */
export async function moderateSource(
  sourcePath: string,
  text: string | null,
): Promise<{ allowed: boolean; reason?: string }> {
  return invokeEdgeFunction<{ allowed: boolean; reason?: string }>('moderate', {
    sourcePath,
    text,
  });
}

export async function fetchGeneration(id: string): Promise<Generation> {
  const { data, error } = await supabase
    .from('generations')
    .select(GENERATION_COLUMNS)
    .eq('id', id)
    .single();

  if (error) throw Object.assign(new Error(error.message), { code: 'not_found' });
  return mapGeneration(data as GenerationRow);
}

/** Jobs that were still running when the app went away; resynced on foreground. */
export async function fetchUnfinishedGenerations(): Promise<Generation[]> {
  const { data, error } = await supabase
    .from('generations')
    .select(GENERATION_COLUMNS)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });
  return (data as GenerationRow[]).map(mapGeneration);
}

export async function suggestIdeas(topic: string, locale: string): Promise<string[]> {
  const response = await invokeEdgeFunction<{ ideas: string[] }>('suggest-idea', {
    topic: sanitizeUserText(topic, LIMITS.topicMaxLength),
    locale,
    count: 5,
  });
  return response.ideas;
}

export async function submitStickerFeedback(
  userId: string,
  stickerId: string,
  value: 1 | -1,
): Promise<void> {
  const { error } = await supabase
    .from('feedback')
    .insert({ user_id: userId, sticker_id: stickerId, value });

  if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });
}

export async function fetchStickerForGeneration(generationId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('stickers')
    .select('id')
    .eq('generation_id', generationId)
    .maybeSingle();

  if (error) return null;
  return data?.id ?? null;
}
