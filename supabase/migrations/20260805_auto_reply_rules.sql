-- Scheduled auto-replies.
--
-- NOTE: nothing sends yet. The worker runs on GitHub Actions, which throttles the
-- schedule to roughly one run per hour, and a reply that lands 50 minutes late is
-- worse than no reply. These tables and the settings screen exist so the rules can
-- be authored now; the sending path is deliberately not implemented until the
-- worker moves to a persistent host.
create table if not exists public.auto_reply_rules (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null default 'قاعدة جديدة',
  message text not null check (length(btrim(message)) between 1 and 1000),

  -- Local wall-clock window. end_time < start_time means the window crosses
  -- midnight (e.g. 22:00 → 08:00), which is the common case for "outside hours".
  start_time time not null default '22:00',
  end_time time not null default '08:00',
  -- 0 = Sunday … 6 = Saturday, matching JavaScript's Date#getDay.
  days_of_week smallint[] not null default '{0,1,2,3,4,5,6}',
  timezone text not null default 'Africa/Cairo',

  -- Replying inside a group is noisy and public, so private chats are the default.
  scope text not null default 'private' check (scope in ('private', 'all')),
  -- Reply at most once per person per this many minutes, so a conversation does
  -- not receive an automated reply to every message.
  cooldown_minutes integer not null default 240 check (cooldown_minutes between 5 and 10080),

  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_auto_reply_rules_user on public.auto_reply_rules (user_id);

alter table public.auto_reply_rules enable row level security;

drop policy if exists "Users manage their own auto-reply rules" on public.auto_reply_rules;
create policy "Users manage their own auto-reply rules" on public.auto_reply_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.auto_reply_rules to authenticated;

-- Record of what was actually sent. This is what enforces the cooldown and stops
-- two auto-responders from replying to each other forever.
create table if not exists public.auto_reply_log (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  rule_id uuid references public.auto_reply_rules(id) on delete set null,
  chat_id text not null,
  peer_name text,
  replied_at timestamptz not null default now()
);

create index if not exists idx_auto_reply_log_lookup
  on public.auto_reply_log (user_id, chat_id, replied_at desc);

alter table public.auto_reply_log enable row level security;

drop policy if exists "Users can view their own auto-reply log" on public.auto_reply_log;
create policy "Users can view their own auto-reply log" on public.auto_reply_log
  for select using (auth.uid() = user_id);

-- Written by the worker (service role) only.
grant select on public.auto_reply_log to authenticated;
