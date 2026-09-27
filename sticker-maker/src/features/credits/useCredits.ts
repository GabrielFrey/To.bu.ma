import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { CreditBalance, Profile } from '../../domain/types';
import { queryKeys } from '../../lib/queryClient';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthProvider';

function mapProfile(row: {
  id: string;
  locale: string | null;
  is_anonymous: boolean;
  generation_credits: number;
  export_credits: number;
  first_export_bonus_granted: boolean;
  analytics_opt_out: boolean;
  created_at: string;
}): Profile {
  return {
    id: row.id,
    locale: row.locale,
    isAnonymous: row.is_anonymous,
    generationCredits: row.generation_credits,
    exportCredits: row.export_credits,
    firstExportBonusGranted: row.first_export_bonus_granted,
    analyticsOptOut: row.analytics_opt_out,
    createdAt: row.created_at,
  };
}

export function useProfile() {
  const { userId } = useAuth();

  return useQuery({
    queryKey: queryKeys.profile,
    enabled: userId !== null,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, locale, is_anonymous, generation_credits, export_credits, first_export_bonus_granted, analytics_opt_out, created_at',
        )
        .eq('id', userId as string)
        .single();

      if (error) throw Object.assign(new Error(error.message), { code: 'not_found' });
      return mapProfile(data);
    },
  });
}

export function useCredits(): { balance: CreditBalance; isLoading: boolean } {
  const { data, isLoading } = useProfile();
  return {
    balance: {
      generation: data?.generationCredits ?? 0,
      export: data?.exportCredits ?? 0,
    },
    isLoading,
  };
}

/**
 * The balance changes on the server (generation charges, refunds, purchase webhooks), so
 * the app subscribes to its own profile row instead of polling.
 */
export function useCreditSubscription(): void {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`profile:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          const row = payload.new as Parameters<typeof mapProfile>[0];
          queryClient.setQueryData(queryKeys.profile, mapProfile(row));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}

export function useUpdateProfile() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: { locale?: string | null; analytics_opt_out?: boolean }) => {
      if (!userId) throw Object.assign(new Error('No session'), { code: 'unauthenticated' });
      const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
      if (error) throw Object.assign(new Error(error.message), { code: 'internal_error' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}
