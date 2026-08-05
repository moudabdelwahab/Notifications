-- Hardening pass that accompanies the real-MTProto rewrite of `telegram-auth`.
-- Applied to project ywjtqkkbxqnisduelgre.

-- 1. Signup trigger: pin search_path and never let a profile-insert failure block signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.users (id, email, google_id)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@placeholder.local'),
    new.raw_user_meta_data ->> 'sub'
  )
  on conflict (id) do nothing;
  return new;
exception
  when others then
    -- A duplicate email/google_id must not abort the auth signup transaction;
    -- telegram-auth re-creates the profile row on first use if it is missing.
    raise warning 'handle_new_user: could not create profile for %: %', new.id, sqlerrm;
    return new;
end;
$$;

-- 2. These are trigger functions; nothing should reach them through PostgREST's RPC surface.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

-- 3. otp_sessions now holds a live MTProto auth key in session_string. Only the
--    service role (telegram-auth) needs it, so drop the client-facing policies.
drop policy if exists "Users can manage their own OTP sessions" on public.otp_sessions;
drop policy if exists "Users can manage their own otp sessions" on public.otp_sessions;
drop policy if exists "Users can view their own OTP sessions" on public.otp_sessions;
drop policy if exists "Users can insert their own OTP sessions" on public.otp_sessions;
drop policy if exists "Users can delete their own OTP sessions" on public.otp_sessions;
revoke all on public.otp_sessions from anon, authenticated;

-- 4. Every OTP session must belong to a user.
delete from public.otp_sessions where user_id is null;
alter table public.otp_sessions alter column user_id set not null;

-- 5. Let a user disconnect their Telegram account from the app.
drop policy if exists "Users can delete their own session" on public.telegram_sessions;
create policy "Users can delete their own session" on public.telegram_sessions
  for delete using (auth.uid() = user_id);

-- 6. Housekeeping for abandoned onboarding attempts (they carry auth keys).
create index if not exists idx_otp_sessions_created_at on public.otp_sessions (created_at);

create or replace function public.cleanup_expired_otp_sessions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  delete from public.otp_sessions where created_at < now() - interval '15 minutes';
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.cleanup_expired_otp_sessions() from public, anon, authenticated;
