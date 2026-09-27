import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '../src/components/AppText';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { EmptyState } from '../src/components/EmptyState';
import { ErrorState } from '../src/components/ErrorState';
import { Screen } from '../src/components/Screen';
import { SkeletonGrid } from '../src/components/Skeleton';
import { StickerImage } from '../src/components/StickerImage';
import { TextField } from '../src/components/TextField';
import { LIMITS } from '../src/domain/limits';
import {
  useAddStickersToPack,
  useCreatePack,
  usePacks,
} from '../src/features/packs/usePacks';
import { useStickerLibrary, useStickerSelection } from '../src/features/stickers/useStickers';
import { radius, spacing } from '../src/theme';
import { useTheme } from '../src/theme/useTheme';

const COLUMNS = 3;

/**
 * One screen, two directions. Coming from a pack it asks "which stickers?"; coming from
 * the library or a fresh sticker it asks "which pack?". Both end in the same mutation.
 */
export default function AddStickersScreen() {
  const params = useLocalSearchParams<{ packId?: string; stickerIds?: string }>();
  const preselected = (params.stickerIds ?? '').split(',').filter(Boolean);

  return params.packId ? (
    <PickStickers packId={params.packId} />
  ) : (
    <PickPack stickerIds={preselected} />
  );
}

function PickStickers({ packId }: { packId: string }) {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const library = useStickerLibrary();
  const selection = useStickerSelection();
  const add = useAddStickersToPack();

  const tileSize =
    (Dimensions.get('window').width - spacing.lg * 2 - spacing.md * (COLUMNS - 1)) / COLUMNS;

  if (library.isPending) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <SkeletonGrid count={9} size={tileSize} />
      </Screen>
    );
  }

  if (library.isError) {
    return (
      <Screen>
        <ErrorState error={library.error} onRetry={() => void library.refetch()} />
      </Screen>
    );
  }

  if (library.stickers.length === 0) {
    return (
      <Screen>
        <EmptyState
          emoji="🗂️"
          title={t('library.emptyTitle')}
          body={t('library.emptyBody')}
          actionLabel={t('library.emptyCta')}
          onAction={() => router.replace('/(tabs)')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="footnote" tone="muted">
        {t('packs.stickerCount', { count: selection.selectedIds.length })}
      </AppText>

      <View style={styles.grid}>
        {library.stickers.map((sticker) => {
          const selected = selection.isSelected(sticker.id);
          return (
            <Pressable
              key={sticker.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => selection.toggle(sticker.id)}
              style={[
                styles.tile,
                {
                  width: tileSize,
                  height: tileSize,
                  borderColor: selected ? theme.colors.brand : theme.colors.border,
                  borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <StickerImage path={sticker.pngPath} size={tileSize - spacing.sm} checkerboard />
            </Pressable>
          );
        })}
      </View>

      {library.hasNextPage ? (
        <Button
          label={t('common.continue')}
          variant="ghost"
          loading={library.isFetchingNextPage}
          onPress={() => void library.fetchNextPage()}
        />
      ) : null}

      <Button
        label={t('packs.addStickers')}
        disabled={selection.selectedIds.length === 0}
        loading={add.isPending}
        onPress={() =>
          add.mutate(
            { packId, stickerIds: selection.selectedIds },
            {
              onSuccess: () => router.back(),
              onError: () => Alert.alert(t('errors.unknown')),
            },
          )
        }
        testID="confirm-add-stickers"
      />
    </Screen>
  );
}

function PickPack({ stickerIds }: { stickerIds: string[] }) {
  const router = useRouter();
  const { t } = useTranslation();
  const packs = usePacks();
  const add = useAddStickersToPack();
  const createPack = useCreatePack();
  const [name, setName] = useState('');

  if (packs.isPending) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <SkeletonGrid count={3} size={72} />
      </Screen>
    );
  }

  if (packs.isError) {
    return (
      <Screen>
        <ErrorState error={packs.error} onRetry={() => void packs.refetch()} />
      </Screen>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <AppText variant="headline">{t('packs.choose')}</AppText>

      {packs.data.map((pack) => (
        <Card
          key={pack.id}
          accessibilityLabel={pack.name}
          onPress={() =>
            add.mutate(
              { packId: pack.id, stickerIds },
              {
                onSuccess: () => router.back(),
                onError: () => Alert.alert(t('errors.unknown')),
              },
            )
          }
        >
          <AppText variant="headline">{pack.name}</AppText>
          <AppText variant="footnote" tone="muted">
            {t('packs.stickerCount', { count: pack.stickerCount })}
          </AppText>
        </Card>
      ))}

      <Card>
        <AppText variant="headline">{t('packs.create')}</AppText>
        <TextField
          label={t('packs.namePlaceholder')}
          value={name}
          onChangeText={setName}
          maxLength={LIMITS.packNameMaxLength}
          showCounter
        />
        <Button
          label={t('common.create')}
          disabled={name.trim().length === 0}
          loading={createPack.isPending}
          onPress={() =>
            createPack.mutate(
              { name, stickerIds },
              {
                onSuccess: (pack) => router.replace(`/pack/${pack.id}`),
                onError: () => Alert.alert(t('errors.unknown')),
              },
            )
          }
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
});
