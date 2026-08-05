import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Loader2, Bell, Settings, LogOut, MessageSquare, Clock, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface Notification {
  id: string;
  type: 'mention' | 'reply';
  source: string;
  message_text: string;
  sender_name: string;
  created_at: string;
  read: boolean;
}

export default function Dashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { state: onboarding } = useOnboardingStatus(user?.id);
  const [, setLocation] = useLocation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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

  const unreadCount = notifications.filter(n => !n.read).length;

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
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-900 font-display">الإشعارات الأخيرة</h2>
              </div>

              {notifications.length === 0 ? (
                <div className="p-12 text-center">
                  <Bell className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600 mb-2">لا توجد إشعارات حتى الآن</p>
                  <p className="text-sm text-gray-500">
                    ستظهر الإشعارات هنا عند اكتشاف إشارات أو ردود جديدة
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                        !notification.read ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => markAsRead(notification.id)}
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0">
                          {notification.type === 'mention' ? (
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                              <MessageSquare className="w-5 h-5 text-blue-600" />
                            </div>
                          ) : (
                            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                              <CheckCircle2 className="w-5 h-5 text-green-600" />
                            </div>
                          )}
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

                          <p className="text-sm text-gray-600 mb-2">
                            {notification.type === 'mention' ? 'إشارة في' : 'رد في'} <strong>{notification.source}</strong>
                          </p>

                          <p className="text-sm text-gray-700 line-clamp-2 mb-2">
                            {notification.message_text}
                          </p>

                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="w-3 h-3" />
                            {new Date(notification.created_at).toLocaleString('ar-SA')}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
