import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { haptics } from '../lib/haptics';
import { MIN_TOUCH_SIZE, radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

import { AppText } from './AppText';

export interface CreditPillProps {
  generationCredits: number;
  exportCredits: number;
  onPress?: () => void;
  testID?: string;
}

export function CreditPill({
  generationCredits,
  exportCredits,
  onPress,
  testID,
}: CreditPillProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  const label = `${t('home.generationsLeft', { count: generationCredits })} · ${t(
    'home.exportsLeft',
    { count: exportCredits },
  )}`;

  const content = (
    <View
      style={[
        styles.pill,
        { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border },
      ]}
    >
      <AppText variant="footnote" tone={generationCredits === 0 ? 'danger' : 'default'}>
        {`✨ ${generationCredits}`}
      </AppText>
      <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
      <AppText variant="footnote" tone={exportCredits === 0 ? 'danger' : 'default'}>
        {`📤 ${exportCredits}`}
      </AppText>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.hitbox, { opacity: pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hitbox: {
    minHeight: MIN_TOUCH_SIZE,
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
});
