import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { validatePackForTarget, type PackValidationResult } from '../../domain/packs';
import type { ExportTarget, Pack, PackSticker } from '../../domain/types';
import { track } from '../../lib/observability';
import { queryKeys } from '../../lib/queryClient';
import { useAuth } from '../auth/AuthProvider';

import {
  addStickersToPack,
  createPack,
  deletePack,
  fetchPack,
  fetchPackStickers,
  fetchPacks,
  removeStickerFromPack,
  renamePack,
  reorderPack,
  setTraySticker,
} from './packsApi';

export function usePacks() {
  const { userId } = useAuth();

  return useQuery({
    queryKey: queryKeys.packs,
    enabled: userId !== null,
    queryFn: fetchPacks,
  });
}

export function usePack(id: string | null) {
  return useQuery({
    queryKey: queryKeys.pack(id ?? 'none'),
    enabled: id !== null,
    queryFn: () => fetchPack(id as string),
  });
}

export function usePackStickers(id: string | null) {
  return useQuery({
    queryKey: queryKeys.packStickers(id ?? 'none'),
    enabled: id !== null,
    queryFn: () => fetchPackStickers(id as string),
  });
}

function useInvalidatePack() {
  const queryClient = useQueryClient();

  return (packId?: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.packs });
    if (packId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pack(packId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.packStickers(packId) });
    }
  };
}

export function useCreatePack() {
  const { userId } = useAuth();
  const invalidate = useInvalidatePack();
  const { t } = useTranslation();

  return useMutation<Pack, unknown, { name: string; stickerIds?: string[] }>({
    mutationFn: async ({ name, stickerIds }) => {
      if (!userId) throw Object.assign(new Error('No session'), { code: 'unauthenticated' });
      const pack = await createPack(userId, name.trim(), t('common.appName'));
      if (stickerIds && stickerIds.length > 0) {
        await addStickersToPack(pack.id, stickerIds);
      }
      return pack;
    },
    onSuccess: (pack) => {
      track('pack_created');
      invalidate(pack.id);
    },
  });
}

export function useRenamePack() {
  const invalidate = useInvalidatePack();

  return useMutation<void, unknown, { packId: string; name: string }>({
    mutationFn: ({ packId, name }) => renamePack(packId, name.trim()),
    onSuccess: (_result, variables) => invalidate(variables.packId),
  });
}

export function useDeletePack() {
  const invalidate = useInvalidatePack();

  return useMutation<void, unknown, string>({
    mutationFn: deletePack,
    onSuccess: (_result, packId) => invalidate(packId),
  });
}

export function useAddStickersToPack() {
  const invalidate = useInvalidatePack();

  return useMutation<void, unknown, { packId: string; stickerIds: string[] }>({
    mutationFn: ({ packId, stickerIds }) => addStickersToPack(packId, stickerIds),
    onSuccess: (_result, variables) => invalidate(variables.packId),
  });
}

export function useRemoveStickerFromPack() {
  const invalidate = useInvalidatePack();

  return useMutation<void, unknown, { packId: string; stickerId: string }>({
    mutationFn: ({ packId, stickerId }) => removeStickerFromPack(packId, stickerId),
    onSuccess: (_result, variables) => invalidate(variables.packId),
  });
}

export function useSetTraySticker() {
  const invalidate = useInvalidatePack();

  return useMutation<void, unknown, { packId: string; stickerId: string }>({
    mutationFn: ({ packId, stickerId }) => setTraySticker(packId, stickerId),
    onSuccess: (_result, variables) => invalidate(variables.packId),
  });
}

/**
 * Drag-and-drop writes the order optimistically: the list has already moved under the
 * user's finger, so waiting for the round trip would make it jump back and forth.
 */
export function useReorderPack() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    unknown,
    { packId: string; stickerIds: string[] },
    { previous: PackSticker[] | undefined }
  >({
    mutationFn: ({ packId, stickerIds }) => reorderPack(packId, stickerIds),
    onMutate: async ({ packId, stickerIds }) => {
      const key = queryKeys.packStickers(packId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PackSticker[]>(key);

      if (previous) {
        const byId = new Map(previous.map((sticker) => [sticker.id, sticker]));
        const reordered = stickerIds.flatMap((id, index) => {
          const sticker = byId.get(id);
          return sticker ? [{ ...sticker, position: index }] : [];
        });
        queryClient.setQueryData(key, reordered);
      }

      return { previous };
    },
    onError: (_error, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.packStickers(variables.packId), context.previous);
      }
    },
    onSettled: (_result, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.packStickers(variables.packId),
      });
    },
  });
}

export function usePackReadiness(
  pack: Pack | undefined,
  stickers: PackSticker[] | undefined,
  target: ExportTarget = 'whatsapp',
): PackValidationResult {
  if (!pack) return { valid: false, issues: [] };

  return validatePackForTarget(
    {
      name: pack.name,
      trayStickerId: pack.trayStickerId,
      stickers: stickers ?? [],
    },
    target,
  );
}
