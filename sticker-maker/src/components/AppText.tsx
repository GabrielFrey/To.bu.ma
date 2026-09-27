import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { typography } from '../theme';
import { useTheme } from '../theme/useTheme';

export type TextVariant = keyof typeof typography;

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: 'default' | 'muted' | 'brand' | 'danger' | 'success' | 'inverse';
  center?: boolean;
}

export function AppText({
  variant = 'body',
  tone = 'default',
  center = false,
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();

  const color: Record<NonNullable<AppTextProps['tone']>, string> = {
    default: theme.colors.text,
    muted: theme.colors.textMuted,
    brand: theme.colors.brand,
    danger: theme.colors.danger,
    success: theme.colors.success,
    inverse: theme.colors.brandText,
  };

  const base: TextStyle = {
    ...typography[variant],
    color: color[tone],
    ...(center ? { textAlign: 'center' } : null),
  };

  return <Text {...rest} style={[base, style]} />;
}
