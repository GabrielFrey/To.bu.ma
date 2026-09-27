import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { errorTranslationKey } from '../lib/errors';
import { spacing } from '../theme';

import { AppText } from './AppText';
import { Button } from './Button';

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
  testID?: string;
}

/** Every failure the user sees goes through here, so nothing leaks an English server string. */
export function ErrorState({ error, onRetry, compact = false, testID }: ErrorStateProps) {
  const { t } = useTranslation();
  const message = t(errorTranslationKey(error));

  return (
    <View testID={testID} style={compact ? styles.compact : styles.container}>
      {!compact ? (
        <AppText variant="largeTitle" center accessibilityElementsHidden>
          😕
        </AppText>
      ) : null}
      <AppText variant={compact ? 'footnote' : 'body'} tone="danger" center={!compact}>
        {message}
      </AppText>
      {onRetry ? (
        <Button
          label={t('common.retry')}
          variant="secondary"
          onPress={onRetry}
          fullWidth={false}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  compact: {
    gap: spacing.sm,
  },
  action: {
    paddingHorizontal: spacing.xl,
  },
});
