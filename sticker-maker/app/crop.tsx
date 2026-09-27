import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { AppText } from '../src/components/AppText';
import { Button } from '../src/components/Button';
import { ErrorState } from '../src/components/ErrorState';
import { Screen } from '../src/components/Screen';
import { clampCrop, transformPhoto } from '../src/features/photos/photoApi';
import { useDraft } from '../src/store/draft';
import { spacing } from '../src/theme';
import { useTheme } from '../src/theme/useTheme';

const MAX_ZOOM = 4;

/**
 * Pan and pinch decide which square of the photo becomes the sticker. Rotation is applied
 * eagerly to a new file instead of being carried as an angle, which keeps the crop maths
 * in one coordinate system and means the preview is exactly what gets uploaded.
 */
export default function CropScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const photo = useDraft((state) => state.photo);
  const setCroppedPhoto = useDraft((state) => state.setCroppedPhoto);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const viewport = Math.min(Dimensions.get('window').width - spacing.lg * 2, 360);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);

  const imageWidth = photo?.width ?? 1;
  const imageHeight = photo?.height ?? 1;
  // Cover the square viewport: the shorter edge of the photo fills it exactly.
  const baseScale = viewport / Math.min(imageWidth, imageHeight);

  const gesture = useMemo(() => {
    const clamp = (value: number, limit: number) => {
      'worklet';
      return Math.min(Math.max(value, -limit), limit);
    };

    const limits = (currentScale: number) => {
      'worklet';
      const displayedWidth = imageWidth * baseScale * currentScale;
      const displayedHeight = imageHeight * baseScale * currentScale;
      return {
        x: Math.max(0, (displayedWidth - viewport) / 2),
        y: Math.max(0, (displayedHeight - viewport) / 2),
      };
    };

    const pan = Gesture.Pan()
      .onStart(() => {
        startX.value = translateX.value;
        startY.value = translateY.value;
      })
      .onUpdate((event) => {
        const bounds = limits(scale.value);
        translateX.value = clamp(startX.value + event.translationX, bounds.x);
        translateY.value = clamp(startY.value + event.translationY, bounds.y);
      });

    const pinch = Gesture.Pinch()
      .onStart(() => {
        startScale.value = scale.value;
      })
      .onUpdate((event) => {
        scale.value = Math.min(Math.max(startScale.value * event.scale, 1), MAX_ZOOM);
        const bounds = limits(scale.value);
        translateX.value = clamp(translateX.value, bounds.x);
        translateY.value = clamp(translateY.value, bounds.y);
      });

    return Gesture.Simultaneous(pan, pinch);
  }, [
    baseScale,
    imageHeight,
    imageWidth,
    viewport,
    scale,
    startScale,
    startX,
    startY,
    translateX,
    translateY,
  ]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const resetGestures = () => {
    translateX.value = 0;
    translateY.value = 0;
    scale.value = 1;
  };

  const rotate = async () => {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      const rotated = await transformPhoto({ uri: photo.uri, rotation: 90 });
      setCroppedPhoto(rotated);
      resetGestures();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      const effectiveScale = baseScale * scale.value;
      const cropSize = viewport / effectiveScale;
      const centerX = imageWidth / 2 - translateX.value / effectiveScale;
      const centerY = imageHeight / 2 - translateY.value / effectiveScale;

      const crop = clampCrop(
        {
          originX: centerX - cropSize / 2,
          originY: centerY - cropSize / 2,
          width: cropSize,
          height: cropSize,
        },
        imageWidth,
        imageHeight,
      );

      const cropped = await transformPhoto({ uri: photo.uri, crop });
      setCroppedPhoto(cropped);
      router.back();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  if (!photo) {
    return (
      <Screen>
        <AppText variant="body" tone="muted" center>
          {t('home.photoRequired')}
        </AppText>
        <Button label={t('common.close')} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <View
        style={[
          styles.viewport,
          { width: viewport, height: viewport, backgroundColor: theme.colors.surface },
        ]}
      >
        <GestureDetector gesture={gesture}>
          <Animated.View style={animatedStyle}>
            <Image
              source={{ uri: photo.uri }}
              style={{
                width: imageWidth * baseScale,
                height: imageHeight * baseScale,
              }}
              contentFit="fill"
              accessibilityLabel={t('crop.title')}
            />
          </Animated.View>
        </GestureDetector>
      </View>

      <AppText variant="footnote" tone="muted" center>
        {t('crop.hint')}
      </AppText>

      {error ? <ErrorState error={error} compact /> : null}

      <View style={styles.actions}>
        <Button
          label={t('crop.rotate')}
          variant="secondary"
          onPress={() => void rotate()}
          disabled={busy}
        />
        <Button
          label={t('crop.reset')}
          variant="ghost"
          onPress={resetGestures}
          disabled={busy}
        />
      </View>

      <Button
        label={t('crop.confirm')}
        loading={busy}
        onPress={() => void confirm()}
        testID="crop-confirm"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.lg },
  viewport: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: spacing.md,
    overflow: 'hidden',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
});
