import React from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

export interface ScreenProps {
  children: React.ReactNode;
  /** Wraps the content in a ScrollView; off for screens that own a list. */
  scroll?: boolean;
  /** Respects the bottom safe area; turn off inside a tab screen. */
  padBottom?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Screen({
  children,
  scroll = false,
  padBottom = true,
  contentStyle,
  testID,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const padding: ViewStyle = {
    paddingHorizontal: spacing.lg,
    paddingBottom: padBottom ? insets.bottom + spacing.lg : spacing.lg,
  };

  if (scroll) {
    return (
      <ScrollView
        testID={testID}
        style={[styles.flex, { backgroundColor: theme.colors.background }]}
        contentContainerStyle={[padding, contentStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {children}
      </ScrollView>
    );
  }

  return (
    <View
      testID={testID}
      style={[styles.flex, { backgroundColor: theme.colors.background }, padding, contentStyle]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
