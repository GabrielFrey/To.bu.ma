import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { haptics } from '../lib/haptics';
import { MIN_TOUCH_SIZE, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

import { AppText } from './AppText';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  /** Right-hand side control, e.g. a Switch. */
  accessory?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function ListRow({
  title,
  subtitle,
  value,
  onPress,
  accessory,
  destructive = false,
  disabled = false,
  testID,
}: ListRowProps) {
  const theme = useTheme();

  const body = (
    <View style={styles.row}>
      <View style={styles.labels}>
        <AppText variant="body" tone={destructive ? 'danger' : 'default'}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="footnote" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>

      {value ? (
        <AppText variant="callout" tone="muted">
          {value}
        </AppText>
      ) : null}
      {accessory}
      {onPress && !accessory ? (
        <AppText variant="body" tone="muted">
          ›
        </AppText>
      ) : null}
    </View>
  );

  const border = { borderBottomColor: theme.colors.border };

  if (!onPress) {
    return (
      <View testID={testID} style={[styles.container, border]}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.container,
        border,
        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: MIN_TOUCH_SIZE + 8,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  labels: {
    flex: 1,
    gap: 2,
  },
});
