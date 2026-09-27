import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { clearAppGroupStickers, getAppGroupStickerCount } from '../../../modules/sticker-export';
import { env } from '../../config/env';

const MESSAGES_STICKERS_KEY = ['messages-stickers'] as const;

/**
 * The Messages extension reads PNG files out of the shared App Group container, so the
 * app is the only place those files can be removed again. Without this the user could add
 * a sticker to Messages and never get rid of it.
 */
export function useMessagesStickerCount() {
  return useQuery({
    queryKey: MESSAGES_STICKERS_KEY,
    queryFn: () => getAppGroupStickerCount(env.appGroup),
    staleTime: 0,
  });
}

export function useClearMessagesStickers() {
  const queryClient = useQueryClient();

  return useMutation<void, unknown, void>({
    mutationFn: () => clearAppGroupStickers(env.appGroup),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MESSAGES_STICKERS_KEY });
    },
  });
}
