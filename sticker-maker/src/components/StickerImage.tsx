import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { localStickerUri } from '../lib/storage';

import { CheckerboardPreview } from './CheckerboardPreview';
import { Skeleton } from './Skeleton';

export interface StickerImageProps {
  /** Storage path inside the private `stickers` bucket. */
  path: string;
  size: number;
  /** Draws the transparency checkerboard behind the sticker. */
  checkerboard?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * The bucket is private, so a sticker is fetched with a signed URL once and then read
 * from the on-device cache. Keying the query by path means the same sticker in a grid
 * and in a detail view share one download.
 */
export function StickerImage({
  path,
  size,
  checkerboard = false,
  style,
  accessibilityLabel,
}: StickerImageProps) {
  const { data: uri, isPending } = useQuery({
    queryKey: ['sticker-file', path],
    queryFn: () => localStickerUri(path),
    staleTime: Infinity,
  });

  const image =
    isPending || !uri ? (
      <Skeleton width={size} height={size} />
    ) : (
      <Image
        source={{ uri }}
        style={{ width: size, height: size }}
        contentFit="contain"
        transition={120}
        accessibilityLabel={accessibilityLabel}
        accessible={Boolean(accessibilityLabel)}
      />
    );

  if (!checkerboard) {
    return <View style={[{ width: size, height: size }, styles.center, style]}>{image}</View>;
  }

  return (
    <CheckerboardPreview size={size} style={style}>
      {image}
    </CheckerboardPreview>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
