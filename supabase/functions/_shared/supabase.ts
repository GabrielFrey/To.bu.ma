import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { FunctionError, requireEnv } from './http.ts';

/** Full access. Never derive anything user-scoped from this without an explicit filter. */
export function serviceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Runs as the caller, so RLS and auth.uid()-based RPCs behave exactly as on device. */
export function userClient(request: Request): SupabaseClient {
  const authorization = request.headers.get('Authorization');
  if (!authorization) {
    throw new FunctionError('unauthenticated', 'Missing Authorization header');
  }
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AuthenticatedCaller {
  userId: string;
  isAnonymous: boolean;
  client: SupabaseClient;
}

export async function authenticate(request: Request): Promise<AuthenticatedCaller> {
  const client = userClient(request);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new FunctionError('unauthenticated', error?.message ?? 'No user for this token');
  }
  return {
    userId: data.user.id,
    isAnonymous: data.user.app_metadata?.provider === 'anonymous',
    client,
  };
}

export async function enforceRateLimit(
  userId: string,
  bucket: string,
  limit: number,
): Promise<void> {
  const { data, error } = await serviceClient().rpc('check_rate_limit', {
    p_user_id: userId,
    p_bucket: bucket,
    p_limit: limit,
  });
  if (error) {
    // A broken limiter must not take the product down, but it should be loud.
    console.error('rate limit check failed', error.message);
    return;
  }
  if (data === false) {
    throw new FunctionError('rate_limited', `Too many ${bucket} requests`);
  }
}

export async function consumeCredits(
  client: SupabaseClient,
  kind: 'generation' | 'export',
  amount: number,
  requestId: string,
  ref?: { type: string; id: string },
): Promise<{ generationCredits: number; exportCredits: number; charged: boolean }> {
  const { data, error } = await client.rpc('consume_credits', {
    p_kind: kind,
    p_amount: amount,
    p_request_id: requestId,
    p_ref_type: ref?.type ?? null,
    p_ref_id: ref?.id ?? null,
  });

  if (error) {
    if (error.message.includes('insufficient_credits')) {
      throw new FunctionError('insufficient_credits', 'Not enough credits');
    }
    throw new FunctionError('internal_error', error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new FunctionError('internal_error', 'consume_credits returned no row');
  }
  return {
    generationCredits: row.generation_credits as number,
    exportCredits: row.export_credits as number,
    charged: row.charged as boolean,
  };
}
