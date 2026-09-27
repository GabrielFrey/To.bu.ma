import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { AppText } from '../../src/components/AppText';
import { Banner } from '../../src/components/Banner';
import { Button } from '../../src/components/Button';
import { ErrorState } from '../../src/components/ErrorState';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { useDeleteAccount } from '../../src/features/account/useAccount';
import { usePreferences } from '../../src/store/preferences';
import { spacing } from '../../src/theme';

/**
 * Deletion is irreversible, so it is gated behind typing the confirmation word rather than
 * a single destructive tap, and the copy says out loud that purchased credits are gone.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const remove = useDeleteAccount();
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState(false);

  const confirmWord = t('deleteAccount.confirmWord');
  const matches = typed.trim().toUpperCase() === confirmWord.toUpperCase();

  if (done) {
    return (
      <Screen contentStyle={styles.center}>
        <Banner tone="success" message={t('deleteAccount.done')} />
        <Button
          label={t('common.close')}
          onPress={() => {
            // A deleted account means a fresh guest session on the next launch.
            usePreferences.setState({ onboardingCompleted: false });
            router.replace('/');
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="title">{t('deleteAccount.title')}</AppText>
      <AppText variant="body" tone="muted">
        {t('deleteAccount.body')}
      </AppText>

      <TextField
        label={t('deleteAccount.confirmHint', { word: confirmWord })}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
        testID="delete-confirm-input"
      />

      {remove.isError ? <ErrorState error={remove.error} compact /> : null}
      {remove.isError ? (
        <AppText variant="footnote" tone="danger">
          {t('deleteAccount.failed')}
        </AppText>
      ) : null}

      <Button
        label={remove.isPending ? t('deleteAccount.deleting') : t('deleteAccount.confirm')}
        variant="destructive"
        disabled={!matches}
        loading={remove.isPending}
        onPress={() => remove.mutate(undefined, { onSuccess: () => setDone(true) })}
        testID="delete-account-confirm"
      />
      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingTop: spacing.lg },
  center: { flex: 1, justifyContent: 'center', gap: spacing.lg },
});
