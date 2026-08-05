-- The UI could only show the raw dedup key (tg_-1003154944524_72829) because the
-- chat's name and kind were never recorded.
alter table public.notifications
  add column if not exists chat_title text,
  add column if not exists chat_type text
    check (chat_type in ('group', 'channel', 'private'));

comment on column public.notifications.chat_title is
  'Display name of the Telegram chat the message came from.';
comment on column public.notifications.chat_type is
  'group = (super)group, channel = broadcast channel, private = direct message.';

-- Enforce dedup in the database; the worker used to SELECT-then-INSERT, which
-- raced with itself whenever two scheduled runs overlapped.
create unique index if not exists idx_notifications_source_unique
  on public.notifications (source);
