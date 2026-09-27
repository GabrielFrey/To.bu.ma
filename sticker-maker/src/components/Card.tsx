import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from '../lib/haptics';
import { radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

export interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function Card({
  children,
  onPress,
  selected = false,
  style,
  accessibilityLabel,
  testID,
}: CardProps) {
  const theme = useTheme();

  const surface: ViewStyle = {
    backgroundColor: theme.colors.surface,
    borderColor: selected ? theme.colors.brand : theme.colors.border,
    borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
  };

  if (!onPress) {
    return <View testID={testID} style={[styles.card, surface, style]}>{children}</View>;
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.card, surface, pressed ? styles.pressed : null, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  pressed: { opacity: 0.85 },
});
