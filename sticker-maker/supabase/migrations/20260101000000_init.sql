-- Core schema for the sticker app: profiles, credits, generations, stickers, packs.
-- Every table is RLS protected and scoped to auth.uid(); Edge Functions use the
-- service_role key and are the only writers for generation results and purchases.

create extension if not exists "pgcrypto";

create type public.generation_status as enum ('queued', 'running', 'done', 'failed');
create type public.ledger_reason as enum ('grant', 'bonus', 'purchase', 'consume', 'refund');
create type public.credit_kind as enum ('generation', 'export');

-- Single-row configuration so SQL triggers and Edge Functions agree on the economics.
create table public.credit_settings (
  id boolean primary key default true,
  guest_generation_credits int not null default 3,
  guest_export_credits int not null default 1,
  sign_in_bonus_generation_credits int not null default 5,
  sign_in_bonus_export_credits int not null default 3,
  first_export_bonus_export_credits int not null default 2,
  constraint credit_settings_single_row check (id)
);
insert into public.credit_settings (id) values (true);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  locale text,
  is_anonymous boolean not null default true,
  generation_credits int not null default 0 check (generation_credits >= 0),
  export_credits int not null default 0 check (export_credits >= 0),
  first_export_bonus_granted boolean not null default false,
  sign_in_bonus_granted boolean not null default false,
  analytics_opt_out boolean not null default false,
  push_token text,
  created_at timestamptz not null default now()
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.credit_kind not null,
  reason public.ledger_reason not null,
  delta int not null,
  ref_type text,
  ref_id uuid,
  -- Idempotency key: one charge per user intent, forever.
  request_id text not null,
  created_at timestamptz not null default now(),
  constraint credit_ledger_request_unique unique (user_id, request_id)
);
create index credit_ledger_user_created_idx on public.credit_ledger (user_id, created_at desc);

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.generation_status not null default 'queued',
  source_path text not null,
  emotion text,
  sticker_text text,
  additional_instructions text,
  prompt text not null,
  provider text,
  model text,
  result_path text,
  error_code text,
  request_id text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint generations_request_unique unique (user_id, request_id),
  constraint generations_text_length check (char_length(coalesce(sticker_text, '')) <= 24),
  constraint generations_instructions_length check (
    char_length(coalesce(additional_instructions, '')) <= 255
  )
);
create index generations_user_created_idx on public.generations (user_id, created_at desc);
create index generations_pending_idx on public.generations (user_id, status)
  where status in ('queued', 'running');

create table public.stickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  generation_id uuid references public.generations (id) on delete set null,
  png_path text not null,
  webp_path text,
  emojis text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint stickers_emojis_limit check (array_length(emojis, 1) is null or array_length(emojis, 1) <= 3)
);
create index stickers_user_created_idx on public.stickers (user_id, created_at desc);

create table public.packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 32),
  publisher text not null default 'Sticker Studio',
  tray_sticker_id uuid references public.stickers (id) on delete set null,
  created_at timestamptz not null default now()
);
create index packs_user_created_idx on public.packs (user_id, created_at desc);

create table public.pack_stickers (
  pack_id uuid not null references public.packs (id) on delete cascade,
  sticker_id uuid not null references public.stickers (id) on delete cascade,
  position int not null check (position >= 0),
  created_at timestamptz not null default now(),
  primary key (pack_id, sticker_id)
);
create unique index pack_stickers_position_idx on public.pack_stickers (pack_id, position);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  store text not null,
  product_id text not null,
  transaction_id text not null unique,
  generation_credits_granted int not null default 0,
  export_credits_granted int not null default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  sticker_id uuid not null references public.stickers (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  constraint feedback_one_per_sticker unique (user_id, sticker_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  sticker_id uuid references public.stickers (id) on delete set null,
  reason text not null,
  details text,
  created_at timestamptz not null default now()
);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  user_id uuid not null references public.profiles (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (user_id, bucket, window_start)
);

create view public.pack_sticker_counts as
  select pack_id, count(*)::int as sticker_count
  from public.pack_stickers
  group by pack_id;

-- Every new auth user (including anonymous ones) gets a profile and free credits.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.credit_settings;
  v_is_anonymous boolean;
begin
  select * into v_settings from public.credit_settings where id;
  v_is_anonymous := coalesce((new.raw_app_meta_data ->> 'provider') = 'anonymous', false)
    or new.email is null;

  insert into public.profiles (id, is_anonymous, generation_credits, export_credits)
  values (
    new.id,
    v_is_anonymous,
    v_settings.guest_generation_credits,
    v_settings.guest_export_credits
  )
  on conflict (id) do nothing;

  insert into public.credit_ledger (user_id, kind, reason, delta, request_id)
  values
    (new.id, 'generation', 'grant', v_settings.guest_generation_credits, 'signup_generation_' || new.id),
    (new.id, 'export', 'grant', v_settings.guest_export_credits, 'signup_export_' || new.id)
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS ----------------------------------------------------------------------

alter table public.credit_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.generations enable row level security;
alter table public.stickers enable row level security;
alter table public.packs enable row level security;
alter table public.pack_stickers enable row level security;
alter table public.purchases enable row level security;
alter table public.feedback enable row level security;
alter table public.reports enable row level security;
alter table public.support_messages enable row level security;
alter table public.rate_limits enable row level security;

-- credit_settings is readable by everyone signed in (the paywall shows the numbers)
create policy credit_settings_read on public.credit_settings
  for select to authenticated using (true);

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
-- Credits are never writable from the client: only the SECURITY DEFINER RPCs touch them.
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid())
  with check (id = auth.uid());

create policy ledger_select_own on public.credit_ledger
  for select to authenticated using (user_id = auth.uid());

create policy generations_select_own on public.generations
  for select to authenticated using (user_id = auth.uid());

create policy stickers_select_own on public.stickers
  for select to authenticated using (user_id = auth.uid());
create policy stickers_delete_own on public.stickers
  for delete to authenticated using (user_id = auth.uid());

create policy packs_all_own on public.packs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy pack_stickers_all_own on public.pack_stickers
  for all to authenticated
  using (
    exists (select 1 from public.packs p where p.id = pack_id and p.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.packs p where p.id = pack_id and p.user_id = auth.uid())
    and exists (select 1 from public.stickers s where s.id = sticker_id and s.user_id = auth.uid())
  );

create policy purchases_select_own on public.purchases
  for select to authenticated using (user_id = auth.uid());

create policy feedback_all_own on public.feedback
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy reports_insert_own on public.reports
  for insert to authenticated with check (user_id = auth.uid());

create policy support_insert_own on public.support_messages
  for insert to authenticated with check (user_id = auth.uid());
create policy support_select_own on public.support_messages
  for select to authenticated using (user_id = auth.uid());

-- rate_limits is maintained by Edge Functions only; no client policy on purpose.

-- The client watches its own generation rows to learn when a sticker is ready.
alter publication supabase_realtime add table public.generations;

-- Storage ------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('sources', 'sources', false, 15728640, array['image/jpeg', 'image/png', 'image/heic', 'image/webp']),
  ('stickers', 'stickers', false, 5242880, array['image/png', 'image/webp'])
on conflict (id) do nothing;

-- Files live under <user_id>/..., which is what these policies enforce.
create policy sources_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);

create policy sources_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);

create policy sources_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);

create policy stickers_select_own_files on storage.objects
  for select to authenticated
  using (bucket_id = 'stickers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy stickers_delete_own_files on storage.objects
  for delete to authenticated
  using (bucket_id = 'stickers' and (storage.foldername(name))[1] = auth.uid()::text);
