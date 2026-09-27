import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius } from '../theme';
import { useTheme } from '../theme/useTheme';

export interface CheckerboardPreviewProps {
  size: number;
  children: React.ReactNode;
  squareSize?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Stickers are transparent PNGs, and on a flat background a white cut-out looks
 * identical to a white rectangle. The checkerboard makes the transparency visible,
 * which is the single most common "is my sticker broken?" support question.
 */
export function CheckerboardPreview({
  size,
  children,
  squareSize = 12,
  style,
}: CheckerboardPreviewProps) {
  const theme = useTheme();
  const perRow = Math.ceil(size / squareSize);

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, backgroundColor: theme.colors.checkerLight },
        style,
      ]}
    >
      <View style={styles.squares} accessibilityElementsHidden importantForAccessibility="no">
        {Array.from({ length: perRow * perRow }, (_unused, index) => {
          const row = Math.floor(index / perRow);
          const column = index % perRow;
          const dark = (row + column) % 2 === 1;
          return (
            <View
              key={index}
              style={{
                width: squareSize,
                height: squareSize,
                backgroundColor: dark ? theme.colors.checkerDark : theme.colors.checkerLight,
              }}
            />
          );
        })}
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  squares: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  content: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
