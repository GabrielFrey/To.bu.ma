import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { identify, resetIdentity } from '../../lib/observability';
import { configurePurchases, logOutPurchases } from '../../lib/purchases';
import { queryKeys } from '../../lib/queryClient';
import { startSupabaseAutoRefresh, supabase } from '../../lib/supabase';

import { ensureAnonymousSession } from './authApi';

export interface AuthState {
  session: Session | null;
  userId: string | null;
  isAnonymous: boolean;
  provider: string | null;
  /** True until the stored session has been read and, if needed, a guest created. */
  initializing: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthState>({
  session: null,
  userId: null,
  isAnonymous: true,
  provider: null,
  initializing: true,
  error: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    const stopAutoRefresh = startSupabaseAutoRefresh();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    void (async () => {
      try {
        // Every user has a session from the first launch: a guest account is a real
        // Supabase user, which is what makes credits and RLS work before sign in.
        await ensureAnonymousSession();
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'auth_failed');
      } finally {
        setInitializing(false);
      }
    })();

    return () => {
      subscription.subscription.unsubscribe();
      stopAutoRefresh();
    };
  }, []);

  useEffect(() => {
    const userId = session?.user.id ?? null;
    if (userId === lastUserId.current) return;
    lastUserId.current = userId;

    if (!userId) {
      resetIdentity();
      void logOutPurchases();
      return;
    }

    const isAnonymous = session?.user.app_metadata?.provider === 'anonymous';
    identify(userId, isAnonymous);
    configurePurchases(userId);
    // A different user means every cached row belongs to somebody else.
    void queryClient.invalidateQueries();
    void queryClient.removeQueries({ queryKey: queryKeys.stickers });
  }, [session, queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      userId: session?.user.id ?? null,
      isAnonymous: session?.user.app_metadata?.provider === 'anonymous',
      provider: (session?.user.app_metadata?.provider as string | undefined) ?? null,
      initializing,
      error,
    }),
    [session, initializing, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function useRequireUserId(): string {
  const { userId } = useAuth();
  if (!userId) {
    throw Object.assign(new Error('No session'), { code: 'unauthenticated' });
  }
  return userId;
}
