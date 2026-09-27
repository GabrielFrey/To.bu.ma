import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../../src/components/AppText';
import { Button } from '../../src/components/Button';
import { ErrorState } from '../../src/components/ErrorState';
import { Screen } from '../../src/components/Screen';
import { env } from '../../src/config/env';
import {
  claimSignInBonus,
  linkIdentity,
  signInWithApple,
  signInWithOAuth,
  type AuthOutcome,
  type SocialProvider,
} from '../../src/features/auth/authApi';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { track } from '../../src/lib/observability';
import { spacing } from '../../src/theme';
import { useTheme } from '../../src/theme/useTheme';

export default function SignInScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { isAnonymous } = useAuth();

  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<unknown>(null);

  /**
   * A guest who already has stickers must *link* the identity to the existing account;
   * signing in fresh would create a second user and leave their work behind. Everything
   * else is a plain sign in.
   */
  const run = async (provider: SocialProvider) => {
    setBusy(provider);
    setError(null);
    track('sign_in_started', { provider });

    try {
      const outcome: AuthOutcome = isAnonymous
        ? await linkIdentity(provider)
        : provider === 'apple'
          ? await signInWithApple()
          : await signInWithOAuth(provider);

      if (outcome === 'cancelled') return;

      if (outcome === 'conflict') {
        router.replace(`/auth/link-conflict?provider=${provider}`);
        return;
      }

      await claimSignInBonus();
      track('sign_in_succeeded', { provider, linked: outcome === 'linked' });
      router.back();
    } catch (caught) {
      track('sign_in_failed', { provider });
      setError(caught);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="largeTitle">{t('auth.title')}</AppText>
      <AppText variant="body" tone="muted">
        {t('auth.subtitle')}
      </AppText>
      <AppText variant="footnote" tone="brand">
        {t('auth.bonusNote', { generations: 5, exports: 3 })}
      </AppText>

      {error ? <ErrorState error={error} compact /> : null}

      {Platform.OS === 'ios' ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={
            theme.dark
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={12}
          style={styles.appleButton}
          onPress={() => void run('apple')}
        />
      ) : null}

      <Button
        label={t('auth.continueGoogle')}
        variant="secondary"
        loading={busy === 'google'}
        disabled={busy !== null}
        onPress={() => void run('google')}
        testID="sign-in-google"
      />

      <Button
        label={t('auth.continueAsGuest')}
        variant="ghost"
        disabled={busy !== null}
        onPress={() => router.back()}
      />

      <View style={styles.legal}>
        <AppText variant="caption" tone="muted" center>
          {t('auth.legalNote')}
        </AppText>
        <View style={styles.links}>
          <Pressable
            accessibilityRole="link"
            onPress={() => void WebBrowser.openBrowserAsync(env.termsUrl)}
          >
            <AppText variant="caption" tone="brand">
              {t('paywall.terms')}
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => void WebBrowser.openBrowserAsync(env.privacyUrl)}
          >
            <AppText variant="caption" tone="brand">
              {t('paywall.privacy')}
            </AppText>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingTop: spacing.lg },
  appleButton: { height: 50, width: '100%' },
  legal: { gap: spacing.sm, paddingTop: spacing.md },
  links: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
  },
});
