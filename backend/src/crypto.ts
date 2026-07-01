import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { config } from './config.js';

// Derive a stable 32-byte key from the master secret.
const key = scryptSync(config.masterKey, 'tbm-salt', 32);

/** AES-256-GCM encrypt a provider secret. Returns iv:tag:ciphertext (base64). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Hash a TBM API key for at-rest storage (plaintext is never persisted). */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateApiKey(): string {
  return 'tbm_' + randomBytes(24).toString('hex');
}
