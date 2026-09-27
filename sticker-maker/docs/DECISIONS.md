# Decisions

Choices that were not obvious, and where this build knowingly deviates from the brief.

## Credits

**The ledger is the source of truth, and the balance column is a cache.** Every movement
inserts a `credit_ledger` row and updates `profiles`. The pgTAP suite asserts the two agree.
A column alone cannot be audited after a dispute; a ledger can.

**Charging is one conditional `UPDATE`.**

```sql
update public.profiles
   set generation_credits = generation_credits - p_amount
 where id = v_user and generation_credits >= p_amount
```

Postgres takes a row lock for the duration, so two concurrent charges serialise and the
second one finds the balance too low instead of driving it negative. `SELECT ... FOR UPDATE`
followed by an `UPDATE` would work too but needs two statements and is easier to get wrong.

**Idempotency is `(user_id, request_id)` unique on the ledger.** A retried request replays
the first outcome. The client derives the id from the intent — the export id is a hash of
the pack and sticker ids, so an interrupted export cannot charge twice, while a genuinely
new export gets a new id. `consume_credits` also catches `unique_violation` from a
simultaneous duplicate, refunds and reports the replay, so the two requests cannot both
succeed.

**Exports charge after the hand-off, not before.** `export-pack` builds the payload but
never touches credits; the app calls `consume_credits` once the native hand-off returned
success. Cancelling the WhatsApp sheet therefore costs nothing, which is the behaviour a
user expects and the one that avoids refund support tickets.

**Failed generations are refunded by the server.** `refund_generation` is keyed
`refund_<generation_id>`, so it is safe to call more than once, and the UI says the credit
came back. A provider outage that silently ate credits would be indistinguishable from
theft.

## Auth

**Everyone has a session from the first launch.** A guest is a real Supabase user, which is
what makes RLS, credits and Realtime work before sign in.

**A guest who signs in is linked, not re-created.** `signInWithIdToken` on an anonymous
session creates a *second* user and orphans the first one's stickers and credits.
`linkIdentity` attaches the identity to the account that already holds the content. When the
identity already belongs to another account Supabase cannot merge them, so the app says so
plainly and offers "open my existing account" or "stay a guest" rather than pretending.

**Apple uses the native sheet with a hashed nonce.** Apple signs the SHA-256 of the nonce
and Supabase verifies it against the raw value, which is what stops a replayed identity
token.

## Storage and images

**Buckets are private; reads go through short-lived signed URLs** cached in memory and
refreshed a minute early so a slow download cannot outlive its URL. Files live under
`<user_id>/` and the storage policies enforce that with
`(storage.foldername(name))[1] = auth.uid()::text`.

**Server-side normalisation uses magick-wasm, not sharp.** The brief said sharp, but Edge
Functions run on Deno, where sharp's native binding is unavailable. `_shared/image.ts`
produces the same output: a 512×512 transparent PNG, a WebP squeezed under WhatsApp's 100 KB
ceiling by a quality ladder, and a 96 px tray icon.

**The local file cache is trimmed by least recent use to 200 MB.** Every file in it is
re-downloadable and iOS may purge `cacheDirectory` anyway.

## Generation

**The server rebuilds the prompt.** The client sends an emotion id and its own text, never a
finished prompt, and the Edge Function rebuilds it from the shared `emotions.json`. A client
that could send arbitrary prompt text would be a jailbreak surface and a moderation hole.
Both sides strip the characters that let user text escape its section.

**Generation is asynchronous and the UI never depends on push.** The function answers as
soon as the row exists and does the work in `EdgeRuntime.waitUntil`. The app learns the
outcome from Realtime, from a foreground refetch, or from a poll while a job is visibly
pending. Push notifications are asked for at the first generation — the moment they
obviously pay off — and are purely a convenience.

## Export targets

**The share sheet takes one sticker at a time.** iOS `UIActivityViewController` via
`expo-sharing` shares a single file. Rather than silently exporting only the first of a
selection, the target is offered only when exactly one sticker is selected, and the UI says
why otherwise.

**Telegram's import falls back to the share sheet.** `tg://importStickers` is undocumented
and version dependent. When it refuses, the app shares the sticker instead and tells the
user what happened rather than reporting a failure.

**The iMessage extension reads from an App Group, not from the network.** Apple's sticker
pack template bakes a static asset catalogue into the extension, which cannot work for
user-generated stickers. The extension has no session and no network access, so the App
Group directory is the only way in — and it means the app is the only thing that can remove
those stickers again, which is why Settings has a row for exactly that.

## Purchases

**Credits are granted by the webhook, never by the client.** A successful
`purchasePackage` only means "wait for the balance". RevenueCat validates the receipt
server-side and the webhook calls `grant_credits`, keyed by `transaction_id` so a replayed
webhook cannot double-grant. This is what makes a forged client-side receipt worthless.

**Prices are always `product.priceString`.** Never a hardcoded number: the store knows the
currency, the tax and the regional price.

## i18n

**"Phone language" is a real, selectable option**, stored as `null`, not an invisible
default. The chosen locale is also written to the profile so push notifications arrive in
the same language the app is in.

**Locale parity is a test, not a promise.** `src/i18n/__tests__/locales.test.ts` fails if any
locale gains or loses a key relative to English, comparing plural *base* keys so that
languages with different plural rules are still checked.

## Tooling

**Database types are hand-maintained and committed** so `tsc` works without a running
database. They include the `Relationships` entries supabase-js needs, otherwise every
mutation payload collapses to `never` and embedded selects stop type-checking. Regenerate
with `supabase gen types typescript --local`.

**Jest sets the public env vars in `setupFiles`.** `src/config/env.ts` throws in development
when configuration is missing, which is the right behaviour for a developer and the wrong
one for CI, so the test environment provides values.
