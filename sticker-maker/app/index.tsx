import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '../src/features/auth/AuthProvider';
import { usePreferences } from '../src/store/preferences';
import { useTheme } from '../src/theme/useTheme';

/**
 * Entry gate. The splash screen stays up until the stored session has been read, so this
 * only renders in the rare case where auth is still settling after the splash is gone.
 */
export default function Index() {
  const theme = useTheme();
  const { initializing } = useAuth();
  const onboardingCompleted = usePreferences((state) => state.onboardingCompleted);

  if (initializing) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.brand} size="large" />
      </View>
    );
  }

  return <Redirect href={onboardingCompleted ? '/(tabs)' : '/onboarding'} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
