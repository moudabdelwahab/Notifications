import { callEdgeFunction } from '@/lib/telegramAuth';

export type ChatType = 'group' | 'channel' | 'private';

export interface TelegramChat {
  id: string;
  title: string;
  type: ChatType;
  username: string | null;
  isPinned: boolean;
  isArchived: boolean;
  isMuted: boolean;
  unreadCount: number;
  lastMessage: { text: string; date: string | null; outgoing: boolean } | null;
}

export interface TelegramMessage {
  id: number;
  text: string;
  date: string | null;
  outgoing: boolean;
  senderName: string;
  senderId: string | null;
  hasMedia: boolean;
  mediaType: string | null;
  isService: boolean;
  isReply: boolean;
  link: string | null;
}

export function listChats(): Promise<{ chats: TelegramChat[] }> {
  return callEdgeFunction('telegram-messages', { action: 'list-chats' });
}

export function getMessages(chatId: string, limit = 50): Promise<{ messages: TelegramMessage[] }> {
  return callEdgeFunction('telegram-messages', { action: 'get-messages', chatId, limit });
}

/** Telegram rejects anything longer; the edge function enforces this too. */
export const MAX_MESSAGE_LENGTH = 4096;

/**
 * `dedupeKey` must stay the same across retries of the same message.
 *
 * A send can succeed at Telegram and still fail to reach the browser — that was
 * observed in practice — so a retry without a stable key would deliver the
 * message twice.
 */
export interface Attachment {
  name: string;
  dataBase64: string;
}

/** Matches the cap enforced by the edge function. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export function sendMessage(
  chatId: string,
  text: string,
  dedupeKey: string,
  options: { replyTo?: number | null; attachment?: Attachment | null } = {},
): Promise<{ message: TelegramMessage; deduplicated?: boolean }> {
  return callEdgeFunction('telegram-messages', {
    action: 'send-message',
    chatId,
    text,
    dedupeKey,
    replyTo: options.replyTo ?? undefined,
    attachment: options.attachment ?? undefined,
  });
}

/** Clears the chat's unread badge in Telegram itself, not just locally. */
export function readHistory(chatId: string): Promise<{ ok: true }> {
  return callEdgeFunction('telegram-messages', { action: 'read-history', chatId });
}

/**
 * Reads a File into the base64 payload the edge function expects.
 *
 * `readAsDataURL` yields `data:<mime>;base64,<data>` — only the part after the
 * comma is the payload.
 */
export function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      if (comma < 0) {
        reject(new Error('تعذر قراءة الملف'));
        return;
      }
      resolve({ name: file.name, dataBase64: result.slice(comma + 1) });
    };
    reader.readAsDataURL(file);
  });
}
