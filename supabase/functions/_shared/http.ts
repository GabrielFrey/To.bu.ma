export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Error codes the app maps to localized strings; keep them in sync with src/lib/errors.ts. */
export type ErrorCode =
  | 'unauthenticated'
  | 'invalid_request'
  | 'insufficient_credits'
  | 'rate_limited'
  | 'moderation_blocked'
  | 'provider_error'
  | 'provider_timeout'
  | 'invalid_image'
  | 'not_found'
  | 'forbidden'
  | 'internal_error';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthenticated: 401,
  invalid_request: 400,
  insufficient_credits: 402,
  rate_limited: 429,
  moderation_blocked: 422,
  provider_error: 502,
  provider_timeout: 504,
  invalid_image: 400,
  not_found: 404,
  forbidden: 403,
  internal_error: 500,
};

export class FunctionError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof FunctionError) {
    return json({ code: error.code, message: error.message }, STATUS_BY_CODE[error.code]);
  }
  console.error('unhandled function error', error);
  return json({ code: 'internal_error', message: 'Unexpected error' }, 500);
}

export function handleOptions(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ code: 'invalid_request', message: 'POST only' }, 405);
  }
  return null;
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new FunctionError('internal_error', `Missing env var ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  return Deno.env.get(name) ?? fallback;
}

export function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
