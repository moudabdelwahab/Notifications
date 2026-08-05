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

export function sendMessage(chatId: string, text: string): Promise<{ message: TelegramMessage }> {
  return callEdgeFunction('telegram-messages', { action: 'send-message', chatId, text });
}
