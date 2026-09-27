import React from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../theme';

import { AppText } from './AppText';
import { Button } from './Button';

export interface EmptyStateProps {
  emoji?: string;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}

export function EmptyState({
  emoji = '✨',
  title,
  body,
  actionLabel,
  onAction,
  testID,
}: EmptyStateProps) {
  return (
    <View testID={testID} style={styles.container}>
      <AppText variant="largeTitle" center accessibilityElementsHidden>
        {emoji}
      </AppText>
      <AppText variant="title" center>
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" tone="muted" center>
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} fullWidth={false} style={styles.action} />
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
  action: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
});
