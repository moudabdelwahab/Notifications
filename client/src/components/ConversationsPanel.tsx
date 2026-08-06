import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '@/hooks/useMobile';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  getMessages,
  listChats,
  sendMessage,
  readHistory,
  fileToAttachment,
  MAX_MESSAGE_LENGTH,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
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
  ArrowRight,
  AlertTriangle,
  Send,
  CornerUpLeft,
  X,
  Image as ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';

const KIND = {
  group: { label: 'مجموعة', Icon: Users },
  channel: { label: 'قناة', Icon: Radio },
  private: { label: 'خاص', Icon: UserIcon },
} as const;

type TypeFilter = 'all' | 'group' | 'channel' | 'private';

/**
 * A dropped connection, not a rejection from the server — the request may well
 * have been carried out.
 */
function isTransportError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Failed to send a request|Failed to fetch|NetworkError|Load failed|network/i.test(message);
}

/**
 * Sends, and retries once if the response is lost in transit.
 *
 * Observed on a slow mobile connection: the message reaches Telegram and is
 * logged, then the reply cannot make it back and the browser gives up. The send
 * is idempotent on `dedupeKey`, so a second attempt either completes a send that
 * genuinely failed or replays the original result — never a duplicate. That
 * makes retrying automatically the correct behaviour rather than a gamble.
 */
async function sendWithRetry(
  chatId: string,
  text: string,
  dedupeKey: string,
  options: { replyTo?: number | null; attachment?: Attachment | null },
) {
  try {
    return await sendMessage(chatId, text, dedupeKey, options);
  } catch (err) {
    if (!isTransportError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return await sendMessage(chatId, text, dedupeKey, options);
  }
}

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
  const isMobile = useIsMobile();
  const [chats, setChats] = useState<TelegramChat[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const [activeChat, setActiveChat] = useState<TelegramChat | null>(null);
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<TelegramMessage | null>(null);
  const [attachment, setAttachment] = useState<{ file: File; payload: Attachment } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const retryKeyRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeChatIdRef = useRef<string | null>(null);
  // Read inside the polling interval, which closes over a stale `sending`.
  const sendingRef = useRef(false);

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

  const scrollToNewest = () => {
    requestAnimationFrame(() => {
      const el = threadRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const clearAttachment = () => {
    setAttachment(null);
    // Reset the input's value too, so picking the same file again still fires.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const pickAttachment = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      const mb = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024));
      toast.error(`حجم الملف أكبر من الحد المسموح (${mb} ميجابايت)`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    try {
      setAttachment({ file, payload: await fileToAttachment(file) });
    } catch {
      toast.error('تعذر قراءة الملف');
      clearAttachment();
    }
  };

  /**
   * Refreshes the open thread in the background.
   *
   * Supabase Realtime cannot serve this: conversations are deliberately never
   * written to the database, so there is no table to subscribe to. Polling the
   * open chat is what removes the need to reopen it to see a reply.
   */
  useEffect(() => {
    if (!activeChat) return;

    const id = setInterval(() => {
      // Skip while hidden or mid-send: a refresh would fight the optimistic
      // append and make a just-sent message flicker.
      if (document.hidden || sendingRef.current) return;

      getMessages(activeChat.id)
        .then(({ messages: fresh }) => {
          // The chat may have been switched while the request was in flight.
          if (activeChatIdRef.current !== activeChat.id) return;
          setMessages((prev) => {
            const newest = prev[prev.length - 1]?.id;
            const freshNewest = fresh[fresh.length - 1]?.id;
            if (newest === freshNewest && prev.length === fresh.length) return prev;
            scrollToNewest();
            return fresh;
          });
        })
        .catch(() => {
          // A dropped poll is not worth a toast; the next tick retries.
        });
    }, 15_000);

    return () => clearInterval(id);
  }, [activeChat]);

  const send = async () => {
    const text = draft.trim();
    if (!activeChat || (!text && !attachment) || sending) return;

    // Held across retries: the server uses it to recognise a repeat of the same
    // message and return the original result instead of sending a second copy.
    // Cleared only once a send is acknowledged.
    if (!retryKeyRef.current) retryKeyRef.current = crypto.randomUUID();

    setSending(true);
    sendingRef.current = true;
    try {
      const { message } = await sendWithRetry(activeChat.id, text, retryKeyRef.current, {
        replyTo: replyTo?.id ?? null,
        attachment: attachment?.payload ?? null,
      });
      retryKeyRef.current = null;
      // A retry after a lost response replays the original message, and the
      // background poll may already have picked it up — appending blindly would
      // show it twice.
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      );
      setDraft('');
      setReplyTo(null);
      clearAttachment();
      scrollToNewest();

      // Keep the chat list's preview and ordering honest without a full reload.
      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChat.id
            ? { ...c, lastMessage: { text: message.text, date: message.date, outgoing: true } }
            : c,
        ),
      );
    } catch (err) {
      // The draft is deliberately left in the box so nothing typed is lost, and
      // retryKeyRef is deliberately kept so pressing send again is safe.
      const message = err instanceof Error ? err.message : 'تعذر إرسال الرسالة';
      if (isTransportError(err)) {
        toast.error(
          'الشبكة بطيئة ولم يصل تأكيد الإرسال. جارٍ تحديث المحادثة لعرض ما وصل فعلاً — الرسالة لن تتكرر.',
          { duration: 9000 },
        );
        // The reply was lost, so the only honest way to say what happened is to
        // ask Telegram again and show the real thread.
        getMessages(activeChat.id)
          .then(({ messages: fresh }) => {
            if (activeChatIdRef.current !== activeChat.id) return;
            setMessages(fresh);
            scrollToNewest();
          })
          .catch(() => {
            // Nothing further to offer; the draft is still in the box.
          });
      } else {
        toast.error(message, { duration: 8000 });
      }
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };

  const openChat = async (chat: TelegramChat) => {
    setActiveChat(chat);
    setMessages([]);
    setMessagesError(null);
    setDraft('');
    setReplyTo(null);
    clearAttachment();
    retryKeyRef.current = null;
    activeChatIdRef.current = chat.id;
    setLoadingMessages(true);
    try {
      const { messages } = await getMessages(chat.id);
      setMessages(messages);
      // Land at the newest message, the way a chat app does.
      scrollToNewest();

      // Opening a chat marks it read in Telegram itself, so the badge here and
      // the badge on the user's phone cannot drift apart.
      if (chat.unreadCount > 0) {
        readHistory(chat.id)
          .then(() =>
            setChats((prev) =>
              prev.map((c) => (c.id === chat.id ? { ...c, unreadCount: 0 } : c)),
            ),
          )
          .catch(() => {
            // Failing to clear the badge must not look like the chat failed to open.
          });
      }
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
      {/* Chat list — on a phone this is a separate screen from the thread, so
          opening a chat replaces it instead of pushing it far down the page. */}
      <div className={`lg:col-span-2 ${activeChat ? 'hidden lg:block' : 'block'}`}>
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
            <div className="divide-y divide-gray-200 max-h-[60dvh] lg:max-h-[62vh] overflow-y-auto">
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
      <div className={`lg:col-span-3 ${activeChat ? 'block' : 'hidden lg:block'}`}>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden lg:sticky lg:top-24">
          {!activeChat ? (
            <div className="py-20 text-center">
              <MessagesSquare className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">اختر محادثة لعرض رسائلها</p>
            </div>
          ) : (
            <>
              <div className="p-3 sm:p-4 border-b border-gray-200 flex items-center gap-2 sm:gap-3">
                <Button
                  onClick={() => setActiveChat(null)}
                  variant="ghost"
                  className="lg:hidden h-10 w-10 p-0 rounded-lg flex-shrink-0"
                  title="رجوع إلى المحادثات"
                >
                  <ArrowRight className="w-5 h-5" />
                </Button>
                <div className="w-10 h-10 rounded-full bg-gray-100 hidden sm:flex items-center justify-center flex-shrink-0">
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg h-10 flex items-center gap-2 flex-shrink-0"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span className="hidden sm:inline">Telegram</span>
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
                <div ref={threadRef} className="p-4 space-y-3 max-h-[58dvh] lg:max-h-[55vh] overflow-y-auto">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      // A shortcut for the mouse; the button below is the one
                      // that works on a touchscreen.
                      onDoubleClick={() => setReplyTo(message)}
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

                        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm">
                          {message.text || '—'}
                        </p>

                        <div
                          className={`flex items-center gap-2 mt-1 text-[11px] ${
                            message.outgoing ? 'text-blue-100' : 'text-gray-500'
                          }`}
                        >
                          {message.hasMedia && <Paperclip className="w-3 h-3" />}
                          <span>{shortTime(message.date)}</span>

                          {activeChat.type !== 'channel' && (
                            <button
                              onClick={() => setReplyTo(message)}
                              title="رد على هذه الرسالة"
                              aria-label={`رد على رسالة ${message.senderName}`}
                              // p-2 -m-1 keeps the icon small while giving the
                              // finger a target it can actually hit.
                              className={`ms-auto p-2 -m-1 rounded-lg transition-colors ${
                                message.outgoing
                                  ? 'text-blue-100 hover:bg-blue-500'
                                  : 'text-gray-500 hover:bg-gray-200'
                              }`}
                            >
                              <CornerUpLeft className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  <p className="text-center text-xs text-gray-400 pt-2">
                    آخر {messages.length} رسالة
                  </p>
                </div>
              )}

              {/* Composer */}
              <div className="border-t border-gray-200 p-3">
                {activeChat?.type === 'channel' ? (
                  <p className="text-xs text-gray-500 text-center py-2">
                    القنوات للقراءة فقط — لا يمكن الإرسال إليها إلا من مالكها.
                  </p>
                ) : (
                  <>
                    {replyTo && (
                      <div className="flex items-start gap-2 mb-2 bg-blue-50 border border-blue-200 rounded-xl p-2">
                        <CornerUpLeft className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-blue-800">
                            رد على {replyTo.senderName}
                          </p>
                          <p className="text-xs text-gray-600 truncate">
                            {replyTo.text || '[مرفق]'}
                          </p>
                        </div>
                        <button
                          onClick={() => setReplyTo(null)}
                          className="text-gray-400 hover:text-gray-700 flex-shrink-0"
                          title="إلغاء الرد"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {attachment && (
                      <div className="flex items-center gap-2 mb-2 bg-gray-50 border border-gray-200 rounded-xl p-2">
                        <ImageIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <p className="flex-1 min-w-0 truncate text-xs text-gray-700">
                          {attachment.file.name}
                          <span className="text-gray-400">
                            {' '}
                            ({Math.max(1, Math.round(attachment.file.size / 1024))} كيلوبايت)
                          </span>
                        </p>
                        <button
                          onClick={clearAttachment}
                          className="text-gray-400 hover:text-red-600 flex-shrink-0"
                          title="إزالة المرفق"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    <div className="flex items-end gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        onChange={(e) => void pickAttachment(e.target.files?.[0])}
                      />
                      <Button
                        onClick={() => fileInputRef.current?.click()}
                        variant="outline"
                        disabled={sending}
                        className="h-11 w-11 p-0 rounded-xl flex-shrink-0"
                        title="إرفاق صورة أو ملف"
                      >
                        <Paperclip className="w-4 h-4" />
                      </Button>
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                        onKeyDown={(e) => {
                          // Enter sends, Shift+Enter makes a new line — the
                          // convention in Telegram itself. Not on a phone,
                          // where Enter is the only way to start a new line and
                          // sending is what the button is for.
                          if (!isMobile && e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void send();
                          }
                        }}
                        placeholder="اكتب رسالة…"
                        rows={2}
                        disabled={sending}
                        className="rounded-xl border-gray-300 resize-none"
                      />
                      <Button
                        onClick={send}
                        disabled={sending || (!draft.trim() && !attachment)}
                        className="h-11 w-11 p-0 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex-shrink-0"
                        title="إرسال"
                      >
                        {sending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                    </div>

                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-[11px] text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                        تُرسَل فعلياً من حسابك
                        <span className="hidden sm:inline">
                          على Telegram · Enter للإرسال، Shift+Enter لسطر جديد
                        </span>
                      </p>
                      {draft.length > MAX_MESSAGE_LENGTH - 200 && (
                        <p className="text-[11px] text-gray-500" dir="ltr">
                          {draft.length} / {MAX_MESSAGE_LENGTH}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
