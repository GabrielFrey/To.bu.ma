import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { ListRow } from '../../src/components/ListRow';
import { Screen } from '../../src/components/Screen';
import { useUpdateProfile } from '../../src/features/credits/useCredits';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, deviceLanguage } from '../../src/i18n';
import { usePreferences } from '../../src/store/preferences';
import { spacing } from '../../src/theme';

/**
 * "Phone language" is a real option rather than a hidden default, and the choice is also
 * stored on the profile so push notifications arrive in the same language.
 */
export default function LanguageScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const language = usePreferences((state) => state.language);
  const setLanguage = usePreferences((state) => state.setLanguage);
  const updateProfile = useUpdateProfile();

  const choose = (value: string | null) => {
    setLanguage(value);
    updateProfile.mutate({ locale: value ?? deviceLanguage() });
    router.back();
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <ListRow
        title={t('settings.systemLanguage')}
        value={language === null ? '✓' : undefined}
        onPress={() => choose(null)}
        testID="language-system"
      />
      {SUPPORTED_LANGUAGES.map((value) => (
        <ListRow
          key={value}
          title={LANGUAGE_NAMES[value]}
          value={language === value ? '✓' : undefined}
          onPress={() => choose(value)}
          testID={`language-${value}`}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.lg },
});
