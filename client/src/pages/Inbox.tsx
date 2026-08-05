import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NotificationDetailBody,
  NotificationDetailHeading,
  type NotificationDetail,
} from '@/components/NotificationDetailDialog';
import {
  Loader2,
  Inbox as InboxIcon,
  Search,
  CheckCheck,
  Trash2,
  MailOpen,
  Mail,
  ArrowRight,
  AtSign,
  CornerUpLeft,
  Tag,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

interface Notification extends NotificationDetail {
  read: boolean;
}

const TYPE_STYLE = {
  mention: { label: 'إشارة', Icon: AtSign, bg: 'bg-blue-100', fg: 'text-blue-600' },
  reply: { label: 'رد', Icon: CornerUpLeft, bg: 'bg-green-100', fg: 'text-green-600' },
  keyword: { label: 'كلمة مفتاحية', Icon: Tag, bg: 'bg-amber-100', fg: 'text-amber-600' },
} as const;

const PAGE_SIZE = 25;

type TypeFilter = 'all' | 'mention' | 'reply' | 'keyword';
type ReadFilter = 'all' | 'unread' | 'read';

export default function Inbox() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) setLocation('/login');
  }, [user, authLoading, setLocation]);

  const load = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('[inbox] load failed:', error);
      toast.error('تعذر تحميل الإشعارات');
    }
    setNotifications(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    void load();

    const channel = supabase
      .channel('inbox-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => setNotifications((prev) => [payload.new as Notification, ...prev]),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return notifications.filter((n) => {
      if (typeFilter !== 'all' && n.type !== typeFilter) return false;
      if (readFilter === 'unread' && n.read) return false;
      if (readFilter === 'read' && !n.read) return false;
      if (!needle) return true;
      return [n.message_text, n.sender_name, n.chat_title, n.matched_keyword]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [notifications, typeFilter, readFilter, query]);

  useEffect(() => setPage(1), [typeFilter, readFilter, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selected = notifications.find((n) => n.id === selectedId) ?? null;
  const unreadCount = notifications.filter((n) => !n.read).length;

  const counts = {
    all: notifications.length,
    mention: notifications.filter((n) => n.type === 'mention').length,
    reply: notifications.filter((n) => n.type === 'reply').length,
    keyword: notifications.filter((n) => n.type === 'keyword').length,
  };

  const setRead = async (notification: Notification, read: boolean) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, read } : n)),
    );
    const { error } = await supabase
      .from('notifications')
      .update({ read })
      .eq('id', notification.id);
    if (error) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: !read } : n)),
      );
      toast.error('تعذر تحديث حالة الإشعار');
    }
  };

  const open = (notification: Notification) => {
    setSelectedId(notification.id);
    if (!notification.read) void setRead(notification, true);
  };

  const markAllRead = async () => {
    if (!user || unreadCount === 0) return;
    setBusy(true);
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
    setBusy(false);

    if (error) {
      toast.error('تعذر تعليم الإشعارات كمقروءة');
      return;
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    toast.success(`تم تعليم ${unreadCount} إشعاراً كمقروء`);
  };

  const remove = async (notification: Notification) => {
    const previous = notifications;
    setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    if (selectedId === notification.id) setSelectedId(null);

    const { error } = await supabase.from('notifications').delete().eq('id', notification.id);
    if (error) {
      setNotifications(previous);
      toast.error('تعذر حذف الإشعار');
      return;
    }
    toast.success('تم حذف الإشعار');
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="container max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            onClick={() => setLocation('/dashboard')}
            variant="ghost"
            className="rounded-lg"
            title="رجوع إلى لوحة التحكم"
          >
            <ArrowRight className="w-5 h-5" />
          </Button>

          <div className="flex items-center gap-2 flex-1">
            <InboxIcon className="w-6 h-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900 font-display">صندوق الوارد</h1>
            {unreadCount > 0 && (
              <span className="bg-blue-600 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {unreadCount}
              </span>
            )}
          </div>

          <Button onClick={load} variant="outline" size="sm" className="rounded-lg" title="تحديث">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button
            onClick={markAllRead}
            disabled={busy || unreadCount === 0}
            variant="outline"
            size="sm"
            className="rounded-lg flex items-center gap-2"
          >
            <CheckCheck className="w-4 h-4" />
            تعليم الكل كمقروء
          </Button>
        </div>
      </header>

      <div className="container max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* List */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-200 space-y-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute top-1/2 -translate-y-1/2 right-3" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ابحث في الإشعارات"
                    className="h-10 rounded-xl border-gray-300 pr-10"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['all', `الكل (${counts.all})`],
                      ['mention', `إشارات (${counts.mention})`],
                      ['reply', `ردود (${counts.reply})`],
                      ['keyword', `كلمات (${counts.keyword})`],
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

                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['all', 'الكل'],
                      ['unread', `غير المقروءة (${unreadCount})`],
                      ['read', 'المقروءة'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setReadFilter(value)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        readFilter === value
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="p-10 text-center">
                  <InboxIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-600">
                    {notifications.length === 0
                      ? 'صندوق الوارد فارغ'
                      : 'لا توجد نتائج مطابقة'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200 max-h-[60vh] overflow-y-auto">
                  {visible.map((notification) => {
                    const style = TYPE_STYLE[notification.type];
                    const TypeIcon = style.Icon;
                    const isSelected = notification.id === selectedId;
                    return (
                      <button
                        key={notification.id}
                        onClick={() => open(notification)}
                        className={`w-full text-right p-3 transition-colors flex items-start gap-3 ${
                          isSelected
                            ? 'bg-blue-50 border-r-4 border-blue-600'
                            : notification.read
                              ? 'hover:bg-gray-50'
                              : 'bg-blue-50/50 hover:bg-blue-50'
                        }`}
                      >
                        <div
                          className={`w-9 h-9 ${style.bg} rounded-full flex items-center justify-center flex-shrink-0`}
                        >
                          <TypeIcon className={`w-4 h-4 ${style.fg}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p
                              className={`truncate ${
                                notification.read
                                  ? 'text-gray-700 font-medium'
                                  : 'text-gray-900 font-bold'
                              }`}
                            >
                              {notification.sender_name}
                            </p>
                            {!notification.read && (
                              <span className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate mb-1">
                            {notification.chat_title ?? 'محادثة غير معروفة'}
                          </p>
                          <p className="text-sm text-gray-600 line-clamp-2">
                            {notification.message_text}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(notification.created_at).toLocaleString('ar-EG')}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {pageCount > 1 && (
                <div className="p-3 border-t border-gray-200 flex items-center justify-center gap-1" dir="ltr">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg h-8 px-2"
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    ‹
                  </Button>
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
                      className={`h-8 min-w-8 px-2 rounded-lg text-sm font-medium transition-colors ${
                        n === currentPage
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg h-8 px-2"
                    disabled={currentPage === pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    ›
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Reading pane */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 lg:sticky lg:top-24">
              {!selected ? (
                <div className="py-16 text-center">
                  <InboxIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600">اختر إشعاراً لعرض تفاصيله</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap pb-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900 font-display">
                      <NotificationDetailHeading notification={selected} />
                    </h2>

                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => setRead(selected, !selected.read)}
                        variant="outline"
                        size="sm"
                        className="rounded-lg flex items-center gap-2"
                      >
                        {selected.read ? (
                          <>
                            <Mail className="w-4 h-4" />
                            تعليم كغير مقروء
                          </>
                        ) : (
                          <>
                            <MailOpen className="w-4 h-4" />
                            تعليم كمقروء
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => remove(selected)}
                        variant="outline"
                        size="sm"
                        className="rounded-lg text-red-600 hover:text-red-700 hover:bg-red-50"
                        title="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  <NotificationDetailBody notification={selected} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
