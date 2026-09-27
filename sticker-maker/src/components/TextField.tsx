import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { radius, spacing, typography } from '../theme';
import { useTheme } from '../theme/useTheme';

import { AppText } from './AppText';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string | null;
  /** Shows a live `12/24` counter; pair it with `maxLength`. */
  showCounter?: boolean;
}

export function TextField({
  label,
  hint,
  error,
  showCounter = false,
  maxLength,
  value,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.brand
      : theme.colors.border;

  return (
    <View style={styles.wrapper}>
      {label ? (
        <View style={styles.labelRow}>
          <AppText variant="callout" tone="muted">
            {label}
          </AppText>
          {showCounter && maxLength ? (
            <AppText variant="caption" tone="muted">
              {`${value?.length ?? 0}/${maxLength}`}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <TextInput
        {...rest}
        value={value}
        maxLength={maxLength}
        placeholderTextColor={theme.colors.textMuted}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.surface,
            borderColor,
            color: theme.colors.text,
          },
          rest.multiline ? styles.multiline : null,
        ]}
      />

      {error ? (
        <AppText variant="footnote" tone="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="footnote" tone="muted">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  input: {
    ...typography.body,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
});
