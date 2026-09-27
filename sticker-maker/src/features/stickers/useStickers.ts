import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import type { Sticker } from '../../domain/types';
import { queryKeys } from '../../lib/queryClient';
import { useAuth } from '../auth/AuthProvider';

import {
  deleteStickers,
  fetchSticker,
  fetchStickerPage,
  fetchStickersByIds,
} from './stickersApi';

export function useStickerLibrary() {
  const { userId } = useAuth();

  const query = useInfiniteQuery({
    queryKey: queryKeys.stickers,
    enabled: userId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchStickerPage(pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const stickers = useMemo(
    () => query.data?.pages.flatMap((page) => page.stickers) ?? [],
    [query.data],
  );

  return { ...query, stickers };
}

export function useSticker(id: string | null) {
  return useQuery({
    queryKey: queryKeys.sticker(id ?? 'none'),
    enabled: id !== null,
    queryFn: () => fetchSticker(id as string),
  });
}

export function useStickersByIds(ids: string[]) {
  return useQuery({
    queryKey: ['stickers', 'byIds', ids],
    enabled: ids.length > 0,
    queryFn: () => fetchStickersByIds(ids),
  });
}

export function useDeleteStickers() {
  const queryClient = useQueryClient();

  return useMutation<void, unknown, string[]>({
    mutationFn: deleteStickers,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.stickers });
      void queryClient.invalidateQueries({ queryKey: queryKeys.packs });
    },
  });
}

export interface StickerSelection {
  selectedIds: string[];
  isSelecting: boolean;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  clear: () => void;
  selectAll: (stickers: Sticker[]) => void;
}

/** Multi-select state for the library grid and the "add to pack" picker. */
export function useStickerSelection(): StickerSelection {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }, []);

  const clear = useCallback(() => setSelectedIds([]), []);

  const selectAll = useCallback((stickers: Sticker[]) => {
    setSelectedIds(stickers.map((sticker) => sticker.id));
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.includes(id), [selectedIds]);

  return {
    selectedIds,
    isSelecting: selectedIds.length > 0,
    isSelected,
    toggle,
    clear,
    selectAll,
  };
}
