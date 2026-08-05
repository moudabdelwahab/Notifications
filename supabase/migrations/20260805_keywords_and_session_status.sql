-- 1. Keyword monitoring -----------------------------------------------------
create table if not exists public.monitored_keywords (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  keyword text not null check (length(btrim(keyword)) between 2 and 60),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Matching is case-insensitive, so uniqueness must be too.
create unique index if not exists idx_monitored_keywords_unique
  on public.monitored_keywords (user_id, lower(btrim(keyword)));

alter table public.monitored_keywords enable row level security;

drop policy if exists "Users manage their own keywords" on public.monitored_keywords;
create policy "Users manage their own keywords" on public.monitored_keywords
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.monitored_keywords to authenticated;

-- A keyword hit is a third kind of notification alongside mentions and replies.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('mention', 'reply', 'keyword'));

alter table public.notifications
  add column if not exists matched_keyword text;

comment on column public.notifications.matched_keyword is
  'Which monitored keyword produced this notification. NULL for mentions and replies.';

-- 2. Session health ---------------------------------------------------------
-- When a session is revoked the worker used to log and move on, so the user
-- only found out by noticing the silence.
alter table public.telegram_sessions
  add column if not exists status text not null default 'active'
    check (status in ('active', 'expired', 'invalid')),
  add column if not exists status_message text,
  add column if not exists status_changed_at timestamptz;

comment on column public.telegram_sessions.status is
  'active = last scan authenticated fine; expired = Telegram rejected the session; invalid = stored value is not a usable session.';
