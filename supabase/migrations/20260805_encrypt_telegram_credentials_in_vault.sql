-- Telegram session strings and API hashes grant full control of a user's account
-- and were stored as plaintext. Move them into Supabase Vault, which encrypts at
-- rest with a root key held outside the database.

alter table public.telegram_sessions
  add column if not exists session_secret_id uuid,
  alter column session_data drop not null;

alter table public.users
  add column if not exists api_hash_secret_id uuid;

-- Migrate what is already stored.
do $$
declare
  row record;
  v_id uuid;
begin
  for row in select user_id, session_data from public.telegram_sessions
             where session_data is not null and session_secret_id is null
  loop
    v_id := vault.create_secret(row.session_data, 'tg_session_' || row.user_id::text,
                                'Telegram StringSession');
    update public.telegram_sessions
      set session_secret_id = v_id, session_data = null
      where user_id = row.user_id;
  end loop;

  for row in select id, telegram_api_hash from public.users
             where telegram_api_hash is not null and api_hash_secret_id is null
  loop
    v_id := vault.create_secret(row.telegram_api_hash, 'tg_apihash_' || row.id::text,
                                'Telegram api_hash');
    update public.users
      set api_hash_secret_id = v_id, telegram_api_hash = null
      where id = row.id;
  end loop;
end $$;

-- Accessors. SECURITY DEFINER so callers never touch the vault schema directly,
-- and execute is granted to service_role only — a signed-in user has no way to
-- read their own session back out.
create or replace function public.set_telegram_session(
  p_user_id uuid, p_session text, p_phone text, p_api_id text, p_api_hash text
)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_session_secret uuid;
  v_hash_secret uuid;
  v_session_name text := 'tg_session_' || p_user_id::text;
  v_hash_name text := 'tg_apihash_' || p_user_id::text;
begin
  select id into v_session_secret from vault.secrets where name = v_session_name;
  if v_session_secret is null then
    v_session_secret := vault.create_secret(p_session, v_session_name, 'Telegram StringSession');
  else
    perform vault.update_secret(v_session_secret, p_session);
  end if;

  select id into v_hash_secret from vault.secrets where name = v_hash_name;
  if v_hash_secret is null then
    v_hash_secret := vault.create_secret(p_api_hash, v_hash_name, 'Telegram api_hash');
  else
    perform vault.update_secret(v_hash_secret, p_api_hash);
  end if;

  insert into public.telegram_sessions (user_id, session_data, session_secret_id, phone, updated_at)
  values (p_user_id, null, v_session_secret, p_phone, now())
  on conflict (user_id) do update
    set session_secret_id = excluded.session_secret_id,
        session_data      = null,
        phone             = excluded.phone,
        updated_at        = now(),
        status            = 'active',
        status_message    = null;

  update public.users
    set telegram_phone     = p_phone,
        telegram_api_id    = p_api_id,
        telegram_api_hash  = null,
        api_hash_secret_id = v_hash_secret,
        monitoring_enabled = true,
        updated_at         = now()
    where id = p_user_id;
end;
$$;

create or replace function public.get_telegram_credentials(p_user_id uuid)
returns table (session_data text, api_id text, api_hash text, phone text)
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select sd.decrypted_secret,
         u.telegram_api_id,
         hd.decrypted_secret,
         ts.phone
  from public.telegram_sessions ts
  join public.users u on u.id = ts.user_id
  left join vault.decrypted_secrets sd on sd.id = ts.session_secret_id
  left join vault.decrypted_secrets hd on hd.id = u.api_hash_secret_id
  where ts.user_id = p_user_id;
$$;

revoke all on function public.set_telegram_session(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_telegram_credentials(uuid)
  from public, anon, authenticated;
grant execute on function public.set_telegram_session(uuid, text, text, text, text) to service_role;
grant execute on function public.get_telegram_credentials(uuid) to service_role;
