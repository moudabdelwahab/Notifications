-- A send can succeed at Telegram and still fail to reach the browser: the
-- response was observed being lost while the message was delivered. Without an
-- idempotency key the user's natural retry becomes a duplicate message.
alter table public.sent_messages_log
  add column if not exists dedupe_key text,
  add column if not exists chat_title text;

create unique index if not exists idx_sent_messages_dedupe
  on public.sent_messages_log (user_id, dedupe_key)
  where dedupe_key is not null;

comment on column public.sent_messages_log.dedupe_key is
  'Client-generated nonce. A repeat of the same key returns the original result instead of sending again.';
