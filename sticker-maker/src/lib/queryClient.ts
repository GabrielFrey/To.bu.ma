import { QueryClient } from '@tanstack/react-query';

import { errorCodeOf } from './errors';

export const queryKeys = {
  profile: ['profile'] as const,
  credits: ['credits'] as const,
  stickers: ['stickers'] as const,
  sticker: (id: string) => ['sticker', id] as const,
  packs: ['packs'] as const,
  pack: (id: string) => ['pack', id] as const,
  packStickers: (id: string) => ['pack', id, 'stickers'] as const,
  generations: ['generations'] as const,
  generation: (id: string) => ['generation', id] as const,
  pendingGenerations: ['generations', 'pending'] as const,
  offerings: ['offerings'] as const,
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (failureCount, error) => {
        // Retrying a rejected charge or a moderation block only wastes the user's time.
        const code = errorCodeOf(error);
        if (['insufficient_credits', 'moderation_blocked', 'forbidden', 'not_found'].includes(code)) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: 0,
    },
  },
});
