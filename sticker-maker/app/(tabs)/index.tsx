import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../../src/components/AppText';
import { Banner } from '../../src/components/Banner';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { CreditPill } from '../../src/components/CreditPill';
import { ErrorState } from '../../src/components/ErrorState';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { LIMITS } from '../../src/domain/limits';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { useCredits } from '../../src/features/credits/useCredits';
import { EmotionGrid } from '../../src/features/generation/EmotionGrid';
import {
  useStartGeneration,
  useSuggestIdeas,
  useUnfinishedGenerations,
} from '../../src/features/generation/useGeneration';
import {
  captureFromCamera,
  libraryAccess,
  openSystemSettings,
  pickFromLibrary,
  presentLimitedLibraryPicker,
} from '../../src/features/photos/photoApi';
import { errorCodeOf } from '../../src/lib/errors';
import {
  hasNotificationPermission,
  registerPushToken,
  requestNotificationPermission,
} from '../../src/lib/notifications';
import { track } from '../../src/lib/observability';
import { useDraft } from '../../src/store/draft';
import { usePreferences } from '../../src/store/preferences';
import { radius, spacing } from '../../src/theme';
import { useTheme } from '../../src/theme/useTheme';

export default function CreateScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { userId } = useAuth();
  const { balance } = useCredits();

  const draft = useDraft();
  const notificationsAsked = usePreferences((state) => state.notificationsAsked);
  const markNotificationsAsked = usePreferences((state) => state.markNotificationsAsked);

  const [limitedAccess, setLimitedAccess] = useState(false);
  const [topic, setTopic] = useState('');
  const [ideas, setIdeas] = useState<string[]>([]);
  const [pickerError, setPickerError] = useState<unknown>(null);

  const suggest = useSuggestIdeas();
  const start = useStartGeneration();
  const { data: pending } = useUnfinishedGenerations();

  const chooseFrom = async (source: 'library' | 'camera') => {
    setPickerError(null);
    try {
      const photo = source === 'library' ? await pickFromLibrary() : await captureFromCamera();
      if (!photo) return;

      draft.setPhoto(photo);
      track('photo_selected', { source });
      setLimitedAccess(source === 'library' && (await libraryAccess()) === 'limited');
      router.push('/crop');
    } catch (error) {
      setPickerError(error);
    }
  };

  const onSuggest = () => {
    if (topic.trim().length < 2) return;
    suggest.mutate(
      { topic, locale: i18n.language },
      { onSuccess: setIdeas },
    );
  };

  /**
   * Notifications are asked for here, immediately before the first wait, because that is
   * the one moment the permission obviously pays for itself.
   */
  const ensureNotificationsAsked = async (): Promise<void> => {
    if (notificationsAsked || (await hasNotificationPermission())) return;

    const granted = await new Promise<boolean>((resolve) => {
      Alert.alert(t('notifications.askTitle'), t('notifications.askBody'), [
        { text: t('notifications.later'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('notifications.allow'), onPress: () => resolve(true) },
      ]);
    });

    markNotificationsAsked();
    if (granted && (await requestNotificationPermission()) && userId) {
      await registerPushToken(userId);
    }
  };

  const onGenerate = async () => {
    if (!draft.photo) {
      Alert.alert(t('home.photoRequired'));
      return;
    }
    if (!draft.emotionId && !draft.customIdea) {
      Alert.alert(t('home.ideaRequired'));
      return;
    }
    if (!userId) return;

    if (balance.generation < 1) {
      router.push('/paywall?reason=generations');
      return;
    }

    await ensureNotificationsAsked();

    start.mutate(
      {
        userId,
        photoUri: draft.photo.uri,
        emotionId: draft.emotionId,
        customIdea: draft.customIdea,
        stickerText: draft.stickerText.trim() || null,
        additionalInstructions: draft.additionalInstructions.trim() || null,
        locale: i18n.language,
        clientJobId: draft.clientJobId,
      },
      {
        onSuccess: (result) => {
          // A fresh job id for the next attempt; the old one stays tied to this charge.
          draft.rotateJobId();
          router.push(`/generation/${result.generationId}`);
        },
        onError: (error) => {
          if (errorCodeOf(error) === 'insufficient_credits') {
            router.push('/paywall?reason=generations');
          }
        },
      },
    );
  };

  const pendingCount = pending?.length ?? 0;

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="largeTitle">{t('home.title')}</AppText>
        <CreditPill
          generationCredits={balance.generation}
          exportCredits={balance.export}
          onPress={() => router.push('/paywall')}
          testID="credit-pill"
        />
      </View>

      {pendingCount > 0 ? (
        <Banner
          tone="info"
          message={t('generation.pending', { count: pendingCount })}
          action={
            <Button
              label={t('common.select')}
              variant="ghost"
              fullWidth={false}
              onPress={() => {
                const first = pending?.[0];
                if (first) router.push(`/generation/${first.id}`);
              }}
            />
          }
        />
      ) : null}

      <Card>
        {draft.photo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('home.changePhoto')}
            onPress={() => router.push('/crop')}
            style={styles.photoWrapper}
          >
            <Image
              source={{ uri: draft.photo.uri }}
              style={styles.photo}
              contentFit="cover"
              accessibilityLabel={t('home.changePhoto')}
            />
            <AppText variant="footnote" tone="brand" center>
              {t('crop.title')}
            </AppText>
          </Pressable>
        ) : (
          <View style={styles.pickerButtons}>
            <Button
              label={t('home.pickPhoto')}
              onPress={() => void chooseFrom('library')}
              testID="pick-photo"
            />
            <Button
              label={t('home.takePhoto')}
              variant="secondary"
              onPress={() => void chooseFrom('camera')}
            />
          </View>
        )}

        {draft.photo ? (
          <Button
            label={t('home.changePhoto')}
            variant="secondary"
            onPress={() => void chooseFrom('library')}
          />
        ) : null}
      </Card>

      {limitedAccess ? (
        <Banner
          tone="info"
          message={t('home.limitedAccessBody')}
          action={
            <Button
              label={t('home.selectMorePhotos')}
              variant="ghost"
              fullWidth={false}
              onPress={() => void presentLimitedLibraryPicker()}
            />
          }
        />
      ) : null}

      {pickerError ? (
        <View style={styles.permissionBlock}>
          <ErrorState error={pickerError} compact />
          {['photo_permission', 'camera_permission'].includes(errorCodeOf(pickerError)) ? (
            <Button
              label={t('errors.openSettings')}
              variant="secondary"
              onPress={() => void openSystemSettings()}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <AppText variant="headline">{t('home.chooseIdea')}</AppText>
        <EmotionGrid
          selectedId={draft.emotionId}
          onSelect={(emotionId) => draft.setEmotion(emotionId)}
        />
      </View>

      <View style={styles.section}>
        <TextField
          label={t('home.topicLabel')}
          placeholder={t('home.topicPlaceholder')}
          value={topic}
          onChangeText={setTopic}
          maxLength={LIMITS.topicMaxLength}
          showCounter
          returnKeyType="search"
          onSubmitEditing={onSuggest}
        />
        <Button
          label={suggest.isPending ? t('home.suggesting') : t('home.suggestIdeas')}
          variant="secondary"
          loading={suggest.isPending}
          disabled={topic.trim().length < 2}
          onPress={onSuggest}
        />
        {suggest.isError ? <ErrorState error={suggest.error} compact /> : null}

        {ideas.length > 0 ? (
          <View style={styles.ideas}>
            {ideas.map((idea) => (
              <Chip
                key={idea}
                label={idea}
                selected={draft.customIdea === idea}
                onPress={() => draft.setCustomIdea(idea)}
              />
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <TextField
          label={t('home.captionLabel')}
          placeholder={t('home.captionPlaceholder', { max: LIMITS.stickerTextMaxLength })}
          value={draft.stickerText}
          onChangeText={draft.setStickerText}
          maxLength={LIMITS.stickerTextMaxLength}
          showCounter
          autoCapitalize="none"
        />
        <TextField
          label={t('home.instructionsLabel')}
          placeholder={t('home.instructionsPlaceholder')}
          value={draft.additionalInstructions}
          onChangeText={draft.setAdditionalInstructions}
          maxLength={LIMITS.additionalInstructionsMaxLength}
          showCounter
          multiline
        />
      </View>

      {start.isError ? <ErrorState error={start.error} compact /> : null}

      <Button
        label={start.isPending ? t('home.generating') : t('home.generate')}
        loading={start.isPending}
        disabled={!draft.photo || (!draft.emotionId && !draft.customIdea)}
        onPress={() => void onGenerate()}
        testID="generate"
      />

      {start.isPending ? (
        <View style={[styles.hint, { borderColor: theme.colors.border }]}>
          <ActivityIndicator color={theme.colors.brand} />
          <AppText variant="footnote" tone="muted">
            {t('home.backgroundHint')}
          </AppText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  section: { gap: spacing.md },
  pickerButtons: { gap: spacing.sm },
  photoWrapper: { gap: spacing.sm },
  photo: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.md,
  },
  permissionBlock: { gap: spacing.sm },
  ideas: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
