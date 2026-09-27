import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import DragList, { type DragListRenderItemInfo } from 'react-native-draglist';

import { AppText } from '../../src/components/AppText';
import { Banner } from '../../src/components/Banner';
import { Button } from '../../src/components/Button';
import { ErrorState } from '../../src/components/ErrorState';
import { Screen } from '../../src/components/Screen';
import { Skeleton } from '../../src/components/Skeleton';
import { StickerImage } from '../../src/components/StickerImage';
import { TextField } from '../../src/components/TextField';
import { LIMITS } from '../../src/domain/limits';
import { reorderStickers } from '../../src/domain/packs';
import type { PackSticker } from '../../src/domain/types';
import {
  useDeletePack,
  usePack,
  usePackReadiness,
  usePackStickers,
  useRemoveStickerFromPack,
  useRenamePack,
  useReorderPack,
  useSetTraySticker,
} from '../../src/features/packs/usePacks';
import { haptics } from '../../src/lib/haptics';
import { radius, spacing } from '../../src/theme';
import { useTheme } from '../../src/theme/useTheme';

export default function PackScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const packId = id ?? null;

  const pack = usePack(packId);
  const stickers = usePackStickers(packId);
  const rename = useRenamePack();
  const removePack = useDeletePack();
  const removeSticker = useRemoveStickerFromPack();
  const setTray = useSetTraySticker();
  const reorder = useReorderPack();

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  const readiness = usePackReadiness(pack.data, stickers.data, 'whatsapp');

  if (pack.isPending || stickers.isPending) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <Skeleton height={28} width="60%" />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </Screen>
    );
  }

  if (pack.isError || !pack.data) {
    return (
      <Screen>
        <ErrorState error={pack.error} onRetry={() => void pack.refetch()} />
      </Screen>
    );
  }

  const packData = pack.data;
  const items = stickers.data ?? [];

  const onReordered = async (fromIndex: number, toIndex: number) => {
    const next = reorderStickers(items, fromIndex, toIndex);
    reorder.mutate({
      packId: packData.id,
      stickerIds: next.map((sticker) => sticker.id),
    });
  };

  const confirmDeletePack = () => {
    Alert.alert(t('packs.confirmDeleteTitle'), t('packs.confirmDeleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          removePack.mutate(packData.id, {
            onSuccess: () => router.back(),
          }),
      },
    ]);
  };

  const renderItem = (info: DragListRenderItemInfo<PackSticker>) => {
    const isTray = info.item.id === packData.trayStickerId;

    return (
      <Pressable
        onPressIn={info.onDragStart}
        onPressOut={info.onDragEnd}
        accessibilityRole="button"
        accessibilityLabel={t('packs.reorderHint')}
        style={[
          styles.item,
          {
            backgroundColor: info.isActive ? theme.colors.surfaceElevated : theme.colors.surface,
            borderColor: isTray ? theme.colors.brand : theme.colors.border,
            borderWidth: isTray ? 2 : StyleSheet.hairlineWidth,
          },
        ]}
      >
        <StickerImage path={info.item.pngPath} size={64} checkerboard />

        <View style={styles.itemBody}>
          <AppText variant="callout">{`#${info.index + 1}`}</AppText>
          {isTray ? (
            <AppText variant="caption" tone="brand">
              {t('packs.trayIcon')}
            </AppText>
          ) : (
            <Button
              label={t('packs.setTrayIcon')}
              variant="ghost"
              fullWidth={false}
              onPress={() => setTray.mutate({ packId: packData.id, stickerId: info.item.id })}
            />
          )}
        </View>

        <Button
          label={t('packs.removeSticker')}
          variant="ghost"
          fullWidth={false}
          onPress={() => {
            haptics.warning();
            removeSticker.mutate({ packId: packData.id, stickerId: info.item.id });
          }}
        />
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <DragList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onReordered={onReordered}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            {renaming ? (
              <>
                <TextField
                  label={t('packs.namePlaceholder')}
                  value={name}
                  onChangeText={setName}
                  maxLength={LIMITS.packNameMaxLength}
                  showCounter
                  autoFocus
                />
                <View style={styles.row}>
                  <Button
                    label={t('common.save')}
                    loading={rename.isPending}
                    disabled={name.trim().length === 0}
                    onPress={() =>
                      rename.mutate(
                        { packId: packData.id, name },
                        { onSuccess: () => setRenaming(false) },
                      )
                    }
                  />
                  <Button
                    label={t('common.cancel')}
                    variant="ghost"
                    onPress={() => setRenaming(false)}
                  />
                </View>
              </>
            ) : (
              <>
                <AppText variant="largeTitle">{packData.name}</AppText>
                <AppText variant="footnote" tone="muted">
                  {t('packs.stickerCount', { count: items.length })}
                </AppText>
              </>
            )}

            {readiness.valid ? (
              <Banner tone="success" message={t('packs.readyForWhatsApp')} />
            ) : (
              <View style={styles.issues}>
                {readiness.issues.map((issue) => (
                  <Banner
                    key={issue.code}
                    tone="warning"
                    message={t(`export.issues.${issue.code}`, {
                      ...issue.meta,
                      count: issue.meta?.count ?? issue.meta?.missing ?? 0,
                    })}
                  />
                ))}
              </View>
            )}

            <Button
              label={t('packs.addStickers')}
              onPress={() => router.push(`/add-stickers?packId=${packData.id}`)}
              testID="add-stickers"
            />
            <Button
              label={t('export.title')}
              variant="secondary"
              disabled={items.length === 0}
              onPress={() => router.push(`/export?packId=${packData.id}`)}
              testID="export-pack"
            />
            {items.length > 0 ? (
              <AppText variant="caption" tone="muted">
                {t('packs.reorderHint')}
              </AppText>
            ) : null}
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Button
              label={t('common.rename')}
              variant="secondary"
              onPress={() => {
                setName(packData.name);
                setRenaming(true);
              }}
            />
            <Button
              label={t('common.delete')}
              variant="destructive"
              loading={removePack.isPending}
              onPress={confirmDeletePack}
            />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: { gap: spacing.md, paddingBottom: spacing.md },
  footer: { gap: spacing.md, paddingTop: spacing.xl },
  issues: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  itemBody: { flex: 1, gap: spacing.xs },
});
