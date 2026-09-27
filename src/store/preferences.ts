import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';

interface PreferencesState {
  /** `null` follows the phone language. */
  language: string | null;
  theme: ThemePreference;
  onboardingCompleted: boolean;
  disclaimerAccepted: boolean;
  analyticsEnabled: boolean;
  notificationsAsked: boolean;
  hydrated: boolean;
  setLanguage: (language: string | null) => void;
  setTheme: (theme: ThemePreference) => void;
  completeOnboarding: () => void;
  acceptDisclaimer: () => void;
  setAnalyticsEnabled: (enabled: boolean) => void;
  markNotificationsAsked: () => void;
}

/**
 * Preferences only — no tokens. The Supabase session lives in the Keychain through
 * `chunkedSecureStorage`.
 */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      language: null,
      theme: 'system',
      onboardingCompleted: false,
      disclaimerAccepted: false,
      analyticsEnabled: true,
      notificationsAsked: false,
      hydrated: false,
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      completeOnboarding: () => set({ onboardingCompleted: true }),
      acceptDisclaimer: () => set({ disclaimerAccepted: true }),
      setAnalyticsEnabled: (analyticsEnabled) => set({ analyticsEnabled }),
      markNotificationsAsked: () => set({ notificationsAsked: true }),
    }),
    {
      name: 'preferences',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      version: 1,
    },
  ),
);

// The router waits for hydration before deciding between onboarding and the tabs,
// otherwise a returning user sees the onboarding flash on every cold start.
usePreferences.persist.onFinishHydration(() => {
  usePreferences.setState({ hydrated: true });
});

if (usePreferences.persist.hasHydrated()) {
  usePreferences.setState({ hydrated: true });
}
