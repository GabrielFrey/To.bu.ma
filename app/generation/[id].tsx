import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '../../src/components/AppText';
import { Banner } from '../../src/components/Banner';
import { Button } from '../../src/components/Button';
import { ErrorState } from '../../src/components/ErrorState';
import { Screen } from '../../src/components/Screen';
import { StickerImage } from '../../src/components/StickerImage';
import { fetchStickerForGeneration } from '../../src/features/generation/generationApi';
import {
  useGeneration,
  useStickerFeedback,
  isGenerationPending,
} from '../../src/features/generation/useGeneration';
import { useDraft } from '../../src/store/draft';
import { spacing } from '../../src/theme';
import { useTheme } from '../../src/theme/useTheme';

export default function GenerationScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const generation = useGeneration(id ?? null);
  const feedback = useStickerFeedback();
  const setEmotion = useDraft((state) => state.setEmotion);
  const setCustomIdea = useDraft((state) => state.setCustomIdea);
  const [feedbackGiven, setFeedbackGiven] = useState(false);

  const { data: stickerId } = useQuery({
    queryKey: ['generation-sticker', id],
    enabled: generation.data?.status === 'done',
    queryFn: () => fetchStickerForGeneration(id as string),
  });

  if (generation.isPending) {
    return (
      <Screen contentStyle={styles.center}>
        <ActivityIndicator color={theme.colors.brand} size="large" />
      </Screen>
    );
  }

  if (generation.isError || !generation.data) {
    return (
      <Screen>
        <ErrorState error={generation.error} onRetry={() => void generation.refetch()} />
      </Screen>
    );
  }

  const value = generation.data;

  if (isGenerationPending(value)) {
    return (
      <Screen contentStyle={styles.center}>
        <ActivityIndicator color={theme.colors.brand} size="large" />
        <AppText variant="title" center>
          {value.status === 'queued' ? t('generation.queued') : t('generation.running')}
        </AppText>
        <AppText variant="body" tone="muted" center>
          {t('home.backgroundHint')}
        </AppText>
        <Button
          label={t('home.continueInBackground')}
          variant="secondary"
          onPress={() => router.replace('/(tabs)')}
        />
      </Screen>
    );
  }

  if (value.status === 'failed') {
    return (
      <Screen contentStyle={styles.failed}>
        <AppText variant="largeTitle" center accessibilityElementsHidden>
          🫤
        </AppText>
        <AppText variant="title" center>
          {t('generation.failed')}
        </AppText>
        <AppText variant="body" tone="muted" center>
          {t(`errors.${value.errorCode ?? 'unknown'}`, { defaultValue: t('errors.unknown') })}
        </AppText>
        <Banner tone="success" message={t('generation.retryFree')} />
        <Button
          label={t('generation.retry')}
          onPress={() => {
            // The prompt is kept in the draft, so the retry only costs another tap.
            router.replace('/(tabs)');
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      {value.resultPath ? (
        <View style={styles.preview}>
          <StickerImage
            path={value.resultPath}
            size={280}
            checkerboard
            accessibilityLabel={t('generation.done')}
          />
          <AppText variant="caption" tone="muted" center>
            {t('generation.transparencyHint')}
          </AppText>
        </View>
      ) : null}

      <View style={styles.row}>
        <Button
          label={t('generation.feedbackLove')}
          variant="secondary"
          disabled={!stickerId || feedbackGiven}
          onPress={() => {
            if (!stickerId) return;
            feedback.mutate({ stickerId, value: 1 });
            setFeedbackGiven(true);
          }}
        />
        <Button
          label={t('generation.feedbackDislike')}
          variant="secondary"
          disabled={!stickerId || feedbackGiven}
          onPress={() => {
            if (!stickerId) return;
            feedback.mutate({ stickerId, value: -1 });
            setFeedbackGiven(true);
          }}
        />
      </View>

      {feedbackGiven ? (
        <AppText variant="footnote" tone="success" center>
          {t('generation.feedbackThanks')}
        </AppText>
      ) : null}

      <Button
        label={t('generation.export')}
        disabled={!stickerId}
        onPress={() => router.push(`/export?stickerIds=${stickerId ?? ''}`)}
        testID="export-sticker"
      />
      <Button
        label={t('generation.addToPack')}
        variant="secondary"
        disabled={!stickerId}
        onPress={() => router.push(`/add-stickers?stickerIds=${stickerId ?? ''}`)}
      />
      <Button
        label={t('generation.reusePrompt')}
        variant="secondary"
        onPress={() => {
          if (value.emotion) {
            setEmotion(value.emotion);
          } else {
            setCustomIdea(value.prompt);
          }
          router.replace('/(tabs)');
        }}
      />
      <Button
        label={t('moderation.report')}
        variant="ghost"
        disabled={!stickerId}
        onPress={() => router.push(`/report?stickerId=${stickerId ?? ''}`)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingTop: spacing.lg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  failed: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
  },
  preview: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
});
