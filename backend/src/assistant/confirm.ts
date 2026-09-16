import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Confirmation tokens for gated tool calls.
 *
 * The token is an HMAC over the tenant, the specific tool-call row, the tool name
 * and a hash of the exact arguments, with an expiry baked in. That combination is
 * what makes the round-trip meaningful:
 *   - tenant-bound, so a token from one org cannot confirm work in another
 *   - argument-bound, so a client cannot be shown "delete budget X" and then
 *     confirm "delete budget Y" with the same token
 *   - single-purpose, since the tool-call id is minted per call
 *   - short-lived, so an abandoned confirmation cannot be replayed later
 *
 * It is stateless (nothing to store or clean up) while the AssistantToolCall row
 * carries the audit trail and the single-use check.
 */
export interface ConfirmPayload {
  organizationId: string;
  toolCallId: string;
  tool: string;
  args: unknown;
}

export function hashArgs(args: unknown): string {
  return createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex').slice(0, 32);
}

function sign(payload: ConfirmPayload, expiresAt: number): string {
  const material = [
    payload.organizationId,
    payload.toolCallId,
    payload.tool,
    hashArgs(payload.args),
    String(expiresAt),
  ].join(':');
  return createHmac('sha256', config.masterKey).update(material).digest('hex').slice(0, 40);
}

export interface MintedConfirmation {
  confirmToken: string;
  expiresAt: string;
}

export function mintConfirmToken(payload: ConfirmPayload, now = Date.now()): MintedConfirmation {
  const expiresAt = now + config.assistantConfirmTtlMs;
  return {
    confirmToken: `${expiresAt}.${sign(payload, expiresAt)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export type ConfirmVerdict =
  | { valid: true }
  | { valid: false; reason: 'malformed' | 'expired' | 'mismatch' };

export function verifyConfirmToken(
  token: string,
  payload: ConfirmPayload,
  now = Date.now()
): ConfirmVerdict {
  const [expiresRaw, signature] = String(token ?? '').split('.');
  const expiresAt = Number(expiresRaw);
  if (!expiresRaw || !signature || !Number.isFinite(expiresAt)) return { valid: false, reason: 'malformed' };
  if (now > expiresAt) return { valid: false, reason: 'expired' };

  const expected = sign(payload, expiresAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: 'mismatch' };
  return { valid: true };
}
