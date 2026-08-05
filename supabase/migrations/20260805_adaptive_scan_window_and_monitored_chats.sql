-- GitHub runs the '*/5' cron roughly hourly in practice, so the worker's fixed
-- 6-minute lookback silently skipped most messages. Remember where each account
-- was last scanned and resume from there.
alter table public.telegram_sessions
  add column if not exists last_scanned_at timestamptz;

comment on column public.telegram_sessions.last_scanned_at is
  'End of the last successful scan. The next run resumes from here instead of a fixed window.';

-- Per-chat opt-out. Chats are discovered by the worker and enabled by default,
-- so monitoring keeps working for accounts that never open the settings page.
create table if not exists public.monitored_chats (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  chat_id text not null,
  chat_title text,
  chat_type text check (chat_type in ('group', 'channel', 'private')),
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, chat_id)
);

create index if not exists idx_monitored_chats_user on public.monitored_chats (user_id);

alter table public.monitored_chats enable row level security;

drop policy if exists "Users can view their own monitored chats" on public.monitored_chats;
create policy "Users can view their own monitored chats" on public.monitored_chats
  for select using (auth.uid() = user_id);

drop policy if exists "Users can toggle their own monitored chats" on public.monitored_chats;
create policy "Users can toggle their own monitored chats" on public.monitored_chats
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, update on public.monitored_chats to authenticated;

-- Upserting from the worker must refresh the title but never reset the user's
-- own enabled/disabled choice, so it goes through this function rather than a
-- plain upsert (which would send `enabled` back to its default).
create or replace function public.record_monitored_chats(p_user_id uuid, p_chats jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.monitored_chats (user_id, chat_id, chat_title, chat_type, last_seen_at)
  select p_user_id,
         chat ->> 'chat_id',
         chat ->> 'chat_title',
         chat ->> 'chat_type',
         now()
  from jsonb_array_elements(p_chats) as chat
  on conflict (user_id, chat_id) do update
    set chat_title  = excluded.chat_title,
        chat_type   = excluded.chat_type,
        last_seen_at = now();
end;
$$;
revoke all on function public.record_monitored_chats(uuid, jsonb) from public, anon, authenticated;
