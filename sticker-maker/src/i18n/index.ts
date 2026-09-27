import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';

export const SUPPORTED_LANGUAGES = ['en', 'ru', 'es', 'fr', 'de', 'pt'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  ru: 'Русский',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
};

const resources = {
  en: { translation: en },
  ru: { translation: ru },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  pt: { translation: pt },
} as const;

export function deviceLanguage(): SupportedLanguage {
  for (const locale of getLocales()) {
    const code = locale.languageCode?.toLowerCase();
    if (code && (SUPPORTED_LANGUAGES as readonly string[]).includes(code)) {
      return code as SupportedLanguage;
    }
  }
  return 'en';
}

/** `null` means "follow the phone", which is a real, selectable option in Settings. */
export function resolveLanguage(preference: string | null): SupportedLanguage {
  if (preference && (SUPPORTED_LANGUAGES as readonly string[]).includes(preference)) {
    return preference as SupportedLanguage;
  }
  return deviceLanguage();
}

let initialized = false;

export function initI18n(preference: string | null = null): typeof i18n {
  if (initialized) {
    void i18n.changeLanguage(resolveLanguage(preference));
    return i18n;
  }

  void i18n.use(initReactI18next).init({
    resources,
    lng: resolveLanguage(preference),
    fallbackLng: 'en',
    // React Native has no XSS surface and escaping mangles user captions.
    interpolation: { escapeValue: false },
    returnNull: false,
    compatibilityJSON: 'v4',
  });

  initialized = true;
  return i18n;
}

export { i18n };
