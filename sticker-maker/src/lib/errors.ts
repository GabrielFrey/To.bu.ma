/** Error codes shared with the Edge Functions (`supabase/functions/_shared/http.ts`). */
export const KNOWN_ERROR_CODES = [
  'unauthenticated',
  'invalid_request',
  'insufficient_credits',
  'rate_limited',
  'moderation_blocked',
  'provider_error',
  'provider_timeout',
  'invalid_image',
  'not_found',
  'forbidden',
  'internal_error',
  'native_module_unavailable',
  'network',
  'photo_permission',
  'camera_permission',
  'upload_failed',
  'load_failed',
  'app_not_installed',
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

export function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  if (error instanceof TypeError && /network|fetch/i.test(error.message)) {
    return 'network';
  }
  return 'unknown';
}

/**
 * Every failure the user sees resolves to a translated sentence. Unknown codes fall back
 * to `errors.unknown` rather than leaking an English server message into the UI.
 */
export function errorTranslationKey(error: unknown): string {
  const code = errorCodeOf(error);
  const translatable: string[] = [
    'insufficient_credits',
    'rate_limited',
    'moderation_blocked',
    'provider_timeout',
    'provider_error',
    'invalid_image',
    'native_module_unavailable',
    'network',
    'photo_permission',
    'camera_permission',
    'upload_failed',
    'load_failed',
    'app_not_installed',
  ];
  return translatable.includes(code) ? `errors.${code}` : 'errors.unknown';
}

export function isCancellation(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === 'cancelled' || code === 'user_cancelled';
}
