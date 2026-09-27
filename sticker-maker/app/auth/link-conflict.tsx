import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { AppText } from '../../src/components/AppText';
import { Button } from '../../src/components/Button';
import { ErrorState } from '../../src/components/ErrorState';
import { Screen } from '../../src/components/Screen';
import {
  claimSignInBonus,
  signInWithApple,
  signInWithOAuth,
  type SocialProvider,
} from '../../src/features/auth/authApi';
import { spacing } from '../../src/theme';

/**
 * Reached when a guest tries to attach an identity that already belongs to another
 * account. Supabase cannot merge the two, so the honest options are "open the account you
 * already have" or "stay a guest" — and the screen says plainly what happens to the
 * stickers made as a guest.
 */
export default function LinkConflictScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { provider } = useLocalSearchParams<{ provider?: SocialProvider }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const openExistingAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome =
        provider === 'apple' ? await signInWithApple() : await signInWithOAuth('google');

      if (outcome === 'cancelled') return;
      await claimSignInBonus();
      router.dismissAll();
      router.replace('/(tabs)');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="largeTitle">{t('auth.conflictTitle')}</AppText>
      <AppText variant="body" tone="muted">
        {t('auth.conflictBody')}
      </AppText>

      {error ? <ErrorState error={error} compact /> : null}

      <Button
        label={t('auth.conflictUseExisting')}
        loading={busy}
        onPress={() => void openExistingAccount()}
        testID="use-existing-account"
      />
      <Button
        label={t('auth.conflictStayGuest')}
        variant="secondary"
        disabled={busy}
        onPress={() => router.dismissAll()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingTop: spacing.lg },
});
