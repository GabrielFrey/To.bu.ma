import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { haptics } from '../lib/haptics';
import { MIN_TOUCH_SIZE, radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

import { AppText } from './AppText';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
}

export function Chip({ label, selected = false, onPress, testID }: ChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.colors.brand : theme.colors.surface,
          borderColor: selected ? theme.colors.brand : theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <AppText variant="callout" tone={selected ? 'inverse' : 'default'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: MIN_TOUCH_SIZE - 8,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
