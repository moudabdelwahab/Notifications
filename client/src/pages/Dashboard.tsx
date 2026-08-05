import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useNextScanCountdown } from '@/hooks/useNextScanCountdown';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import NotificationDetailDialog, {
  type NotificationDetail,
} from '@/components/NotificationDetailDialog';
import MonitoredChatsPanel from '@/components/MonitoredChatsPanel';
import KeywordsPanel from '@/components/KeywordsPanel';
import SessionStatusBanner from '@/components/SessionStatusBanner';
import { Input } from '@/components/ui/input';
import {
  Loader2,
  Bell,
  Settings,
  LogOut,
  Clock,
  RefreshCw,
  Users,
  Radio,
  User as UserIcon,
  AtSign,
  CornerUpLeft,
  Tag,
  CheckCheck,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';

interface Notification extends NotificationDetail {
  read: boolean;
}

const CHAT_KIND_ICON = {
  group: Users,
  channel: Radio,
  private: UserIcon,
} as const;

const TYPE_STYLE = {
  mention: { label: 'إشارة', Icon: AtSign, bg: 'bg-blue-100', fg: 'text-blue-600' },
  reply: { label: 'رد', Icon: CornerUpLeft, bg: 'bg-green-100', fg: 'text-green-600' },
  keyword: { label: 'كلمة مفتاحية', Icon: Tag, bg: 'bg-amber-100', fg: 'text-amber-600' },
} as const;

type TypeFilter = 'all' | 'mention' | 'reply' | 'keyword';

export default function Dashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { state: onboarding } = useOnboardingStatus(user?.id);
  const [, setLocation] = useLocation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selected, setSelected] = useState<Notification | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');
  const [markingAll, setMarkingAll] = useState(false);
  const nextScan = useNextScanCountdown(() => {
    // A scheduled scan just landed; pull anything realtime may have missed.
    void loadNotifications();
  });

  useEffect(() => {
    if (!authLoading && !user) {
      setLocation('/login');
    }
  }, [user, authLoading, setLocation]);

  // The dashboard is meaningless without a linked Telegram account.
  useEffect(() => {
    if (user && onboarding === 'incomplete') {
      setLocation('/onboarding');
    }
  }, [user, onboarding, setLocation]);

  useEffect(() => {
    if (user) {
      loadNotifications();
      loadUserSettings();

      // Subscribe to realtime notifications
      const channel = supabase
        .channel('notifications-changes')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            console.log('New notification received:', payload);
            const newNotification = payload.new as Notification;
            setNotifications((prev) => [newNotification, ...prev]);
            toast.info(`إشعار جديد من ${newNotification.sender_name}`);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const loadNotifications = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error('Error loading notifications:', err);
      toast.error('خطأ في تحميل الإشعارات');
    } finally {
      setLoading(false);
    }
  };

  const loadUserSettings = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('users')
        .select('monitoring_enabled')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;
      setMonitoringEnabled(data?.monitoring_enabled || false);
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  };

  const toggleMonitoring = async () => {
    if (!user) return;

    try {
      const newState = !monitoringEnabled;
      const { error } = await supabase
        .from('users')
        .update({ monitoring_enabled: newState })
        .eq('id', user.id);

      if (error) throw error;
      setMonitoringEnabled(newState);
      toast.success(newState ? 'تم تفعيل المراقبة' : 'تم تعطيل المراقبة');
    } catch (err) {
      toast.error('خطأ في تحديث الإعدادات');
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;

    setMarkingAll(true);
    // Scope the update to the unread rows so it does not rewrite the whole table.
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
    setMarkingAll(false);

    if (error) {
      toast.error('تعذر تعليم الإشعارات كمقروءة');
      return;
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    toast.success(`تم تعليم ${unread.length} إشعاراً كمقروء`);
  };

  const handleLogout = async () => {
    await signOut();
    setLocation('/login');
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(notifications.map(n =>
        n.id === notificationId ? { ...n, read: true } : n
      ));
    } catch (err) {
      toast.error('خطأ في تحديث الإشعار');
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  const needle = query.trim().toLowerCase();
  const visibleNotifications = notifications.filter((n) => {
    if (typeFilter !== 'all' && n.type !== typeFilter) return false;
    if (!needle) return true;
    return [n.message_text, n.sender_name, n.chat_title, n.matched_keyword]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle));
  });

  const typeCounts = {
    all: notifications.length,
    mention: notifications.filter((n) => n.type === 'mention').length,
    reply: notifications.filter((n) => n.type === 'reply').length,
    keyword: notifications.filter((n) => n.type === 'keyword').length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <Bell className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 font-display">Telegram Notifier</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-gray-600">مرحباً</p>
              <p className="font-semibold text-gray-900">{user?.email}</p>
            </div>
            <Button
              onClick={handleLogout}
              variant="outline"
              className="rounded-lg flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              تسجيل الخروج
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container max-w-6xl mx-auto px-4 py-8">
        <SessionStatusBanner userId={user?.id} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            {/* Status Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4 font-display">الحالة</h2>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">المراقبة</span>
                  <Switch
                    checked={monitoringEnabled}
                    onCheckedChange={toggleMonitoring}
                  />
                </div>

                <div className="pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-gray-600">الفحص التالي بعد</p>
                    <button
                      onClick={loadNotifications}
                      title="تحديث الآن"
                      className="text-gray-400 hover:text-blue-600 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-3xl font-bold text-gray-900 tabular-nums" dir="ltr">
                    {nextScan.label}
                  </p>
                  <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-[width] duration-1000 ease-linear"
                      style={{ width: `${nextScan.progress * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {monitoringEnabled
                      ? 'قد يتأخر التشغيل المجدول على GitHub بضع دقائق عند الضغط'
                      : 'المراقبة متوقفة — فعّلها ليبدأ الفحص'}
                  </p>
                </div>

                <div className="pt-4 border-t border-gray-200">
                  <p className="text-sm text-gray-600 mb-2">الإشعارات غير المقروءة</p>
                  <p className="text-3xl font-bold text-blue-600">{unreadCount}</p>
                </div>

                <div className="pt-4 border-t border-gray-200">
                  <p className="text-sm text-gray-600 mb-2">إجمالي الإشعارات</p>
                  <p className="text-3xl font-bold text-gray-900">{notifications.length}</p>
                </div>
              </div>
            </div>

            {/* Settings Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4 font-display flex items-center gap-2">
                <Settings className="w-5 h-5" />
                الإعدادات
              </h2>

              <Button
                onClick={() => setShowSettings(!showSettings)}
                className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
              >
                {showSettings ? 'إخفاء الإعدادات' : 'عرض الإعدادات'}
              </Button>

              {showSettings && (
                <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                  <Button
                    onClick={() => setLocation('/onboarding')}
                    variant="outline"
                    className="w-full h-10 rounded-lg"
                  >
                    تحديث بيانات Telegram
                  </Button>
                  <Button
                    onClick={() => setLocation('/settings')}
                    variant="outline"
                    className="w-full h-10 rounded-lg"
                  >
                    إعدادات متقدمة
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-2">
            {/* Notifications List */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-6 border-b border-gray-200 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h2 className="text-lg font-bold text-gray-900 font-display">
                    الإشعارات الأخيرة
                  </h2>
                  <Button
                    onClick={markAllAsRead}
                    disabled={markingAll || unreadCount === 0}
                    variant="outline"
                    size="sm"
                    className="rounded-lg flex items-center gap-2"
                  >
                    {markingAll ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCheck className="w-4 h-4" />
                    )}
                    تعليم الكل كمقروء
                  </Button>
                </div>

                {notifications.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ['all', `الكل (${typeCounts.all})`],
                          ['mention', `الإشارات (${typeCounts.mention})`],
                          ['reply', `الردود (${typeCounts.reply})`],
                          ['keyword', `الكلمات المفتاحية (${typeCounts.keyword})`],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setTypeFilter(value)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            typeFilter === value
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="relative">
                      <Search className="w-4 h-4 text-gray-400 absolute top-1/2 -translate-y-1/2 right-3" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="ابحث في نص الرسالة أو المُرسِل أو المحادثة"
                        className="h-11 rounded-xl border-gray-300 pr-10"
                      />
                    </div>
                  </>
                )}
              </div>

              {notifications.length === 0 ? (
                <div className="p-12 text-center">
                  <Bell className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600 mb-2">لا توجد إشعارات حتى الآن</p>
                  <p className="text-sm text-gray-500">
                    ستظهر الإشعارات هنا عند اكتشاف إشارات أو ردود جديدة
                  </p>
                </div>
              ) : visibleNotifications.length === 0 ? (
                <div className="p-12 text-center">
                  <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600 mb-2">لا توجد نتائج مطابقة</p>
                  <p className="text-sm text-gray-500">جرّب تغيير البحث أو التصفية</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {visibleNotifications.map((notification) => {
                    const style = TYPE_STYLE[notification.type];
                    const TypeIcon = style.Icon;
                    return (
                    <div
                      key={notification.id}
                      className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                        !notification.read ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => {
                        setSelected(notification);
                        if (!notification.read) markAsRead(notification.id);
                      }}
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0">
                          <div
                            className={`w-10 h-10 ${style.bg} rounded-full flex items-center justify-center`}
                          >
                            <TypeIcon className={`w-5 h-5 ${style.fg}`} />
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <p className="font-semibold text-gray-900">
                              {notification.sender_name}
                            </p>
                            {!notification.read && (
                              <span className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0"></span>
                            )}
                          </div>

                          <p className="text-sm text-gray-600 mb-2 flex items-center gap-1.5">
                            <span className={`${style.fg} font-medium`}>{style.label}</span>
                            في
                            {(() => {
                              const KindIcon = notification.chat_type
                                ? CHAT_KIND_ICON[notification.chat_type]
                                : null;
                              return KindIcon ? (
                                <KindIcon className="w-3.5 h-3.5 text-gray-400" />
                              ) : null;
                            })()}
                            <strong className="truncate">
                              {notification.chat_title ?? 'محادثة غير معروفة'}
                            </strong>
                          </p>

                          {notification.matched_keyword && (
                            <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 mb-2">
                              <Tag className="w-3 h-3" />
                              {notification.matched_keyword}
                            </span>
                          )}

                          <p className="text-sm text-gray-700 line-clamp-2 mb-2">
                            {notification.message_text}
                          </p>

                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="w-3 h-3" />
                            {new Date(notification.created_at).toLocaleString('ar-EG')}
                          </div>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Keywords */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mt-8">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-900 font-display flex items-center gap-2">
                  <Tag className="w-5 h-5 text-amber-600" />
                  الكلمات المفتاحية
                </h2>
              </div>
              <div className="p-6">
                <KeywordsPanel userId={user?.id} />
              </div>
            </div>

            {/* Which chats to watch */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mt-8">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-900 font-display flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  المحادثات المراقَبة
                </h2>
              </div>
              <div className="p-6">
                <MonitoredChatsPanel userId={user?.id} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <NotificationDetailDialog
        notification={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
