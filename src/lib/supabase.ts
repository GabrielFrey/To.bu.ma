import { createClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus } from 'react-native';

import { env } from '../config/env';

import type { Database } from './database.types';
import { chunkedSecureStorage } from './secureStorage';

export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: chunkedSecureStorage,
    autoRefreshToken: true,
    persistSession: true,
    // There is no browser redirect in a native app; deep links are handled explicitly.
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  global: {
    headers: { 'x-client-platform': 'mobile' },
  },
});

let appStateSubscription: { remove: () => void } | null = null;

/**
 * Supabase's auto refresh timer must be paused in the background, otherwise iOS
 * kills the socket and the first foreground request fails with a stale token.
 */
export function startSupabaseAutoRefresh(): () => void {
  supabase.auth.startAutoRefresh().catch(() => undefined);

  const handleAppStateChange = (state: AppStateStatus) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh().catch(() => undefined);
    } else {
      supabase.auth.stopAutoRefresh().catch(() => undefined);
    }
  };

  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
    supabase.auth.stopAutoRefresh().catch(() => undefined);
  };
}

export type EdgeFunctionName =
  | 'generate-sticker'
  | 'suggest-idea'
  | 'moderate'
  | 'export-pack'
  | 'delete-account'
  | 'support-message';

export interface EdgeFunctionError {
  code: string;
  message: string;
}

export async function invokeEdgeFunction<TResponse, TBody extends object = object>(
  name: EdgeFunctionName,
  body: TBody,
): Promise<TResponse> {
  const { data, error } = await supabase.functions.invoke<TResponse>(name, { body });

  if (error) {
    // Edge Functions answer failures with { code, message }; surface the code so the
    // UI can map it to a localized string instead of showing a raw HTTP message.
    const context = (error as { context?: { body?: unknown } }).context?.body;
    const parsed = parseFunctionError(context);
    throw Object.assign(new Error(parsed?.message ?? error.message), {
      code: parsed?.code ?? 'unknown',
    });
  }

  if (data === null || data === undefined) {
    throw Object.assign(new Error(`Empty response from ${name}`), { code: 'unknown' });
  }

  return data;
}

function parseFunctionError(body: unknown): EdgeFunctionError | null {
  if (!body) return null;
  try {
    const parsed = typeof body === 'string' ? (JSON.parse(body) as unknown) : body;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'code' in parsed &&
      typeof (parsed as { code: unknown }).code === 'string'
    ) {
      const record = parsed as { code: string; message?: string };
      return { code: record.code, message: record.message ?? record.code };
    }
  } catch {
    return null;
  }
  return null;
}
