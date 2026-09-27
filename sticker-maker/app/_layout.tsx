import * as Sentry from '@sentry/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../src/features/auth/AuthProvider';
import { useCreditSubscription } from '../src/features/credits/useCredits';
import {
  useForegroundResync,
  useGenerationSubscription,
} from '../src/features/generation/useGeneration';
import { initI18n } from '../src/i18n';
import { clearBadge, parseNotificationData } from '../src/lib/notifications';
import { initObservability, setAnalyticsEnabled } from '../src/lib/observability';
import { queryClient } from '../src/lib/queryClient';
import { usePreferences } from '../src/store/preferences';
import { useTheme } from '../src/theme/useTheme';

void SplashScreen.preventAutoHideAsync();
initObservability();

export default Sentry.wrap(function RootLayout() {
  const language = usePreferences((state) => state.language);
  const analyticsEnabled = usePreferences((state) => state.analyticsEnabled);
  const hydrated = usePreferences((state) => state.hydrated);
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    initI18n(language);
    setI18nReady(true);
  }, [hydrated, language]);

  useEffect(() => {
    setAnalyticsEnabled(analyticsEnabled);
  }, [analyticsEnabled]);

  if (!hydrated || !i18nReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AppShell />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
});

/**
 * Lives inside the providers so it can own the app-wide subscriptions: credits and
 * generation rows arrive over Realtime, and anything missed while backgrounded is
 * refetched on foreground.
 */
function AppShell() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { initializing } = useAuth();

  useCreditSubscription();
  useGenerationSubscription();
  useForegroundResync();
  useNotificationRouting();

  useEffect(() => {
    if (!initializing) {
      void SplashScreen.hideAsync();
    }
  }, [initializing]);

  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.text,
          headerTitleStyle: { color: theme.colors.text },
          contentStyle: { backgroundColor: theme.colors.background },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="auth/sign-in"
          options={{ presentation: 'modal', title: t('auth.title') }}
        />
        <Stack.Screen
          name="auth/link-conflict"
          options={{ presentation: 'modal', title: t('auth.conflictTitle') }}
        />
        <Stack.Screen name="crop" options={{ presentation: 'modal', title: t('crop.title') }} />
        <Stack.Screen name="generation/[id]" options={{ title: t('generation.done') }} />
        <Stack.Screen name="pack/[id]" options={{ title: t('packs.title') }} />
        <Stack.Screen
          name="add-stickers"
          options={{ presentation: 'modal', title: t('packs.addStickers') }}
        />
        <Stack.Screen
          name="export"
          options={{ presentation: 'modal', title: t('export.title') }}
        />
        <Stack.Screen
          name="paywall"
          options={{ presentation: 'modal', title: t('paywall.title') }}
        />
        <Stack.Screen
          name="report"
          options={{ presentation: 'modal', title: t('moderation.reportTitle') }}
        />
        <Stack.Screen name="settings/language" options={{ title: t('settings.language') }} />
        <Stack.Screen name="settings/support" options={{ title: t('support.title') }} />
        <Stack.Screen
          name="settings/delete-account"
          options={{ title: t('deleteAccount.title') }}
        />
      </Stack>
    </>
  );
}

/**
 * A tap on "your sticker is ready" must land on that sticker, including when the
 * notification is what launched the app from cold.
 */
function useNotificationRouting(): void {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled || !response) return;
      const payload = parseNotificationData(response.notification.request.content.data);
      if (payload) {
        router.push(`/generation/${payload.generationId}`);
      }
    });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const payload = parseNotificationData(response.notification.request.content.data);
      if (payload) {
        router.push(`/generation/${payload.generationId}`);
      }
      void clearBadge();
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [router]);
}
