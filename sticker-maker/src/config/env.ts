import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Single place that reads configuration. Everything here is public by definition:
 * provider keys and the Supabase service_role key live only in Edge Functions.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    if (__DEV__) {
      throw new Error(`Missing env var ${name}. Copy .env.example to .env.local and fill it in.`);
    }
    return '';
  }
  return value;
}

function optional(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

const appGroup = (Constants.expoConfig?.extra as { appGroup?: string } | undefined)?.appGroup;

export const env = {
  environment: (process.env.EXPO_PUBLIC_ENV ?? 'development') as
    | 'development'
    | 'preview'
    | 'production',
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
  revenueCatKey: Platform.select({
    ios: optional(process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY),
    android: optional(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY),
    default: undefined,
  }),
  sentryDsn: optional(process.env.EXPO_PUBLIC_SENTRY_DSN),
  posthogKey: optional(process.env.EXPO_PUBLIC_POSTHOG_KEY),
  posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
  privacyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? 'https://example.com/privacy',
  termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? 'https://example.com/terms',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'support@example.com',
  googleIosClientId: optional(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
  googleWebClientId: optional(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
  appGroup: appGroup ?? 'group.com.emetsolutions.stickermaker.stickers',
  deepLinkScheme: 'stickers',
} as const;

export const isProduction = env.environment === 'production';
