import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { haptics } from '../lib/haptics';
import { MIN_TOUCH_SIZE, radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

import { AppText } from './AppText';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Rendered before the label, e.g. an emoji or an icon. */
  leading?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  leading,
  fullWidth = true,
  style,
  testID,
  accessibilityHint,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;

  const background: Record<ButtonVariant, string> = {
    primary: theme.colors.brand,
    secondary: theme.colors.surfaceElevated,
    ghost: 'transparent',
    destructive: theme.colors.danger,
  };

  const textTone = variant === 'primary' || variant === 'destructive' ? 'inverse' : 'default';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      disabled={inactive}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background[variant],
          borderColor: variant === 'secondary' || variant === 'ghost' ? theme.colors.border : 'transparent',
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={textTone === 'inverse' ? theme.colors.brandText : theme.colors.text}
        />
      ) : (
        <View style={styles.content}>
          {leading ? <View style={styles.leading}>{leading}</View> : null}
          <AppText variant="headline" tone={textTone} numberOfLines={1}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_SIZE + 6,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  leading: {
    justifyContent: 'center',
  },
});
