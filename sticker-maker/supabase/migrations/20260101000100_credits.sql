-- Credit movement. All of it is SECURITY DEFINER: the client may read its balance
-- but may never write it.
--
-- Race safety: the balance is changed by a single conditional UPDATE, which takes a
-- row lock, so two concurrent charges serialize and the second one sees the reduced
-- balance. Idempotency: (user_id, request_id) is unique in credit_ledger, so a retry
-- of the same intent replays the previous outcome instead of charging again.

create type public.credit_result as (
  generation_credits int,
  export_credits int,
  charged boolean
);

create or replace function public.consume_credits(
  p_kind public.credit_kind,
  p_amount int,
  p_request_id text,
  p_ref_type text default null,
  p_ref_id uuid default null
)
returns setof public.credit_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_generation int;
  v_export int;
  v_already boolean;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'invalid_request_id' using errcode = '22023';
  end if;

  select true into v_already
  from public.credit_ledger
  where user_id = v_user and request_id = p_request_id
  limit 1;

  if v_already then
    select p.generation_credits, p.export_credits into v_generation, v_export
    from public.profiles p where p.id = v_user;
    return next (v_generation, v_export, false)::public.credit_result;
    return;
  end if;

  if p_kind = 'generation' then
    update public.profiles
      set generation_credits = generation_credits - p_amount
      where id = v_user and generation_credits >= p_amount
      returning generation_credits, export_credits into v_generation, v_export;
  else
    update public.profiles
      set export_credits = export_credits - p_amount
      where id = v_user and export_credits >= p_amount
      returning generation_credits, export_credits into v_generation, v_export;
  end if;

  if v_generation is null then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  begin
    insert into public.credit_ledger (user_id, kind, reason, delta, ref_type, ref_id, request_id)
    values (v_user, p_kind, 'consume', -p_amount, p_ref_type, p_ref_id, p_request_id);
  exception when unique_violation then
    -- Another transaction charged the same intent between our check and our insert.
    -- Give the credits back and report the charge as a replay.
    if p_kind = 'generation' then
      update public.profiles set generation_credits = generation_credits + p_amount
        where id = v_user returning generation_credits, export_credits into v_generation, v_export;
    else
      update public.profiles set export_credits = export_credits + p_amount
        where id = v_user returning generation_credits, export_credits into v_generation, v_export;
    end if;
    return next (v_generation, v_export, false)::public.credit_result;
    return;
  end;

  return next (v_generation, v_export, true)::public.credit_result;
end;
$$;

create or replace function public.grant_credits(
  p_kind public.credit_kind,
  p_amount int,
  p_reason public.ledger_reason,
  p_request_id text,
  p_user_id uuid default null
)
returns setof public.credit_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
  v_generation int;
  v_export int;
  v_already boolean;
begin
  -- Only the service role may grant credits to somebody else (RevenueCat webhook).
  if p_user_id is not null and auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  select true into v_already
  from public.credit_ledger
  where user_id = v_user and request_id = p_request_id
  limit 1;

  if v_already then
    select p.generation_credits, p.export_credits into v_generation, v_export
    from public.profiles p where p.id = v_user;
    return next (v_generation, v_export, false)::public.credit_result;
    return;
  end if;

  insert into public.credit_ledger (user_id, kind, reason, delta, request_id)
  values (v_user, p_kind, p_reason, p_amount, p_request_id);

  if p_kind = 'generation' then
    update public.profiles set generation_credits = generation_credits + p_amount
      where id = v_user returning generation_credits, export_credits into v_generation, v_export;
  else
    update public.profiles set export_credits = export_credits + p_amount
      where id = v_user returning generation_credits, export_credits into v_generation, v_export;
  end if;

  return next (v_generation, v_export, true)::public.credit_result;
end;
$$;

/**
 * Refund path for a failed generation. Keyed off the generation id so a retry of the
 * refund (for example a webhook redelivery) cannot hand out credits twice.
 */
create or replace function public.refund_generation(p_generation_id uuid)
returns setof public.credit_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_generation public.generations;
  v_generation_credits int;
  v_export_credits int;
  v_already boolean;
begin
  select * into v_generation from public.generations where id = p_generation_id;
  if not found then
    raise exception 'generation_not_found' using errcode = 'P0002';
  end if;
  if auth.role() <> 'service_role' and v_generation.user_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select true into v_already
  from public.credit_ledger
  where user_id = v_generation.user_id
    and request_id = 'refund_' || p_generation_id::text
  limit 1;

  if v_already then
    select p.generation_credits, p.export_credits into v_generation_credits, v_export_credits
    from public.profiles p where p.id = v_generation.user_id;
    return next (v_generation_credits, v_export_credits, false)::public.credit_result;
    return;
  end if;

  insert into public.credit_ledger (user_id, kind, reason, delta, ref_type, ref_id, request_id)
  values (
    v_generation.user_id, 'generation', 'refund', 1, 'generation', p_generation_id,
    'refund_' || p_generation_id::text
  );

  update public.profiles set generation_credits = generation_credits + 1
    where id = v_generation.user_id
    returning generation_credits, export_credits into v_generation_credits, v_export_credits;

  return next (v_generation_credits, v_export_credits, true)::public.credit_result;
end;
$$;

/** One-time bonus the moment an anonymous account is upgraded to a real identity. */
create or replace function public.claim_sign_in_bonus()
returns setof public.credit_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_settings public.credit_settings;
  v_claimed boolean;
  v_generation int;
  v_export int;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_settings from public.credit_settings where id;

  -- Conditional update is the lock: only the first caller flips the flag.
  update public.profiles
    set sign_in_bonus_granted = true, is_anonymous = false
    where id = v_user and sign_in_bonus_granted = false
    returning true into v_claimed;

  if not coalesce(v_claimed, false) then
    select p.generation_credits, p.export_credits into v_generation, v_export
    from public.profiles p where p.id = v_user;
    return next (v_generation, v_export, false)::public.credit_result;
    return;
  end if;

  insert into public.credit_ledger (user_id, kind, reason, delta, request_id)
  values
    (v_user, 'generation', 'bonus', v_settings.sign_in_bonus_generation_credits,
      'signin_bonus_generation_' || v_user::text),
    (v_user, 'export', 'bonus', v_settings.sign_in_bonus_export_credits,
      'signin_bonus_export_' || v_user::text);

  update public.profiles
    set generation_credits = generation_credits + v_settings.sign_in_bonus_generation_credits,
        export_credits = export_credits + v_settings.sign_in_bonus_export_credits
    where id = v_user
    returning generation_credits, export_credits into v_generation, v_export;

  return next (v_generation, v_export, true)::public.credit_result;
end;
$$;

/** Bonus export credits the first time a user actually exports something. */
create or replace function public.claim_first_export_bonus()
returns setof public.credit_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_settings public.credit_settings;
  v_claimed boolean;
  v_generation int;
  v_export int;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_settings from public.credit_settings where id;

  update public.profiles
    set first_export_bonus_granted = true
    where id = v_user and first_export_bonus_granted = false
    returning true into v_claimed;

  if not coalesce(v_claimed, false) then
    select p.generation_credits, p.export_credits into v_generation, v_export
    from public.profiles p where p.id = v_user;
    return next (v_generation, v_export, false)::public.credit_result;
    return;
  end if;

  insert into public.credit_ledger (user_id, kind, reason, delta, request_id)
  values (
    v_user, 'export', 'bonus', v_settings.first_export_bonus_export_credits,
    'first_export_bonus_' || v_user::text
  );

  update public.profiles
    set export_credits = export_credits + v_settings.first_export_bonus_export_credits
    where id = v_user
    returning generation_credits, export_credits into v_generation, v_export;

  return next (v_generation, v_export, true)::public.credit_result;
end;
$$;

revoke all on function public.grant_credits(public.credit_kind, int, public.ledger_reason, text, uuid) from anon;
grant execute on function public.consume_credits(public.credit_kind, int, text, text, uuid) to authenticated;
grant execute on function public.claim_sign_in_bonus() to authenticated;
grant execute on function public.claim_first_export_bonus() to authenticated;
