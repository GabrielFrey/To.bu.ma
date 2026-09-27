import React, { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  round?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%', height = 16, round = false, style }: SkeletonProps) {
  const theme = useTheme();
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.9, { duration: 800 }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: round ? height / 2 : radius.sm,
          backgroundColor: theme.colors.surfaceElevated,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Placeholder grid used while the library or a pack loads. */
export function SkeletonGrid({ count = 6, size = 104 }: { count?: number; size?: number }) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: count }, (_unused, index) => (
        <Skeleton key={index} width={size} height={size} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
});
