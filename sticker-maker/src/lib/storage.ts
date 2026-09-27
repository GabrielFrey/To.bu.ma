import * as FileSystem from 'expo-file-system/legacy';

import { cacheRemoteFile, cachedUri, isCached } from './fileCache';
import { supabase } from './supabase';

const SIGNED_URL_TTL_SECONDS = 600;

interface SignedUrlEntry {
  url: string;
  expiresAt: number;
}

const signedUrlCache = new Map<string, SignedUrlEntry>();

/** Buckets are private, so every read goes through a short-lived signed URL. */
export async function signedUrl(bucket: 'sources' | 'stickers', path: string): Promise<string> {
  const key = `${bucket}/${path}`;
  const cached = signedUrlCache.get(key);
  // Refresh a minute early so a slow download cannot outlive its URL.
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.url;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw Object.assign(new Error(error?.message ?? 'Could not sign the file URL'), {
      code: 'not_found',
    });
  }

  signedUrlCache.set(key, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
  });
  return data.signedUrl;
}

/** Returns a local file URI, downloading it on first use. */
export async function localStickerUri(path: string): Promise<string> {
  if (await isCached(path)) {
    return cachedUri(path);
  }
  return cacheRemoteFile(path, await signedUrl('stickers', path));
}

export async function uploadSourcePhoto(
  userId: string,
  localUri: string,
  contentType = 'image/jpeg',
): Promise<string> {
  const extension = contentType === 'image/png' ? 'png' : 'jpg';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;

  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const { error } = await supabase.storage
    .from('sources')
    .upload(path, decodeBase64(base64), { contentType, upsert: false });

  if (error) {
    throw Object.assign(new Error(error.message), { code: 'upload_failed' });
  }

  return path;
}

/**
 * React Native's fetch cannot stream a file into Supabase storage, and Buffer is not
 * available, so the picked photo is turned into bytes here.
 */
function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function invalidateSignedUrl(bucket: 'sources' | 'stickers', path: string): void {
  signedUrlCache.delete(`${bucket}/${path}`);
}
