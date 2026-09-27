import * as Application from 'expo-application';
import { useRouter } from 'expo-router';
import * as StoreReview from 'expo-store-review';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '../../src/components/AppText';
import { Banner } from '../../src/components/Banner';
import { Button } from '../../src/components/Button';
import { CreditPill } from '../../src/components/CreditPill';
import { ListRow } from '../../src/components/ListRow';
import { Screen } from '../../src/components/Screen';
import { env } from '../../src/config/env';
import { useSignOut } from '../../src/features/account/useAccount';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { useCredits } from '../../src/features/credits/useCredits';
import {
  useClearMessagesStickers,
  useMessagesStickerCount,
} from '../../src/features/export/useMessagesStickers';
import { LANGUAGE_NAMES, type SupportedLanguage } from '../../src/i18n';
import { usePreferences, type ThemePreference } from '../../src/store/preferences';
import { spacing } from '../../src/theme';
import { useTheme } from '../../src/theme/useTheme';

const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'settings.themeSystem',
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
};

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { isAnonymous, provider } = useAuth();
  const { balance } = useCredits();
  const signOut = useSignOut();
  const messagesStickers = useMessagesStickerCount();
  const clearMessagesStickers = useClearMessagesStickers();

  const language = usePreferences((state) => state.language);
  const themePreference = usePreferences((state) => state.theme);
  const setThemePreference = usePreferences((state) => state.setTheme);
  const analyticsEnabled = usePreferences((state) => state.analyticsEnabled);
  const setAnalyticsEnabled = usePreferences((state) => state.setAnalyticsEnabled);

  const languageLabel = language
    ? LANGUAGE_NAMES[language as SupportedLanguage]
    : t('settings.systemLanguage');

  const cycleTheme = () => {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(themePreference) + 1) % order.length];
    if (next) setThemePreference(next);
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="largeTitle">{t('settings.title')}</AppText>
        <CreditPill
          generationCredits={balance.generation}
          exportCredits={balance.export}
          onPress={() => router.push('/paywall')}
        />
      </View>

      {isAnonymous ? (
        <Banner
          tone="info"
          title={t('settings.guestAccount')}
          message={t('settings.guestAccountBody')}
          action={
            <Button
              label={t('common.signIn')}
              variant="ghost"
              fullWidth={false}
              onPress={() => router.push('/auth/sign-in')}
            />
          }
        />
      ) : null}

      <AppText variant="footnote" tone="muted">
        {t('settings.credits')}
      </AppText>
      <ListRow
        title={t('paywall.title')}
        value={`${balance.generation} / ${balance.export}`}
        onPress={() => router.push('/paywall')}
      />
      <ListRow title={t('paywall.restore')} onPress={() => router.push('/paywall')} />

      <AppText variant="footnote" tone="muted">
        {t('settings.appearance')}
      </AppText>
      <ListRow
        title={t('settings.language')}
        value={languageLabel}
        onPress={() => router.push('/settings/language')}
        testID="settings-language"
      />
      <ListRow
        title={t('settings.appearance')}
        value={t(THEME_LABELS[themePreference])}
        onPress={cycleTheme}
        testID="settings-theme"
      />

      <ListRow
        title={t('settings.messagesStickers')}
        subtitle={t('settings.messagesStickersBody')}
        value={String(messagesStickers.data ?? 0)}
        onPress={
          (messagesStickers.data ?? 0) > 0
            ? () =>
                Alert.alert(t('settings.clearMessagesStickers'), undefined, [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: () => clearMessagesStickers.mutate(),
                  },
                ])
            : undefined
        }
        testID="settings-messages-stickers"
      />

      <AppText variant="footnote" tone="muted">
        {t('settings.account')}
      </AppText>
      {!isAnonymous && provider ? (
        <ListRow title={t('settings.signedInWith', { provider })} />
      ) : null}
      <ListRow
        title={t('settings.analytics')}
        subtitle={t('settings.analyticsBody')}
        accessory={
          <Switch
            value={analyticsEnabled}
            onValueChange={setAnalyticsEnabled}
            trackColor={{ true: theme.colors.brand, false: theme.colors.border }}
            accessibilityLabel={t('settings.analytics')}
          />
        }
      />
      {!isAnonymous ? (
        <ListRow
          title={t('common.signOut')}
          onPress={() =>
            Alert.alert(t('common.signOut'), undefined, [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('common.signOut'),
                style: 'destructive',
                onPress: () => signOut.mutate(),
              },
            ])
          }
        />
      ) : null}
      <ListRow
        title={t('settings.deleteAccount')}
        destructive
        onPress={() => router.push('/settings/delete-account')}
        testID="settings-delete-account"
      />

      <AppText variant="footnote" tone="muted">
        {t('support.title')}
      </AppText>
      <ListRow title={t('settings.support')} onPress={() => router.push('/settings/support')} />
      <ListRow
        title={t('settings.rate')}
        onPress={() => {
          void StoreReview.isAvailableAsync().then((available) => {
            if (available) void StoreReview.requestReview();
          });
        }}
      />
      <ListRow
        title={t('settings.privacy')}
        onPress={() => void WebBrowser.openBrowserAsync(env.privacyUrl)}
      />
      <ListRow
        title={t('settings.terms')}
        onPress={() => void WebBrowser.openBrowserAsync(env.termsUrl)}
      />

      <AppText variant="caption" tone="muted" center>
        {t('settings.version', {
          version: Application.nativeApplicationVersion ?? '1.0.0',
          build: Application.nativeBuildVersion ?? '1',
        })}
      </AppText>
      <AppText variant="caption" tone="muted" center>
        {t('moderation.disclaimerBody')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingTop: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
});
