-- Pack ordering and the shared rate limiter used by every Edge Function.

/**
 * Rewrites the whole ordering of a pack in one statement. Positions are unique per
 * pack, so the rows are first parked on negative positions to avoid tripping the
 * unique index halfway through the rewrite.
 */
create or replace function public.reorder_pack_stickers(
  p_pack_id uuid,
  p_sticker_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid;
  v_count int;
begin
  select user_id into v_owner from public.packs where id = p_pack_id;
  if v_owner is null then
    raise exception 'pack_not_found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v_count from public.pack_stickers where pack_id = p_pack_id;
  if v_count <> coalesce(array_length(p_sticker_ids, 1), 0) then
    raise exception 'sticker_set_mismatch' using errcode = '22023';
  end if;

  update public.pack_stickers
    set position = -position - 1
    where pack_id = p_pack_id;

  update public.pack_stickers ps
    set position = ordered.new_position
    from (
      select unnest(p_sticker_ids) as sticker_id,
             generate_subscripts(p_sticker_ids, 1) - 1 as new_position
    ) as ordered
    where ps.pack_id = p_pack_id and ps.sticker_id = ordered.sticker_id;

  if exists (select 1 from public.pack_stickers where pack_id = p_pack_id and position < 0) then
    raise exception 'sticker_set_mismatch' using errcode = '22023';
  end if;
end;
$$;

grant execute on function public.reorder_pack_stickers(uuid, uuid[]) to authenticated;

/**
 * Fixed-window rate limiter. Called with the service role from Edge Functions;
 * returns false when the caller is over budget for the current window.
 */
create or replace function public.check_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_limit int,
  p_window interval default interval '1 hour'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz := date_trunc('hour', now());
  v_count int;
begin
  if p_window <> interval '1 hour' then
    v_window_start := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  end if;

  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into v_count;

  delete from public.rate_limits
    where user_id = p_user_id and bucket = p_bucket and window_start < v_window_start - p_window;

  return v_count <= p_limit;
end;
$$;

/**
 * Account deletion (App Store guideline 5.1.1(v)). Storage objects are removed by the
 * Edge Function before this runs; the cascade then clears every row.
 */
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  delete from auth.users where id = v_user;
end;
$$;

grant execute on function public.delete_own_account() to authenticated;
