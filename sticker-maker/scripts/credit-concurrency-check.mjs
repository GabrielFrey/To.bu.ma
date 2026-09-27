#!/usr/bin/env node
/**
 * Fires many concurrent charges at consume_credits and asserts that the balance never
 * goes negative and that exactly `balance` charges succeed. pgTAP runs in a single
 * transaction, so it cannot prove this — real parallel connections can.
 *
 * Usage:
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_ANON_KEY=... \
 *   node scripts/credit-concurrency-check.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const parallel = Number.parseInt(process.env.PARALLEL ?? '20', 10);

if (!url || !anonKey) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY first.');
  process.exit(2);
}

const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: signIn, error: signInError } = await supabase.auth.signInAnonymously();
if (signInError || !signIn.user) {
  console.error('Anonymous sign in failed:', signInError?.message);
  process.exit(1);
}

const userId = signIn.user.id;

const { data: profileBefore, error: profileError } = await supabase
  .from('profiles')
  .select('generation_credits')
  .eq('id', userId)
  .single();

if (profileError || !profileBefore) {
  console.error('Could not read the profile:', profileError?.message);
  process.exit(1);
}

const startingBalance = profileBefore.generation_credits;
console.log(`user ${userId} starts with ${startingBalance} generation credits`);
console.log(`firing ${parallel} concurrent charges of 1 credit each, all distinct intents`);

const results = await Promise.all(
  Array.from({ length: parallel }, (_, index) =>
    supabase
      .rpc('consume_credits', {
        p_kind: 'generation',
        p_amount: 1,
        p_request_id: `concurrency-${userId}-${index}`,
      })
      .then(({ data, error }) => ({ ok: !error, error: error?.message, data })),
  ),
);

const charged = results.filter((result) => result.ok && result.data?.[0]?.charged === true).length;
const rejected = results.filter((result) => !result.ok).length;

const { data: profileAfter } = await supabase
  .from('profiles')
  .select('generation_credits')
  .eq('id', userId)
  .single();

const { data: ledger } = await supabase
  .from('credit_ledger')
  .select('delta')
  .eq('user_id', userId)
  .eq('kind', 'generation');

const ledgerSum = (ledger ?? []).reduce((sum, row) => sum + row.delta, 0);
const finalBalance = profileAfter?.generation_credits ?? -1;

console.log(`charged: ${charged}, rejected: ${rejected}`);
console.log(`final balance: ${finalBalance}, ledger sum: ${ledgerSum}`);

const failures = [];
if (charged !== startingBalance) {
  failures.push(`expected exactly ${startingBalance} successful charges, got ${charged}`);
}
if (finalBalance !== 0) {
  failures.push(`expected the balance to land on 0, got ${finalBalance}`);
}
if (finalBalance < 0) {
  failures.push('balance went negative');
}
if (ledgerSum !== finalBalance) {
  failures.push(`ledger sum ${ledgerSum} disagrees with balance ${finalBalance}`);
}

// Retrying one of the already charged intents must not move the balance.
const replayIntent = `concurrency-${userId}-0`;
await supabase.rpc('consume_credits', {
  p_kind: 'generation',
  p_amount: 1,
  p_request_id: replayIntent,
});
const { data: profileAfterReplay } = await supabase
  .from('profiles')
  .select('generation_credits')
  .eq('id', userId)
  .single();
if ((profileAfterReplay?.generation_credits ?? -1) !== finalBalance) {
  failures.push('replaying a charged intent changed the balance');
}

if (failures.length > 0) {
  console.error('FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('OK: concurrent charges are serialized, idempotent and floored at zero');
