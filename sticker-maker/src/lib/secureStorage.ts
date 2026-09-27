import * as SecureStore from 'expo-secure-store';

/**
 * Supabase session tokens routinely exceed the ~2 KB that iOS Keychain items are
 * comfortable with, and SecureStore warns (and can fail) above that. So the session
 * is split into chunks. AsyncStorage is deliberately not used for tokens.
 */
const CHUNK_SIZE = 1800;
const COUNT_SUFFIX = '__chunks';

function chunkKey(key: string, index: number): string {
  return `${key}__${index}`;
}

function countKey(key: string): string {
  return `${key}${COUNT_SUFFIX}`;
}

async function readChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key));
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function clearChunks(key: string, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, index))),
  );
  await SecureStore.deleteItemAsync(countKey(key));
}

export const chunkedSecureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await readChunkCount(key);
    if (count === 0) {
      return SecureStore.getItemAsync(key);
    }
    const parts = await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index))),
    );
    if (parts.some((part) => part === null)) {
      // A partially written session is worse than no session: drop it and re-auth.
      await clearChunks(key, count);
      return null;
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const previousCount = await readChunkCount(key);
    if (previousCount > 0) {
      await clearChunks(key, previousCount);
    }

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    await SecureStore.deleteItemAsync(key);
    const chunks: string[] = [];
    for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
      chunks.push(value.slice(offset, offset + CHUNK_SIZE));
    }
    await Promise.all(
      chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)),
    );
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    const count = await readChunkCount(key);
    if (count > 0) {
      await clearChunks(key, count);
    }
    await SecureStore.deleteItemAsync(key);
  },
};
