"""
Scans each linked Telegram account for mentions and replies and records them
in the `notifications` table.

Runs on a schedule from .github/workflows/telegram-monitor.yml.

Exit code is 0 only when every linked account was processed successfully — a
previous version swallowed all exceptions and always exited 0, so 698 scheduled
runs reported "success" while inserting nothing.

Each run resumes from `telegram_sessions.last_scanned_at` rather than a fixed
window: GitHub throttles the '*/5' schedule on quiet repositories down to about
one run per hour, and a fixed 6-minute lookback dropped everything in between.
"""

import asyncio
import base64
import os
import sys
from datetime import datetime, timedelta, timezone

from supabase import Client, create_client
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import InputMessageEntityMentionName, MessageEntityMentionName

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.", file=sys.stderr)
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# The workflow asks for every 5 minutes, but GitHub throttles scheduled runs on
# quiet repositories heavily — in practice this fires roughly once an hour, and
# gaps of several hours happen. So each run resumes from where the last one
# finished rather than assuming the schedule was honoured.
OVERLAP = timedelta(minutes=1)  # re-check a little either side of the boundary
MAX_LOOKBACK = timedelta(hours=24)  # first run, or after a long outage
DEFAULT_LOOKBACK = timedelta(hours=1)  # no recorded scan yet
# None = every dialog, including archived ones. A fixed limit silently ignored
# chats past the cutoff.
DIALOG_LIMIT = None
# Not a window limit — the window is bounded by `since`. This only stops a
# runaway chat from consuming the whole run, and it is reported loudly when hit.
MESSAGE_SAFETY_CAP = 3000


def looks_like_telethon_session(session_str: str) -> bool:
    """
    Cheap sanity check for a Telethon v1 string session.

    Format: '1' + urlsafe base64 of (dc_id:1B, ip:4B or 16B, port:2B, auth_key:256B).
    The retired auth flow stored 'session_<random>' placeholders here, which are
    not loadable and produce a confusing error deep inside Telethon.
    """
    if not session_str or not session_str.startswith("1"):
        return False
    try:
        raw = base64.urlsafe_b64decode(session_str[1:])
    except Exception:
        return False
    return len(raw) in (263, 275)


def mentions_me(message, my_id, my_username) -> bool:
    """
    Three independent checks, because no single one catches every mention.

    1. Telegram's own `mentioned` flag, set server-side. Authoritative, and the
       only thing that catches a mention when you have no username at all.
    2. Case-insensitive '@username' in the text. Telegram usernames are
       case-insensitive, so '@Mahmoud' must match the username 'mahmoud'.
    3. MessageEntityMentionName — a "text mention", where someone taps your name
       and no '@' is typed at all. Invisible to a plain text search.
    """
    if getattr(message, "mentioned", False):
        return True

    text = message.message or ""
    if my_username and f"@{my_username}".casefold() in text.casefold():
        return True

    for entity in getattr(message, "entities", None) or []:
        if isinstance(entity, (MessageEntityMentionName, InputMessageEntityMentionName)):
            if getattr(entity, "user_id", None) == my_id:
                return True

    return False


def chat_kind(dialog) -> str:
    """
    Classifies a dialog for display.

    Telethon reports supergroups as both is_group and is_channel, so is_group has
    to be checked first or every supergroup would be labelled a broadcast channel.
    """
    if dialog.is_group:
        return "group"
    if dialog.is_channel:
        return "channel"
    return "private"


def scan_since(last_scanned_at) -> datetime:
    """
    Where this run should start reading from.

    Resuming from the previous scan is what keeps messages from being dropped
    when GitHub delays the schedule by an hour or more. Capped so that a long
    outage does not turn into an unbounded backfill.
    """
    now = datetime.now(timezone.utc)
    if not last_scanned_at:
        return now - DEFAULT_LOOKBACK

    parsed = datetime.fromisoformat(str(last_scanned_at).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(parsed - OVERLAP, now - MAX_LOOKBACK)


async def process_user(user_id, api_id, api_hash, session_str, last_scanned_at) -> bool:
    """Returns True when the account was scanned successfully."""
    since = scan_since(last_scanned_at)
    print(f"[{user_id}] scanning messages since {since.isoformat()}")

    if not looks_like_telethon_session(session_str):
        print(
            f"[{user_id}] SKIP: stored session is not a Telethon string session. "
            "The user must re-link their account via /onboarding.",
            file=sys.stderr,
        )
        return False

    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    try:
        await client.connect()

        if not await client.is_user_authorized():
            print(
                f"[{user_id}] SKIP: session is no longer authorized (revoked or expired). "
                "The user must re-link their account.",
                file=sys.stderr,
            )
            return False

        me = await client.get_me()
        my_id = me.id
        my_username = me.username
        if not my_username:
            print(
                f"[{user_id}] note: account has no @username. Mentions are still detected via "
                "Telegram's own mention flag and text mentions."
            )

        scan_started = datetime.now(timezone.utc)
        found = 0

        dialogs = [d async for d in client.iter_dialogs(limit=DIALOG_LIMIT)]

        # Publish the chat list so the user has something to pick from in Settings,
        # then honour whatever they already turned off.
        supabase.rpc(
            "record_monitored_chats",
            {
                "p_user_id": user_id,
                "p_chats": [
                    {
                        "chat_id": str(d.id),
                        "chat_title": d.name or None,
                        "chat_type": chat_kind(d),
                        "chat_username": getattr(d.entity, "username", None),
                    }
                    for d in dialogs
                ],
            },
        ).execute()

        disabled = {
            row["chat_id"]
            for row in (
                supabase.table("monitored_chats")
                .select("chat_id")
                .eq("user_id", user_id)
                .eq("enabled", False)
                .execute()
                .data
                or []
            )
        }
        if disabled:
            print(f"[{user_id}] {len(disabled)} chat(s) muted by the user")

        for dialog in dialogs:
            if str(dialog.id) in disabled:
                continue

            # Collect the whole window first. There is no message-count limit:
            # capping it truncated busy chats, dropping everything past the cap
            # even though it was still inside the window.
            window = []
            async for message in client.iter_messages(dialog.id, limit=None):
                if message.date < since:
                    break
                if message.sender_id == my_id:
                    continue  # never notify someone about their own message
                window.append(message)
                if len(window) >= MESSAGE_SAFETY_CAP:
                    print(
                        f"[{user_id}] WARNING: hit the {MESSAGE_SAFETY_CAP}-message cap in "
                        f"'{dialog.name}'; older messages in this window were not examined.",
                        file=sys.stderr,
                    )
                    break

            if not window:
                continue

            # Resolve every replied-to message in one request per chat rather than
            # one per message.
            reply_ids = {
                m.reply_to.reply_to_msg_id
                for m in window
                if m.reply_to and getattr(m.reply_to, "reply_to_msg_id", None)
            }
            replied_to = {}
            if reply_ids:
                ids = list(reply_ids)
                fetched = await client.get_messages(dialog.id, ids=ids)
                replied_to = {i: msg for i, msg in zip(ids, fetched) if msg is not None}

            for message in window:
                target = None
                if message.reply_to and getattr(message.reply_to, "reply_to_msg_id", None):
                    target = replied_to.get(message.reply_to.reply_to_msg_id)
                is_reply = bool(target and target.sender_id == my_id)

                # A reply to you also sets Telegram's `mentioned` flag, so replies
                # are classified first and mention is what is left over.
                is_mention = not is_reply and mentions_me(message, my_id, my_username)

                if not (is_mention or is_reply):
                    continue

                sender = await message.get_sender()
                sender_name = "Unknown"
                if sender:
                    sender_name = getattr(sender, "first_name", None) or "Unknown"
                    if getattr(sender, "last_name", None):
                        sender_name += f" {sender.last_name}"

                message_link = None
                if dialog.is_group or dialog.is_channel:
                    chat_id = str(dialog.id).replace("-100", "", 1)
                    message_link = f"https://t.me/c/{chat_id}/{message.id}"

                notification = {
                    "user_id": user_id,
                    "type": "mention" if is_mention else "reply",
                    "source": f"tg_{dialog.id}_{message.id}",
                    "message_text": message.message or "[Media/No Text]",
                    "message_link": message_link,
                    "sender_name": sender_name,
                    "chat_title": dialog.name or None,
                    "chat_type": chat_kind(dialog),
                    "chat_username": getattr(dialog.entity, "username", None),
                    "created_at": message.date.isoformat(),
                }

                try:
                    # idx_notifications_source_unique makes this idempotent, so
                    # overlapping runs cannot double-insert the same message.
                    supabase.table("notifications").upsert(
                        notification, on_conflict="source", ignore_duplicates=True
                    ).execute()
                    found += 1
                except Exception as exc:
                    print(f"[{user_id}] failed to store {notification['source']}: {exc}", file=sys.stderr)
                    return False

        # Only advance the watermark on a clean pass, so a failure re-scans the
        # same window next time instead of skipping over it.
        supabase.table("telegram_sessions").update(
            {"last_scanned_at": scan_started.isoformat()}
        ).eq("user_id", user_id).execute()

        print(f"[{user_id}] done, {found} notification(s), {len(dialogs)} chat(s) scanned")
        return True

    except Exception as exc:
        print(f"[{user_id}] ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


async def main() -> int:
    response = (
        supabase.table("telegram_sessions")
        .select(
            "user_id, session_data, last_scanned_at, "
            "users(telegram_api_id, telegram_api_hash, monitoring_enabled)"
        )
        .execute()
    )

    tasks = []
    skipped = 0
    for session in response.data or []:
        settings = session.get("users") or {}
        if isinstance(settings, list):  # PostgREST returns a list for some embeds
            settings = settings[0] if settings else {}

        if not settings.get("monitoring_enabled"):
            skipped += 1
            continue

        api_id_raw = settings.get("telegram_api_id")
        api_hash = settings.get("telegram_api_hash")
        if not api_id_raw or not api_hash:
            print(
                f"[{session['user_id']}] SKIP: missing telegram_api_id/telegram_api_hash",
                file=sys.stderr,
            )
            skipped += 1
            continue

        tasks.append(
            process_user(
                session["user_id"],
                int(api_id_raw),
                api_hash,
                session["session_data"],
                session.get("last_scanned_at"),
            )
        )

    if not tasks:
        print(f"No active monitoring sessions found ({skipped} skipped).")
        return 0

    results = await asyncio.gather(*tasks)
    failed = results.count(False)
    print(f"Processed {len(results)} account(s): {results.count(True)} ok, {failed} failed, {skipped} skipped.")

    # Surface failures as a red run instead of a green one that did nothing.
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
