# Plan

The build was split into milestones, each one a single commit that keeps `tsc`, ESLint and
Jest green. This file records what each milestone contains and what is deliberately left
for a machine with Xcode and a physical iPhone.

## M0 — Skeleton

- Expo SDK 54 (`expo@54.0.37`), React Native 0.81.5, React 19.1, New Architecture on.
- TypeScript `strict` plus `noUncheckedIndexedAccess`, `noImplicitOverride` and
  `noFallthroughCasesInSwitch`.
- expo-router with typed routes, ESLint flat config at `--max-warnings=0`, Prettier, Jest
  with `jest-expo`.
- Pure domain layer (`src/domain`) with no React and no network: credit arithmetic,
  WhatsApp/Telegram limits, prompt building and sanitisation, pack validation, reordering,
  idempotency keys. Unit tested.
- `modules/sticker-export`: the Swift module for the WhatsApp/Telegram pasteboard hand-off
  and App Group file sharing.

## Backend — Supabase

Written before the client so the app never had to guess at a contract.

- `20260101000000_init.sql`: enums, single-row `credit_settings`, `profiles`,
  `credit_ledger`, `generations`, `stickers`, `packs`, `pack_stickers`, `purchases`,
  `feedback`, `reports`, `support_messages`, `rate_limits`, RLS on every table, private
  storage buckets scoped to `<user_id>/`, Realtime on `generations`.
- `20260101000100_credits.sql`: `consume_credits`, `grant_credits`, `refund_generation`,
  `claim_sign_in_bonus`, `claim_first_export_bonus`. All `SECURITY DEFINER`; the client has
  no write path to a balance.
- `20260101000200_packs_and_limits.sql`: `reorder_pack_stickers`, `check_rate_limit`,
  `delete_own_account`.
- Tests: `supabase/tests/database/credits.test.sql` (pgTAP) and
  `scripts/credit-concurrency-check.mjs`, which fires genuinely concurrent charges because
  pgTAP runs inside one transaction and therefore cannot prove a race is handled.
- Edge Functions: `generate-sticker`, `export-pack`, `suggest-idea`, `moderate`,
  `revenuecat-webhook`, `delete-account`, `support-message`.

## M1 — Auth, profile, credits

Anonymous sign in on first launch so credits and RLS work before the user commits to
anything. Sign in with Apple through the native sheet; Google through the Supabase OAuth
flow in an auth session. A guest who signs in is *linked* (`linkIdentity`), and the
conflict case has its own screen.

## M2 — Create and generate

Photo picker that handles iOS limited library access, on-device crop and rotate, 32
localised emotion presets, AI idea suggestions, caption and refinement fields. Generation
is asynchronous: the function answers immediately and the app watches its own row over
Realtime, with a foreground refetch as the backstop and push as an optional nudge.

## M3 — Library and packs

Keyset-paginated grid with multi-select, packs with drag reordering, tray icon selection
and live WhatsApp readiness.

## M4 — Export

Photos, WhatsApp, Telegram, the share sheet and Messages. Credits are charged only after
the hand-off succeeded.

## M5 — Purchases

RevenueCat with StoreKit 2. Prices come from the store, credits come from the webhook.

## M6 — Settings, i18n, moderation, account

Six languages plus "phone language", light/dark/system, analytics opt-out, support form,
report flow, AI disclaimer, and in-app account deletion behind a typed confirmation.

## M7 — iMessage extension

`targets/stickers` builds an iMessage sticker extension whose
`MSStickerBrowserViewController` subclass reads PNG files out of the shared App Group
container, so the stickers it offers are the ones the user actually made.

## Verified here

`npx tsc --noEmit`, `npm run lint` (zero warnings), `npm test`, and `deno check */index.ts`
for the Edge Functions.

## Not verified here — needs macOS and a device

This repository was built in a Linux container with no Xcode, no iOS simulator and no
iPhone, so the following are written but unexecuted:

1. `npx expo prebuild` and the Xcode build of both targets.
2. The WhatsApp and Telegram hand-off: both read a pasteboard item whose format is defined
   by their sample apps, and the only way to know the current format still works is to run
   it against the installed app.
3. StoreKit purchases in the sandbox, and the RevenueCat webhook granting credits.
4. APNs delivery and the notification deep link.
5. The iMessage extension appearing in the Messages drawer.
6. The Maestro smoke flow, which needs a simulator.

See `docs/APP_STORE_CHECKLIST.md` for the order to work through these.
