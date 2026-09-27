import * as FileSystem from 'expo-file-system/legacy';

import { LIMITS } from '../domain/limits';

/**
 * Sticker files are downloaded once and reused. The cache is trimmed by least recent
 * use so a heavy user cannot fill the device: iOS can purge cacheDirectory anyway, and
 * every file here is re-downloadable.
 */
const CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}stickers/`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

function fileNameFor(storagePath: string): string {
  return storagePath.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function cachedUri(storagePath: string): string {
  return `${CACHE_DIR}${fileNameFor(storagePath)}`;
}

export async function isCached(storagePath: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(cachedUri(storagePath));
  return info.exists && info.size !== undefined && info.size > 0;
}

export async function cacheRemoteFile(storagePath: string, signedUrl: string): Promise<string> {
  await ensureDir();
  const target = cachedUri(storagePath);

  if (await isCached(storagePath)) {
    return target;
  }

  const result = await FileSystem.downloadAsync(signedUrl, target);
  if (result.status !== 200) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw Object.assign(new Error(`Download failed with status ${result.status}`), {
      code: 'network',
    });
  }

  void trimCache();
  return target;
}

export async function removeFromCache(storagePath: string): Promise<void> {
  await FileSystem.deleteAsync(cachedUri(storagePath), { idempotent: true });
}

export async function trimCache(maxBytes = LIMITS.stickerCacheMaxBytes): Promise<number> {
  await ensureDir();
  const names = await FileSystem.readDirectoryAsync(CACHE_DIR);

  const entries = await Promise.all(
    names.map(async (name) => {
      const info = await FileSystem.getInfoAsync(`${CACHE_DIR}${name}`);
      return {
        uri: `${CACHE_DIR}${name}`,
        size: info.exists ? (info.size ?? 0) : 0,
        modified: info.exists ? (info.modificationTime ?? 0) : 0,
      };
    }),
  );

  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= maxBytes) return 0;

  const oldestFirst = [...entries].sort((a, b) => a.modified - b.modified);
  let removed = 0;

  for (const entry of oldestFirst) {
    if (total <= maxBytes) break;
    await FileSystem.deleteAsync(entry.uri, { idempotent: true });
    total -= entry.size;
    removed += 1;
  }

  return removed;
}

export async function clearCache(): Promise<void> {
  await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
}
