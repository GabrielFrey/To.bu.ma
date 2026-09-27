# Changelog

All notable changes to Sticker Studio are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### M1–M6 — Screens

- Onboarding with the AI disclaimer, a guest-first entry gate, and Sign in with Apple plus
  Google, including the account-conflict screen a guest sees when the identity already
  belongs to someone else.
- Create flow: photo picker that works with iOS limited library access, on-device
  crop/rotate with pinch and pan, 32 localised emotion presets, AI idea suggestions,
  caption and refinement fields, and a notification prompt raised at the first generation
  rather than on launch.
- Result screen with a transparency checkerboard, feedback, prompt reuse and a report
  action; library with keyset pagination and multi-select; packs with drag reordering, tray
  icon selection and live WhatsApp readiness.
- Export sheet for Photos, WhatsApp, Telegram, the share sheet and Messages, showing
  unavailable targets as disabled with the reason.
- Paywall with store-localised prices, restore purchases and the mandatory renewal
  disclosure; settings with language, appearance, analytics opt-out, support and in-app
  account deletion behind a typed confirmation.
- Localised emotion names and error strings for all six languages.

### M0 — Project skeleton

- Expo SDK 54 / React Native 0.81 project with TypeScript in strict mode,
  `noUncheckedIndexedAccess`, the New Architecture enabled and expo-router typed routes.
- ESLint (flat config, `--max-warnings=0`), Prettier, Jest with `jest-expo`.
- Pure domain layer with unit tests: credit arithmetic, WhatsApp/Telegram limits, prompt
  building and sanitisation, pack validation and reordering, idempotency keys.
- `sticker-export` native iOS module: WhatsApp and Telegram pasteboard hand-off plus App
  Group file sharing for the Messages extension.

### Backend

- Supabase schema with row level security on every table, private storage buckets scoped
  to `<user_id>/`, and a credit ledger that is the single source of truth for balances.
- Race-safe credit RPCs: `consume_credits` charges with one conditional `UPDATE` and is
  idempotent per `(user_id, request_id)`; `grant_credits`, `refund_generation`,
  `claim_sign_in_bonus` and `claim_first_export_bonus` are `SECURITY DEFINER` and the only
  writers of a balance.
- pgTAP suite for the credit rules and a Node script that fires genuinely concurrent
  charges to prove no balance can go negative.
- Edge Functions: `generate-sticker` (provider adapter behind `IMAGE_PROVIDER`, background
  work via `EdgeRuntime.waitUntil`, refund on failure), `export-pack`, `suggest-idea`,
  `moderate`, `revenuecat-webhook`, `delete-account`, `support-message`.

### Client foundation

- Keychain-backed Supabase session storage with chunking for oversized sessions; tokens
  never touch `AsyncStorage`.
- i18n for English, Russian, Spanish, French, German and Portuguese, plus a "phone
  language" option, with tests that fail on any key drift between locales.
- Theming with light/dark/system, a UI kit sized for the 44 pt iOS touch target, and a
  transparency checkerboard preview.
- Data layer: TanStack Query cache keys, Realtime subscriptions for credits and
  generations, keyset pagination for the library, optimistic pack reordering, and an
  export service that only charges credits after a successful hand-off.
