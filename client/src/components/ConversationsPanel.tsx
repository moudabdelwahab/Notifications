import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  getMessages,
  listChats,
  type TelegramChat,
  type TelegramMessage,
} from '@/lib/telegramMessages';
import {
  Loader2,
  Search,
  Users,
  Radio,
  User as UserIcon,
  RefreshCw,
  MessagesSquare,
  Paperclip,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

const KIND = {
  group: { label: 'مجموعة', Icon: Users },
  channel: { label: 'قناة', Icon: Radio },
  private: { label: 'خاص', Icon: UserIcon },
} as const;

type TypeFilter = 'all' | 'group' | 'channel' | 'private';

function shortTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Browses the user's Telegram conversations.
 *
 * Chats and messages are fetched on demand through the telegram-messages Edge
 * Function and never stored — the app holds no copy of anyone's conversations,
 * and the browser never receives the Telegram session.
 */
export default function ConversationsPanel() {
  const [chats, setChats] = useState<TelegramChat[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const [activeChat, setActiveChat] = useState<TelegramChat | null>(null);
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const loadChats = async () => {
    setLoadingChats(true);
    setChatsError(null);
    try {
      const { chats } = await listChats();
      setChats(chats);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر تحميل المحادثات';
      setChatsError(message);
      toast.error(message);
    } finally {
      setLoadingChats(false);
    }
  };

  useEffect(() => {
    void loadChats();
  }, []);

  const openChat = async (chat: TelegramChat) => {
    setActiveChat(chat);
    setMessages([]);
    setMessagesError(null);
    setLoadingMessages(true);
    try {
      const { messages } = await getMessages(chat.id);
      setMessages(messages);
      // Land at the newest message, the way a chat app does.
      requestAnimationFrame(() => {
        const el = threadRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر تحميل الرسائل';
      setMessagesError(message);
    } finally {
      setLoadingMessages(false);
    }
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return chats
      .filter((c) => {
        if (typeFilter !== 'all' && c.type !== typeFilter) return false;
        if (!needle) return true;
        return c.title.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        const at = a.lastMessage?.date ? Date.parse(a.lastMessage.date) : 0;
        const bt = b.lastMessage?.date ? Date.parse(b.lastMessage.date) : 0;
        return bt - at;
      });
  }, [chats, query, typeFilter]);

  const counts = useMemo(
    () => ({
      all: chats.length,
      group: chats.filter((c) => c.type === 'group').length,
      channel: chats.filter((c) => c.type === 'channel').length,
      private: chats.filter((c) => c.type === 'private').length,
    }),
    [chats],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Chat list */}
      <div className="lg:col-span-2">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-400 absolute top-1/2 -translate-y-1/2 right-3" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث عن محادثة"
                  className="h-10 rounded-xl border-gray-300 pr-10"
                />
              </div>
              <Button
                onClick={loadChats}
                variant="outline"
                size="sm"
                className="rounded-lg h-10"
                title="تحديث القائمة"
                disabled={loadingChats}
              >
                <RefreshCw className={`w-4 h-4 ${loadingChats ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['all', `الكل (${counts.all})`],
                  ['group', `مجموعات (${counts.group})`],
                  ['channel', `قنوات (${counts.channel})`],
                  ['private', `خاص (${counts.private})`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTypeFilter(value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    typeFilter === value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loadingChats ? (
            <div className="py-16 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : chatsError ? (
            <div className="p-8 text-center">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <p className="text-sm text-red-700 mb-3">{chatsError}</p>
              <Button onClick={loadChats} variant="outline" size="sm" className="rounded-lg">
                إعادة المحاولة
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">لا توجد محادثات مطابقة</p>
          ) : (
            <div className="divide-y divide-gray-200 max-h-[62vh] overflow-y-auto">
              {visible.map((chat) => {
                const kind = KIND[chat.type];
                const Icon = kind.Icon;
                const isActive = activeChat?.id === chat.id;
                return (
                  <button
                    key={chat.id}
                    onClick={() => openChat(chat)}
                    className={`w-full text-right p-3 flex items-start gap-3 transition-colors ${
                      isActive ? 'bg-blue-50 border-r-4 border-blue-600' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-gray-500" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900 truncate flex-1">{chat.title}</p>
                        {chat.unreadCount > 0 && (
                          <span className="bg-blue-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 flex-shrink-0">
                            {chat.unreadCount}
                          </span>
                        )}
                      </div>
                      {chat.lastMessage && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {chat.lastMessage.outgoing && <span className="text-gray-400">أنت: </span>}
                          {chat.lastMessage.text}
                        </p>
                      )}
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {kind.label}
                        {chat.lastMessage?.date && ` · ${shortTime(chat.lastMessage.date)}`}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="lg:col-span-3">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden lg:sticky lg:top-24">
          {!activeChat ? (
            <div className="py-20 text-center">
              <MessagesSquare className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">اختر محادثة لعرض رسائلها</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-gray-200 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                  {(() => {
                    const Icon = KIND[activeChat.type].Icon;
                    return <Icon className="w-5 h-5 text-gray-500" />;
                  })()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 truncate">{activeChat.title}</p>
                  <p className="text-xs text-gray-500">
                    {KIND[activeChat.type].label}
                    {activeChat.username && ` · @${activeChat.username}`}
                  </p>
                </div>
                {activeChat.username && (
                  <a
                    href={`https://t.me/${activeChat.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm" className="rounded-lg flex items-center gap-2">
                      <ExternalLink className="w-4 h-4" />
                      Telegram
                    </Button>
                  </a>
                )}
              </div>

              {loadingMessages ? (
                <div className="py-20 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                </div>
              ) : messagesError ? (
                <div className="p-8 text-center">
                  <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
                  <p className="text-sm text-red-700 mb-3">{messagesError}</p>
                  <Button
                    onClick={() => openChat(activeChat)}
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                  >
                    إعادة المحاولة
                  </Button>
                </div>
              ) : messages.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-16">لا توجد رسائل</p>
              ) : (
                <div ref={threadRef} className="p-4 space-y-3 max-h-[55vh] overflow-y-auto">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.outgoing ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                          message.outgoing
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}
                      >
                        {!message.outgoing && (
                          <p className="text-xs font-semibold text-blue-700 mb-1">
                            {message.senderName}
                          </p>
                        )}

                        <p className="whitespace-pre-wrap break-words text-sm">
                          {message.text || '—'}
                        </p>

                        <div
                          className={`flex items-center gap-2 mt-1 text-[11px] ${
                            message.outgoing ? 'text-blue-100' : 'text-gray-500'
                          }`}
                        >
                          {message.hasMedia && <Paperclip className="w-3 h-3" />}
                          <span>{shortTime(message.date)}</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  <p className="text-center text-xs text-gray-400 pt-2">
                    آخر {messages.length} رسالة — القراءة فقط، لا يمكن الإرسال من هنا
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
