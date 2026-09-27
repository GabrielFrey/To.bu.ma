-- Run with: supabase test db
-- Covers the rules the money depends on: idempotent charges, hard floor at zero,
-- ledger/balance agreement and one-shot bonuses.

begin;
create extension if not exists pgtap;

select plan(14);

-- A signed up user gets a profile and the guest grant from handle_new_user().
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'tester@example.com',
  '{"provider": "email"}'::jsonb,
  now(),
  now()
);

select is(
  (select generation_credits from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  3,
  'new profile receives the guest generation grant'
);
select is(
  (select export_credits from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  1,
  'new profile receives the guest export grant'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);

select is(
  (select charged from public.consume_credits('generation', 1, 'req-a')),
  true,
  'first charge goes through'
);
select is(
  (select generation_credits from public.consume_credits('generation', 1, 'req-a')),
  2,
  'replaying the same request id reports the same balance'
);
select is(
  (select charged from public.consume_credits('generation', 1, 'req-a')),
  false,
  'replaying the same request id does not charge again'
);
select is(
  (select generation_credits from public.profiles where id = auth.uid()),
  2,
  'balance only moved once for the replayed intent'
);

select throws_ok(
  $$select * from public.consume_credits('generation', 5, 'req-too-much')$$,
  'insufficient_credits',
  'a charge larger than the balance is rejected instead of going negative'
);
select is(
  (select generation_credits from public.profiles where id = auth.uid()),
  2,
  'a rejected charge leaves the balance untouched'
);

select throws_ok(
  $$select * from public.consume_credits('generation', 0, 'req-zero')$$,
  'invalid_amount',
  'zero amount charges are rejected'
);

-- The ledger is the source of truth: its sum must equal the materialized balance.
select is(
  (
    select coalesce(sum(delta), 0)::int
    from public.credit_ledger
    where user_id = auth.uid() and kind = 'generation'
  ),
  (select generation_credits from public.profiles where id = auth.uid()),
  'generation ledger sum equals the materialized balance'
);

select is(
  (select charged from public.claim_sign_in_bonus()),
  true,
  'sign in bonus is granted once'
);
select is(
  (select charged from public.claim_sign_in_bonus()),
  false,
  'sign in bonus cannot be claimed twice'
);
select is(
  (select generation_credits from public.profiles where id = auth.uid()),
  7,
  'sign in bonus adds the configured generation credits'
);

select is(
  (select charged from public.claim_first_export_bonus()),
  true,
  'first export bonus is granted once'
);
select is(
  (select charged from public.claim_first_export_bonus()),
  false,
  'first export bonus cannot be claimed twice'
);

select * from finish();
rollback;
