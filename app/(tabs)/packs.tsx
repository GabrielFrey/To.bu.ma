import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, StyleSheet, View } from 'react-native';

import { AppText } from '../../src/components/AppText';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorState } from '../../src/components/ErrorState';
import { Screen } from '../../src/components/Screen';
import { Skeleton } from '../../src/components/Skeleton';
import { TextField } from '../../src/components/TextField';
import { LIMITS } from '../../src/domain/limits';
import type { Pack } from '../../src/domain/types';
import { useCreatePack, usePacks } from '../../src/features/packs/usePacks';
import { spacing } from '../../src/theme';
import { useTheme } from '../../src/theme/useTheme';

export default function PacksScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const packs = usePacks();
  const createPack = useCreatePack();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const submit = () => {
    if (name.trim().length === 0) return;
    createPack.mutate(
      { name },
      {
        onSuccess: (pack) => {
          setName('');
          setCreating(false);
          router.push(`/pack/${pack.id}`);
        },
        onError: () => Alert.alert(t('errors.unknown')),
      },
    );
  };

  if (packs.isPending) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <Skeleton height={72} />
        <Skeleton height={72} />
        <Skeleton height={72} />
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

  const composer = creating ? (
    <Card>
      <TextField
        label={t('packs.namePlaceholder')}
        value={name}
        onChangeText={setName}
        maxLength={LIMITS.packNameMaxLength}
        showCounter
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <View style={styles.row}>
        <Button
          label={t('common.create')}
          loading={createPack.isPending}
          disabled={name.trim().length === 0}
          onPress={submit}
        />
        <Button
          label={t('common.cancel')}
          variant="ghost"
          onPress={() => {
            setCreating(false);
            setName('');
          }}
        />
      </View>
    </Card>
  ) : (
    <Button label={t('packs.create')} onPress={() => setCreating(true)} testID="create-pack" />
  );

  if (packs.data.length === 0) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <EmptyState
          emoji="📦"
          title={t('packs.emptyTitle')}
          body={t('packs.emptyBody')}
          testID="packs-empty"
        />
        {composer}
      </Screen>
    );
  }

  const renderItem = ({ item }: { item: Pack }) => {
    const ready =
      item.stickerCount >= LIMITS.whatsapp.minStickers &&
      item.stickerCount <= LIMITS.whatsapp.maxStickers &&
      item.trayStickerId !== null;

    return (
      <Card onPress={() => router.push(`/pack/${item.id}`)} accessibilityLabel={item.name}>
        <AppText variant="headline">{item.name}</AppText>
        <AppText variant="footnote" tone="muted">
          {t('packs.stickerCount', { count: item.stickerCount })}
        </AppText>
        <AppText variant="caption" tone={ready ? 'success' : 'muted'}>
          {ready ? t('packs.readyForWhatsApp') : t('packs.notReadyForWhatsApp')}
        </AppText>
      </Card>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={packs.data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<View style={styles.header}>{composer}</View>}
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
  header: { paddingBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
});
