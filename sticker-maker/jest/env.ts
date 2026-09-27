// Runs before the module registry is set up, so `src/config/env.ts` sees a complete
// configuration instead of throwing the "copy .env.example" developer error.
process.env.EXPO_PUBLIC_ENV = 'development';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.EXPO_PUBLIC_PRIVACY_URL = 'https://example.com/privacy';
process.env.EXPO_PUBLIC_TERMS_URL = 'https://example.com/terms';
process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'support@example.com';
