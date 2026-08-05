-- A chat link was being derived as t.me/c/<internal_id>, which Telegram does not
-- recognise without a message id — it redirects to telegram.org. The only link
-- that opens a chat directly is t.me/<username>, so record the username.
alter table public.notifications add column if not exists chat_username text;
alter table public.monitored_chats add column if not exists chat_username text;

comment on column public.notifications.chat_username is
  'Public @username of the chat, when it has one. Private groups have none and get no chat-level link.';

create or replace function public.record_monitored_chats(p_user_id uuid, p_chats jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.monitored_chats (user_id, chat_id, chat_title, chat_type, chat_username, last_seen_at)
  select p_user_id,
         chat ->> 'chat_id',
         chat ->> 'chat_title',
         chat ->> 'chat_type',
         chat ->> 'chat_username',
         now()
  from jsonb_array_elements(p_chats) as chat
  on conflict (user_id, chat_id) do update
    set chat_title    = excluded.chat_title,
        chat_type     = excluded.chat_type,
        chat_username = excluded.chat_username,
        last_seen_at  = now();
end;
$$;
revoke all on function public.record_monitored_chats(uuid, jsonb) from public, anon, authenticated;
