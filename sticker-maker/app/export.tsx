import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '../src/components/AppText';
import { Banner } from '../src/components/Banner';
import { Button } from '../src/components/Button';
import { ErrorState } from '../src/components/ErrorState';
import { LoadingOverlay } from '../src/components/LoadingOverlay';
import { Screen } from '../src/components/Screen';
import { Skeleton } from '../src/components/Skeleton';
import { exportCost } from '../src/domain/credits';
import type { ExportTarget } from '../src/domain/types';
import { useCredits } from '../src/features/credits/useCredits';
import { availableTargets } from '../src/features/export/exportService';
import { useExport } from '../src/features/export/useExport';
import { usePackStickers } from '../src/features/packs/usePacks';
import { useStickersByIds } from '../src/features/stickers/useStickers';
import { errorCodeOf } from '../src/lib/errors';
import { spacing } from '../src/theme';

const SUCCESS_KEYS: Record<ExportTarget, string> = {
  gallery: 'export.savedToGallery',
  whatsapp: 'export.sentToWhatsApp',
  telegram: 'export.sentToTelegram',
  share: 'export.savedToGallery',
  imessage: 'export.addedToMessages',
};

export default function ExportScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ packId?: string; stickerIds?: string }>();
  const packId = params.packId ?? null;
  const stickerIds = useMemo(
    () => (params.stickerIds ?? '').split(',').filter(Boolean),
    [params.stickerIds],
  );

  const { balance } = useCredits();
  const packStickers = usePackStickers(packId);
  const selectedStickers = useStickersByIds(stickerIds);
  const exportMutation = useExport();
  const [message, setMessage] = useState<string | null>(null);

  const stickers = packId ? (packStickers.data ?? []) : (selectedStickers.data ?? []);
  const loading = packId ? packStickers.isPending : selectedStickers.isPending;
  const cost = exportCost(stickers.length);
  const targets = useMemo(
    () => availableTargets(packId, stickers.length),
    [packId, stickers.length],
  );

  const run = (target: ExportTarget) => {
    if (balance.export < cost) {
      router.push('/paywall?reason=exports');
      return;
    }

    Alert.alert(
      t('export.confirmTitle', { count: stickers.length }),
      t('export.confirmBody', { count: cost, cost }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.continue'),
          onPress: () =>
            exportMutation.mutate(
              { target, packId, stickers },
              {
                onSuccess: (result) => {
                  if (result.outcome === 'cancelled') {
                    setMessage(t('export.cancelled'));
                    return;
                  }
                  setMessage(
                    result.outcome === 'fell_back_to_share'
                      ? t('export.telegramFallback')
                      : t(SUCCESS_KEYS[target]),
                  );
                },
                onError: (error) => {
                  if (errorCodeOf(error) === 'insufficient_credits') {
                    router.push('/paywall?reason=exports');
                  }
                },
              },
            ),
        },
      ],
    );
  };

  if (loading) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <Skeleton height={24} width="50%" />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="headline">{t('export.confirmTitle', { count: stickers.length })}</AppText>
      <AppText variant="footnote" tone="muted">
        {t('export.confirmBody', { count: cost, cost })}
      </AppText>

      {message ? <Banner tone="success" message={message} /> : null}
      {exportMutation.isError ? <ErrorState error={exportMutation.error} compact /> : null}

      <View style={styles.targets}>
        {targets.map(({ target, available, reason }) => (
          <View key={target} style={styles.target}>
            <Button
              label={t(`export.targets.${target}`)}
              variant={target === 'gallery' ? 'primary' : 'secondary'}
              disabled={!available || exportMutation.isPending}
              onPress={() => run(target)}
              testID={`export-${target}`}
            />
            {!available && reason ? (
              <AppText variant="caption" tone="muted">
                {reason === 'app_not_installed'
                  ? t('export.appNotInstalled', { app: t(`export.targets.${target}`) })
                  : reason === 'needs_pack'
                    ? t('export.needsPack')
                    : t('export.singleStickerOnly')}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>

      <Button label={t('common.close')} variant="ghost" onPress={() => router.back()} />

      <LoadingOverlay visible={exportMutation.isPending} message={t('export.exporting')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingTop: spacing.lg },
  targets: { gap: spacing.md },
  target: { gap: spacing.xs },
});
