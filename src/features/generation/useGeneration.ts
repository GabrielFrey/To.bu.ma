import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { Generation } from '../../domain/types';
import { errorCodeOf } from '../../lib/errors';
import { track } from '../../lib/observability';
import { queryKeys } from '../../lib/queryClient';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthProvider';

import {
  fetchGeneration,
  fetchUnfinishedGenerations,
  mapGeneration,
  startGeneration,
  submitStickerFeedback,
  suggestIdeas,
  type StartGenerationInput,
  type StartGenerationResult,
} from './generationApi';

export function useGeneration(id: string | null) {
  return useQuery({
    queryKey: queryKeys.generation(id ?? 'none'),
    enabled: id !== null,
    queryFn: () => fetchGeneration(id as string),
    // Realtime drives the updates; this is the safety net if the socket drops.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 5_000 : false;
    },
  });
}

export function useUnfinishedGenerations() {
  const { userId } = useAuth();

  return useQuery({
    queryKey: queryKeys.pendingGenerations,
    enabled: userId !== null,
    queryFn: fetchUnfinishedGenerations,
    staleTime: 0,
  });
}

/**
 * Generation finishes on the server, often while the app is backgrounded. Two mechanisms
 * cover that: a Realtime subscription on the user's own rows for the live case, and a
 * refetch on foreground for the case where the socket was gone. Push is a third,
 * optional nudge — the UI is never dependent on it.
 */
export function useGenerationSubscription(): void {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`generations:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'generations',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (!payload.new || Object.keys(payload.new).length === 0) return;
          const generation = mapGeneration(
            payload.new as Parameters<typeof mapGeneration>[0],
          );

          queryClient.setQueryData(queryKeys.generation(generation.id), generation);
          void queryClient.invalidateQueries({ queryKey: queryKeys.pendingGenerations });

          if (generation.status === 'done') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.stickers });
            void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
          }
          if (generation.status === 'failed') {
            // The server refunds a failed generation, so the balance moved too.
            void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}

/** Resyncs anything that finished while the app was in the background. */
export function useForegroundResync(): void {
  const queryClient = useQueryClient();
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const cameToForeground = appState.current !== 'active' && next === 'active';
      appState.current = next;
      if (!cameToForeground) return;

      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingGenerations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stickers });
    });

    return () => subscription.remove();
  }, [queryClient]);
}

export function useStartGeneration() {
  const queryClient = useQueryClient();

  return useMutation<StartGenerationResult, unknown, StartGenerationInput>({
    mutationFn: startGeneration,
    onSuccess: (result) => {
      track('generation_started', { replayed: result.replayed });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingGenerations });
    },
    onError: (error) => {
      track('generation_failed', { code: errorCodeOf(error) });
    },
  });
}

export function useSuggestIdeas() {
  return useMutation<string[], unknown, { topic: string; locale: string }>({
    mutationFn: ({ topic, locale }) => suggestIdeas(topic, locale),
    onSuccess: (ideas) => {
      track('idea_suggested', { count: ideas.length });
    },
  });
}

export function useStickerFeedback() {
  const { userId } = useAuth();

  return useMutation<void, unknown, { stickerId: string; value: 1 | -1 }>({
    mutationFn: ({ stickerId, value }) => {
      if (!userId) throw Object.assign(new Error('No session'), { code: 'unauthenticated' });
      return submitStickerFeedback(userId, stickerId, value);
    },
    onSuccess: (_result, variables) => {
      track('sticker_feedback', { value: variables.value });
    },
  });
}

export function isGenerationPending(generation: Generation | undefined): boolean {
  return generation?.status === 'queued' || generation?.status === 'running';
}
