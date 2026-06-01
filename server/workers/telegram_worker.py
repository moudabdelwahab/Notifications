import os
import asyncio
import json
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from supabase import create_client, Client
from datetime import datetime, timedelta, timezone

# Configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async def process_user_telegram(user_id, api_id, api_hash, session_str):
    print(f"Processing Telegram for user: {user_id}")
    
    try:
        client = TelegramClient(StringSession(session_str), api_id, api_hash)
        await client.connect()
        
        if not await client.is_user_authorized():
            print(f"User {user_id} not authorized. Session might be expired.")
            return

        me = await client.get_me()
        my_id = me.id
        my_username = me.username

        # Get last 5 minutes messages
        time_threshold = datetime.now(timezone.utc) - timedelta(minutes=6) # 6 minutes to be safe
        
        async for dialog in client.iter_dialogs(limit=100):
            # Process mentions and replies in each dialog
            async for message in client.iter_messages(dialog.id, limit=50):
                if message.date < time_threshold:
                    break
                
                is_mention = False
                is_reply = False
                
                # Check for mentions
                if my_username and message.message and f"@{my_username}" in message.message:
                    is_mention = True
                
                # Check for replies to me
                if message.reply_to:
                    reply_msg = await message.get_reply_message()
                    if reply_msg and reply_msg.sender_id == my_id:
                        is_reply = True
                
                if is_mention or is_reply:
                    type_str = "mention" if is_mention else "reply"
                    source_str = f"tg_{dialog.id}_{message.id}"
                    
                    # Prepare notification data
                    sender = await message.get_sender()
                    sender_name = "Unknown"
                    if sender:
                        sender_name = getattr(sender, 'first_name', 'Unknown')
                        if getattr(sender, 'last_name', None):
                            sender_name += f" {sender.last_name}"

                    notification_data = {
                        "user_id": user_id,
                        "type": type_str,
                        "source": source_str,
                        "message_text": message.message or "[Media/No Text]",
                        "message_link": f"https://t.me/c/{str(dialog.id).replace('-100', '')}/{message.id}" if dialog.is_group or dialog.is_channel else None,
                        "sender_name": sender_name,
                        "created_at": message.date.isoformat()
                    }
                    
                    try:
                        # Check existence first
                        existing = supabase.table("notifications").select("id").eq("source", source_str).execute()
                        if not existing.data:
                            supabase.table("notifications").insert(notification_data).execute()
                            print(f"Inserted {type_str} for user {user_id}")
                    except Exception as e:
                        print(f"Error inserting notification: {e}")

        await client.disconnect()
    except Exception as e:
        print(f"Error processing user {user_id}: {e}")

async def main():
    try:
        # Fetch all users with monitoring enabled and their sessions
        response = supabase.table("telegram_sessions").select("user_id, session_data, users(telegram_api_id, telegram_api_hash, monitoring_enabled)").execute()
        
        tasks = []
        for session in response.data:
            user_settings = session.get("users", {})
            if user_settings and user_settings.get("monitoring_enabled"):
                user_id = session["user_id"]
                session_str = session["session_data"]
                
                api_id_raw = user_settings.get("telegram_api_id")
                api_hash = user_settings.get("telegram_api_hash")
                
                if api_id_raw and api_hash:
                    api_id = int(api_id_raw)
                    tasks.append(process_user_telegram(user_id, api_id, api_hash, session_str))
        
        if tasks:
            await asyncio.gather(*tasks)
        else:
            print("No active monitoring sessions found.")
    except Exception as e:
        print(f"Main loop error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
