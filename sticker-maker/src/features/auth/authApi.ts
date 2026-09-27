import * as AppleAuthentication from 'expo-apple-authentication';
import { makeRedirectUri } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { env } from '../../config/env';
import { supabase } from '../../lib/supabase';

export type SocialProvider = 'apple' | 'google';

/**
 * Two different jobs, two different mechanisms:
 *
 *  - A brand new user signs in. Apple goes through the native sheet (fastest, and the
 *    button Apple expects to see); Google goes through the Supabase OAuth flow in an
 *    auth session, which keeps us out of the Google SDK entirely.
 *  - A guest with stickers *upgrades*. That must use `linkIdentity`, otherwise Supabase
 *    creates a second user and the guest's stickers and credits are orphaned. Linking
 *    fails when the identity already belongs to another account, which is exactly the
 *    conflict the UI explains.
 */

export type AuthOutcome = 'signed_in' | 'linked' | 'conflict' | 'cancelled';

const redirectTo = makeRedirectUri({ scheme: env.deepLinkScheme, path: 'auth-callback' });

export async function ensureAnonymousSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;

  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw Object.assign(new Error(error.message), { code: 'unauthenticated' });
  }
}

export async function signInWithApple(): Promise<AuthOutcome> {
  if (Platform.OS !== 'ios' || !(await AppleAuthentication.isAvailableAsync())) {
    return signInWithOAuth('apple');
  }

  const rawNonce = randomNonce();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      // Apple signs the hashed nonce; Supabase verifies it against the raw one.
      nonce: hashedNonce,
    });
  } catch (error) {
    if (isAppleCancellation(error)) return 'cancelled';
    throw error;
  }

  if (!credential.identityToken) {
    throw Object.assign(new Error('Apple returned no identity token'), {
      code: 'unauthenticated',
    });
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });

  if (error) {
    throw Object.assign(new Error(error.message), { code: 'unauthenticated' });
  }

  return 'signed_in';
}

export async function signInWithOAuth(provider: SocialProvider): Promise<AuthOutcome> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data?.url) {
    throw Object.assign(new Error(error?.message ?? 'No OAuth URL'), { code: 'unauthenticated' });
  }

  return completeBrowserFlow(data.url, 'signed_in');
}

export async function linkIdentity(provider: SocialProvider): Promise<AuthOutcome> {
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error) {
    if (isIdentityConflict(error.message)) return 'conflict';
    throw Object.assign(new Error(error.message), { code: 'unauthenticated' });
  }
  if (!data?.url) {
    throw Object.assign(new Error('No link URL'), { code: 'unauthenticated' });
  }

  return completeBrowserFlow(data.url, 'linked');
}

async function completeBrowserFlow(
  url: string,
  success: Extract<AuthOutcome, 'signed_in' | 'linked'>,
): Promise<AuthOutcome> {
  const result = await WebBrowser.openAuthSessionAsync(url, redirectTo);
  if (result.type !== 'success') {
    return 'cancelled';
  }

  const returned = new URL(result.url);
  const errorDescription =
    returned.searchParams.get('error_description') ?? returned.searchParams.get('error');
  if (errorDescription) {
    if (isIdentityConflict(errorDescription)) return 'conflict';
    throw Object.assign(new Error(errorDescription), { code: 'unauthenticated' });
  }

  const code = returned.searchParams.get('code');
  if (!code) {
    throw Object.assign(new Error('No authorization code in the callback'), {
      code: 'unauthenticated',
    });
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    if (isIdentityConflict(error.message)) return 'conflict';
    throw Object.assign(new Error(error.message), { code: 'unauthenticated' });
  }

  return success;
}

/** Called after a successful upgrade so the bonus is granted exactly once. */
export async function claimSignInBonus(): Promise<void> {
  await supabase.rpc('claim_sign_in_bonus');
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

function randomNonce(): string {
  const bytes = Crypto.getRandomBytes(32);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isAppleCancellation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  return code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED';
}

export function isIdentityConflict(message: string): boolean {
  return /identity.*(already|exists)|already.*(linked|registered|in use)/i.test(message);
}
