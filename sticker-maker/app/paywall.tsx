import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../src/components/AppText';
import { Banner } from '../src/components/Banner';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { EmptyState } from '../src/components/EmptyState';
import { ErrorState } from '../src/components/ErrorState';
import { Screen } from '../src/components/Screen';
import { Skeleton } from '../src/components/Skeleton';
import { env } from '../src/config/env';
import { useAuth } from '../src/features/auth/AuthProvider';
import { useCredits } from '../src/features/credits/useCredits';
import {
  subscriptionPeriodKey,
  usePaywallProducts,
  usePurchase,
  useRestorePurchases,
  useStoreAvailable,
} from '../src/features/purchases/usePaywall';
import { track } from '../src/lib/observability';
import type { PaywallProduct } from '../src/lib/purchases';
import { radius, spacing } from '../src/theme';
import { useTheme } from '../src/theme/useTheme';

type PaywallReason = 'generations' | 'exports' | 'default';

export default function PaywallScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { reason } = useLocalSearchParams<{ reason?: PaywallReason }>();
  const { isAnonymous } = useAuth();
  const { balance } = useCredits();

  const storeAvailable = useStoreAvailable();
  const products = usePaywallProducts();
  const purchase = usePurchase();
  const restore = useRestorePurchases();
  const [notice, setNotice] = useState<string | null>(null);

  React.useEffect(() => {
    track('paywall_shown', { reason: reason ?? 'default' });
  }, [reason]);

  const subtitle = isAnonymous
    ? t('paywall.subtitleGuest')
    : reason === 'exports'
      ? t('paywall.subtitleOutOfExports')
      : reason === 'generations'
        ? t('paywall.subtitleOutOfGenerations')
        : t('paywall.subtitleGuest');

  const buy = (product: PaywallProduct) => {
    setNotice(null);
    purchase.mutate(product, {
      onSuccess: (outcome) => {
        setNotice(outcome === 'purchased' ? t('paywall.purchasing') : t('paywall.cancelled'));
        if (outcome === 'purchased') {
          // Credits arrive through the RevenueCat webhook, so the sheet can close.
          router.back();
        }
      },
      onError: () => setNotice(t('paywall.failed')),
    });
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="largeTitle">{t('paywall.title')}</AppText>
      <AppText variant="body" tone="muted">
        {subtitle}
      </AppText>

      <View
        style={[
          styles.balance,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
      >
        <AppText variant="footnote" tone="muted">
          {t('home.generationsLeft', { count: balance.generation })}
        </AppText>
        <AppText variant="footnote" tone="muted">
          {t('home.exportsLeft', { count: balance.export })}
        </AppText>
      </View>

      {isAnonymous ? (
        <Banner
          tone="info"
          message={t('auth.bonusNote', { generations: 5, exports: 3 })}
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

      {notice ? <Banner tone="info" message={notice} /> : null}

      {!storeAvailable ? (
        <EmptyState emoji="🛒" title={t('paywall.unavailable')} />
      ) : products.isPending ? (
        <View style={styles.products}>
          <Skeleton height={88} />
          <Skeleton height={88} />
        </View>
      ) : products.isError ? (
        <ErrorState error={products.error} onRetry={() => void products.refetch()} compact />
      ) : products.data.length === 0 ? (
        <EmptyState emoji="🛒" title={t('paywall.unavailable')} />
      ) : (
        <View style={styles.products}>
          {products.data.map((product) => {
            const periodKey = subscriptionPeriodKey(product.subscriptionPeriod);
            return (
              <Card key={product.identifier} onPress={() => buy(product)}>
                <AppText variant="headline">{product.title}</AppText>
                <AppText variant="footnote" tone="muted">
                  {product.description}
                </AppText>
                <AppText variant="title" tone="brand">
                  {product.priceString}
                </AppText>
                {product.isSubscription ? (
                  <AppText variant="caption" tone="muted">
                    {t('paywall.subscriptionNote', {
                      price: product.priceString,
                      period: periodKey ? t(periodKey) : (product.subscriptionPeriod ?? ''),
                    })}
                  </AppText>
                ) : null}
              </Card>
            );
          })}
        </View>
      )}

      <Button
        label={restore.isPending ? t('common.loading') : t('paywall.restore')}
        variant="secondary"
        loading={restore.isPending}
        onPress={() =>
          restore.mutate(undefined, {
            onSuccess: (restored) =>
              setNotice(restored ? t('paywall.restored') : t('paywall.nothingToRestore')),
            onError: () => setNotice(t('paywall.failed')),
          })
        }
        testID="restore-purchases"
      />

      <View style={styles.legal}>
        <Pressable
          accessibilityRole="link"
          onPress={() => void WebBrowser.openBrowserAsync(env.termsUrl)}
        >
          <AppText variant="footnote" tone="brand">
            {t('paywall.terms')}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => void WebBrowser.openBrowserAsync(env.privacyUrl)}
        >
          <AppText variant="footnote" tone="brand">
            {t('paywall.privacy')}
          </AppText>
        </Pressable>
      </View>

      <Button label={t('common.close')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingTop: spacing.lg },
  balance: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  products: { gap: spacing.md },
  legal: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.sm,
  },
});
