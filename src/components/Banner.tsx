import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

import { AppText } from './AppText';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  tone?: BannerTone;
  title?: string;
  message: string;
  action?: React.ReactNode;
  testID?: string;
}

export function Banner({ tone = 'info', title, message, action, testID }: BannerProps) {
  const theme = useTheme();

  const accent: Record<BannerTone, string> = {
    info: theme.colors.brand,
    success: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
  };

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={[
        styles.container,
        { backgroundColor: theme.colors.surface, borderLeftColor: accent[tone] },
      ]}
    >
      <View style={styles.text}>
        {title ? <AppText variant="headline">{title}</AppText> : null}
        <AppText variant="footnote" tone="muted">
          {message}
        </AppText>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 3,
  },
  text: {
    flex: 1,
    gap: 2,
  },
});
