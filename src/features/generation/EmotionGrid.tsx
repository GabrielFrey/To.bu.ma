import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '../../components/AppText';
import { Chip } from '../../components/Chip';
import {
  EMOTION_CATEGORIES,
  EMOTION_PRESETS,
  type EmotionCategory,
} from '../../domain/emotions';
import { haptics } from '../../lib/haptics';
import { radius, spacing } from '../../theme';
import { useTheme } from '../../theme/useTheme';

export interface EmotionGridProps {
  selectedId: string | null;
  onSelect: (emotionId: string) => void;
}

export function EmotionGrid({ selectedId, onSelect }: EmotionGridProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [category, setCategory] = useState<EmotionCategory>('reaction');

  const presets = useMemo(
    () => EMOTION_PRESETS.filter((preset) => preset.category === category),
    [category],
  );

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categories}
      >
        {EMOTION_CATEGORIES.map((value) => (
          <Chip
            key={value}
            label={t(`home.categories.${value}`)}
            selected={value === category}
            onPress={() => setCategory(value)}
            testID={`category-${value}`}
          />
        ))}
      </ScrollView>

      <View style={styles.grid}>
        {presets.map((preset) => {
          const selected = preset.id === selectedId;
          return (
            <Pressable
              key={preset.id}
              testID={`emotion-${preset.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`emotions.${preset.id}`)}
              onPress={() => {
                haptics.selection();
                onSelect(preset.id);
              }}
              style={({ pressed }) => [
                styles.tile,
                {
                  backgroundColor: selected ? theme.colors.brand : theme.colors.surface,
                  borderColor: selected ? theme.colors.brand : theme.colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <AppText style={styles.emoji} accessibilityElementsHidden>
                {preset.emoji}
              </AppText>
              <AppText
                variant="caption"
                tone={selected ? 'inverse' : 'muted'}
                center
                numberOfLines={2}
              >
                {t(`emotions.${preset.id}`)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  categories: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: {
    width: 84,
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emoji: { fontSize: 28, lineHeight: 34 },
});
