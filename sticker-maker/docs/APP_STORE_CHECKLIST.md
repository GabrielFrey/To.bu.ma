# App Store readiness checklist

Guideline numbers refer to the App Review Guidelines. The first section is what the code
already does; the second is what a human has to do on a Mac with a device.

## Done in this repository

| Requirement | Guideline | Where |
| --- | --- | --- |
| Sign in with Apple offered alongside Google | 4.8 | `app/auth/sign-in.tsx`, native sheet in `src/features/auth/authApi.ts` |
| Account deletion inside the app | 5.1.1(v) | `app/settings/delete-account.tsx`, `supabase/functions/delete-account` |
| Digital credits sold only through IAP | 3.1.1 | `app/paywall.tsx`; no external payment link or mention anywhere |
| Store-localised prices | 3.1.2 | `product.priceString` in `src/lib/purchases.ts` |
| Auto-renew disclosure next to the price | 3.1.2 | `paywall.subscriptionNote` in all six locales |
| Restore purchases | 3.1.1 | `useRestorePurchases`, button on the paywall |
| Terms and Privacy reachable before purchase | 3.1.2 | Paywall and sign-in footers, Settings rows |
| Generated-content reporting | 1.2 | `app/report.tsx`, `reports` table |
| AI disclaimer shown before first use | 1.2, 5.1.2 | Onboarding and Settings |
| Server-side moderation of image and text | 1.1 | `_shared/moderation.ts`, called by `generate-sticker` and `moderate` |
| Permission strings that say why | 5.1.1 | `app.config.ts` usage descriptions |
| iOS limited photo access respected | 5.1.1 | `src/features/photos/photoApi.ts`, banner on the create screen |
| Privacy manifest with API reasons | — | `ios.privacyManifests` in `app.config.ts` |
| No placeholder or "coming soon" copy | 2.1 | Every string is a real feature |
| Analytics opt-out | 5.1.1 | Settings toggle, `setAnalyticsEnabled` |
| Encryption declaration | — | `ITSAppUsesNonExemptEncryption: false` |
| 44 pt minimum touch targets, labelled controls | — | `MIN_TOUCH_SIZE` in the UI kit, accessibility props on every pressable |

## Before submitting — needs a Mac, Xcode and an iPhone

1. **Secrets.** `cp .env.example .env.local`, fill it in, and push the same values with
   `eas secret:push --scope project --env-file .env.local`. Nothing secret belongs in git.
2. **Apple identifiers.** Create the App ID, enable Sign in with Apple, Push Notifications
   and App Groups, and create `group.<bundle id>.stickers`. Put the App Store Connect app id
   and team id into `eas.json`.
3. **APNs.** Upload the `.p8` key to EAS credentials. Do not commit it.
4. **Supabase.** `supabase link`, `supabase db push`, `supabase functions deploy`, then set
   the function secrets: `IMAGE_PROVIDER`, the provider key, `REVENUECAT_WEBHOOK_SECRET`,
   `EXPO_ACCESS_TOKEN`. Enable anonymous sign-ins and configure the Apple and Google
   providers.
5. **RevenueCat.** Create the products in App Store Connect, mirror them in RevenueCat,
   point the webhook at `revenuecat-webhook` with the shared secret, and make sure the
   product identifiers match `CREDIT_BUNDLES` in that function.
6. **Build.** `npx expo prebuild --clean`, then `eas build --profile development --platform ios`.
   Confirm both targets appear in Xcode and that the App Group entitlement is on both.
7. **Device test the things that cannot be mocked.**
   - WhatsApp: build a pack of 3 to 30 stickers, export, confirm WhatsApp installs it, and
     confirm backing out charges nothing.
   - Telegram: export and confirm the import, or that the documented fallback happens.
   - Messages: add stickers, open the Messages drawer, confirm they are there, then remove
     them from Settings and confirm they are gone.
   - Photos: save and confirm transparency survives.
   - StoreKit sandbox: buy each product, confirm the balance arrives from the webhook, then
     restore on a second device.
   - Push: background the app during a generation and confirm the notification opens the
     right sticker.
   - Account deletion: delete, then confirm the rows and the storage folders are gone.
8. **Maestro.** `npm run e2e:ios` against the development build.
9. **App Store Connect.** Age rating (user-generated content, infrequent mild themes),
   privacy answers matching the privacy manifest, screenshots from a real device, and a
   review note explaining that stickers are AI generated from a photo the user supplies.
10. **Review account.** Provide a test account with credits, or point out that the app works
    as a guest with free credits and needs no sign in.
