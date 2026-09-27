# Sticker Studio

An iOS app that turns a photo into a set of AI stickers and hands them to WhatsApp,
Telegram, Messages or the photo library. Expo SDK 54, React Native 0.81, TypeScript in
strict mode, New Architecture, with Supabase (Postgres, Auth, Storage, Realtime, Edge
Functions) as the backend.

The client never talks to an image model and never holds a provider key. Every generation
goes through an Edge Function, and every credit balance is written only by a
`SECURITY DEFINER` Postgres function.

## Requirements

| Tool | Version | Needed for |
| --- | --- | --- |
| Node | 20 or 22 LTS | the app |
| npm | 10+ | the app |
| Watchman | any | faster Metro on macOS |
| Xcode | 16.1+ | iOS build, simulator, the iMessage target |
| CocoaPods | 1.15+ | `expo prebuild` |
| Supabase CLI | 2.x | migrations, local Postgres, Edge Functions |
| Deno | 2.x | type-checking the Edge Functions |
| EAS CLI | latest | device and store builds |
| Maestro | latest | the smoke flow |

A physical iPhone is required for the parts that cannot be simulated: the WhatsApp and
Telegram hand-off, StoreKit purchases, and push notifications.

## Quick start

```bash
npm install
cp .env.example .env.local                                  # fill in the Supabase values
cp supabase/functions/.env.example supabase/functions/.env.local
npm run verify                                              # tsc, eslint, jest
```

`npm run verify` needs nothing but Node — it is the gate to run before every commit.

To actually launch the app you need a development build, because the project has native
code (`modules/sticker-export` and the iMessage target) that Expo Go cannot load:

```bash
npx expo prebuild --clean
npm run ios          # or open the generated ios/*.xcworkspace in Xcode
```

After the first `expo run:ios`, `npm start` is enough for JS-only changes.

## Environment variables

Two separate files, and the split matters.

`.env.local` is bundled into the app. Only `EXPO_PUBLIC_*` values belong there: the
Supabase URL and anon key, the RevenueCat public SDK keys, the Sentry DSN, the PostHog
project key, and the legal/support URLs shown in Settings. See `.env.example`.

`supabase/functions/.env.local` is server-side only and must never be referenced from the
app: `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` / `OPENAI_API_KEY`,
`REVENUECAT_WEBHOOK_SECRET`, and the credit economics. See
`supabase/functions/.env.example`.

Neither `.env.local` is committed. For builds, the public values go into
`eas secret:create` (or `eas.json` env for non-secret ones) and the server values into
`supabase secrets set`.

## Backend setup

```bash
supabase start                      # local Postgres + Storage + Edge runtime
supabase db reset                   # applies supabase/migrations in order
supabase test db                    # pgTAP suite for the credit rules
node scripts/credit-concurrency-check.mjs   # proves a balance cannot go negative
```

The concurrency script exists because pgTAP runs inside a single transaction and therefore
cannot observe a race. It fires overlapping `consume_credits` calls against a real
connection pool and asserts the balance never drops below zero and never double-charges a
repeated `request_id`.

Against a hosted project:

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy generate-sticker export-pack suggest-idea moderate \
  revenuecat-webhook delete-account support-message
supabase secrets set --env-file supabase/functions/.env.local
```

Serving functions locally:

```bash
npm run functions:serve
```

### Choosing an image provider

`IMAGE_PROVIDER` selects the adapter at runtime: `gemini` (Gemini 2.5 Flash Image) or
`openai` (`gpt-image-1`). Both implement the same interface in
`supabase/functions/_shared/providers/`, so swapping one is a config change, not a code
change. Set the matching API key and nothing else.

## Third-party services

1. **Supabase** — create the project, run the migrations, and copy the URL and anon key
   into `.env.local`. Enable anonymous sign-ins, Apple and Google in Authentication →
   Providers.
2. **Apple Developer** — an App ID with the App Groups, Sign in with Apple and Push
   Notifications capabilities; an APNs `.p8` key uploaded to EAS credentials (never to the
   repo); the App Group `group.<bundle id>.stickers` shared by the app and the extension.
3. **RevenueCat** — one entitlement, the credit-pack and subscription products from App
   Store Connect, the public SDK key in `.env.local`, and a webhook pointing at the
   deployed `revenuecat-webhook` function with the shared secret set on both sides.
   Purchases grant credits from the webhook; the client never grants anything.
4. **Sentry and PostHog** — optional. Leave the keys empty and both are inert. Analytics
   also respect the in-app opt-out in Settings.

## Build and release

```bash
eas build --profile development --platform ios   # device build with the dev client
eas build --profile preview --platform ios       # internal distribution
eas build --profile production --platform ios
eas submit --platform ios
```

`eas.json` defines the three profiles. The production profile expects the public env values
as EAS secrets.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Metro for the dev client |
| `npm run ios` | native build + launch on a simulator or device |
| `npm run prebuild` | regenerates `ios/` from `app.config.ts` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, `--max-warnings=0` |
| `npm test` | Jest |
| `npm run verify` | typecheck + lint + tests, the pre-commit gate |
| `npm run e2e:ios` | Maestro smoke flow against a running simulator |
| `npm run db:reset` | reapply local migrations |
| `npm run functions:serve` | Edge Functions locally |

Deno type-check for the functions:

```bash
cd supabase/functions && deno check */index.ts
```

CI (`.github/workflows/ci.yml`) runs the app gate, the Deno check and the database tests on
every push.

## Project layout

```
app/                      expo-router routes (tabs, modals, typed routes)
src/components/           UI kit, 44 pt touch targets, light/dark aware
src/domain/               pure logic, no React and no network, unit tested
src/features/             one folder per feature: api + hooks
  auth/ credits/ generation/ stickers/ packs/ export/ purchases/
  photos/ moderation/ support/ account/
src/lib/                  supabase client, secure storage, query keys, errors, push, telemetry
src/i18n/                 i18next setup and six locale files
src/store/                zustand stores (preferences, create-flow draft)
src/theme/                tokens and the theme hook
modules/sticker-export/   Swift module: pasteboard hand-off + App Group writes
targets/stickers/         iMessage sticker extension (@bacons/apple-targets)
supabase/migrations/      schema, RLS, credit RPCs
supabase/functions/       Edge Functions and the provider adapters
scripts/                  credit concurrency check
.maestro/                 smoke flow
docs/                     PLAN, DECISIONS, APP_STORE_CHECKLIST
```

## How a sticker gets made

1. The app uploads the photo to a private bucket scoped to `<user_id>/` and calls
   `generate-sticker` with a client-generated `requestId`.
2. The function validates the request, checks the rate limit, inserts a `generations` row,
   and returns immediately. The model call and the 512×512 WebP normalisation happen in
   `EdgeRuntime.waitUntil`.
3. The app watches its own `generations` row over Realtime, refetches when it returns to
   the foreground, and optionally receives a push. A failure refunds the credit
   server-side.
4. Exporting charges credits **after** the hand-off succeeds, keyed by the sticker set so a
   retry of the charge itself replays the first result instead of charging twice.

## Testing

`npm test` covers the domain layer, the credit arithmetic, locale key parity across all six
languages, the export charging rules and the UI kit primitives.

`docs/PLAN.md` lists what could not be executed in a Linux container, and
`docs/APP_STORE_CHECKLIST.md` is the ordered list to work through on a Mac with a device
before submitting. `docs/DECISIONS.md` records the choices worth arguing about and why.
