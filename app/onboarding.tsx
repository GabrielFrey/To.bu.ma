import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '../src/components/AppText';
import { Button } from '../src/components/Button';
import { track } from '../src/lib/observability';
import { usePreferences } from '../src/store/preferences';
import { radius, spacing } from '../src/theme';
import { useTheme } from '../src/theme/useTheme';

const SLIDES = [
  { emoji: '🖼️', titleKey: 'onboarding.slide1Title', bodyKey: 'onboarding.slide1Body' },
  { emoji: '🎭', titleKey: 'onboarding.slide2Title', bodyKey: 'onboarding.slide2Body' },
  { emoji: '🚀', titleKey: 'onboarding.slide3Title', bodyKey: 'onboarding.slide3Body' },
] as const;

export default function Onboarding() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const completeOnboarding = usePreferences((state) => state.completeOnboarding);
  const acceptDisclaimer = usePreferences((state) => state.acceptDisclaimer);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const width = Dimensions.get('window').width;

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };

  const isLast = index === SLIDES.length - 1;

  const advance = () => {
    if (!isLast) {
      scrollRef.current?.scrollTo({ x: width * (index + 1), animated: true });
      return;
    }
    // Accepting the AI disclaimer is part of getting started, so it is never a surprise
    // modal in the middle of the create flow later.
    acceptDisclaimer();
    completeOnboarding();
    track('onboarding_completed');
    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        {SLIDES.map((slide) => (
          <View key={slide.titleKey} style={[styles.slide, { width, paddingTop: insets.top }]}>
            <AppText style={styles.emoji} accessibilityElementsHidden>
              {slide.emoji}
            </AppText>
            <AppText variant="largeTitle" center>
              {t(slide.titleKey)}
            </AppText>
            <AppText variant="body" tone="muted" center>
              {t(slide.bodyKey)}
            </AppText>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots} accessibilityElementsHidden>
        {SLIDES.map((slide, slideIndex) => (
          <View
            key={slide.titleKey}
            style={[
              styles.dot,
              {
                backgroundColor:
                  slideIndex === index ? theme.colors.brand : theme.colors.border,
                width: slideIndex === index ? 20 : 8,
              },
            ]}
          />
        ))}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <AppText variant="caption" tone="muted" center>
          {t('moderation.disclaimerBody')}
        </AppText>
        <Button label={isLast ? t('onboarding.start') : t('common.continue')} onPress={advance} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pager: { flex: 1 },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  emoji: { fontSize: 88, lineHeight: 104 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  dot: { height: 8, borderRadius: radius.pill },
  footer: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
});
