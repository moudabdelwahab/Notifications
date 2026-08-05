-- First write path to the user's real Telegram account. A loop in the UI or a
-- retry storm would send real messages to real people and can get the account
-- rate-limited by Telegram, so every send is recorded and capped.
create table if not exists public.sent_messages_log (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  chat_id text not null,
  message_id bigint,
  sent_at timestamptz not null default now()
);

create index if not exists idx_sent_messages_log_user_time
  on public.sent_messages_log (user_id, sent_at desc);

alter table public.sent_messages_log enable row level security;

drop policy if exists "Users can view their own sent log" on public.sent_messages_log;
create policy "Users can view their own sent log" on public.sent_messages_log
  for select using (auth.uid() = user_id);

-- Written by the edge function (service role) only; the client must not be able
-- to forge or erase its own rate-limit history.
grant select on public.sent_messages_log to authenticated;
