import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Dimensions, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../../src/components/AppText';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorState } from '../../src/components/ErrorState';
import { Screen } from '../../src/components/Screen';
import { SkeletonGrid } from '../../src/components/Skeleton';
import { StickerImage } from '../../src/components/StickerImage';
import type { Sticker } from '../../src/domain/types';
import {
  useDeleteStickers,
  useStickerLibrary,
  useStickerSelection,
} from '../../src/features/stickers/useStickers';
import { haptics } from '../../src/lib/haptics';
import { radius, spacing } from '../../src/theme';
import { useTheme } from '../../src/theme/useTheme';

const COLUMNS = 3;

export default function LibraryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const library = useStickerLibrary();
  const selection = useStickerSelection();
  const remove = useDeleteStickers();

  const tileSize =
    (Dimensions.get('window').width - spacing.lg * 2 - spacing.md * (COLUMNS - 1)) / COLUMNS;

  const confirmDelete = () => {
    const count = selection.selectedIds.length;
    Alert.alert(t('library.confirmDeleteTitle'), t('library.confirmDeleteBody', { count }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          remove.mutate(selection.selectedIds, { onSuccess: selection.clear });
        },
      },
    ]);
  };

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
          onAction={() => router.push('/(tabs)')}
          testID="library-empty"
        />
      </Screen>
    );
  }

  const renderItem = ({ item }: { item: Sticker }) => {
    const selected = selection.isSelected(item.id);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={t('library.title')}
        onPress={() => {
          if (selection.isSelecting) {
            selection.toggle(item.id);
          } else {
            router.push(`/export?stickerIds=${item.id}`);
          }
        }}
        onLongPress={() => {
          haptics.press();
          selection.toggle(item.id);
        }}
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
        <StickerImage path={item.pngPath} size={tileSize - spacing.sm} checkerboard />
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={library.stickers}
        keyExtractor={(item) => item.id}
        numColumns={COLUMNS}
        renderItem={renderItem}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.content}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (library.hasNextPage && !library.isFetchingNextPage) {
            void library.fetchNextPage();
          }
        }}
        ListFooterComponent={
          library.isFetchingNextPage ? (
            <ActivityIndicator color={theme.colors.brand} style={styles.footer} />
          ) : null
        }
      />

      {selection.isSelecting ? (
        <View
          style={[
            styles.actionBar,
            { backgroundColor: theme.colors.surfaceElevated, borderTopColor: theme.colors.border },
          ]}
        >
          <AppText variant="callout">
            {t('library.selected', { count: selection.selectedIds.length })}
          </AppText>
          <View style={styles.actions}>
            <Button
              label={t('library.exportSelected')}
              fullWidth={false}
              onPress={() =>
                router.push(`/export?stickerIds=${selection.selectedIds.join(',')}`)
              }
            />
            <Button
              label={t('library.addSelectedToPack')}
              variant="secondary"
              fullWidth={false}
              onPress={() =>
                router.push(`/add-stickers?stickerIds=${selection.selectedIds.join(',')}`)
              }
            />
            <Button
              label={t('library.deleteSelected')}
              variant="destructive"
              fullWidth={false}
              loading={remove.isPending}
              onPress={confirmDelete}
            />
            <Button
              label={t('common.cancel')}
              variant="ghost"
              fullWidth={false}
              onPress={selection.clear}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: { gap: spacing.md },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  footer: { marginVertical: spacing.lg },
  actionBar: {
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
