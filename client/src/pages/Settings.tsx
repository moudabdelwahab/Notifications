import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AutoReplyPanel from '@/components/AutoReplyPanel';
import { Loader2, ArrowRight, CheckCircle2, AlertCircle, MessageSquareReply } from 'lucide-react';
import { toast } from 'sonner';

interface UserSettings {
  telegram_api_id: string | null;
  telegram_api_hash: string | null;
  monitoring_enabled: boolean;
}

export default function Settings() {
  const { user, loading: authLoading } = useAuth();
  const { state: onboarding } = useOnboardingStatus(user?.id);
  const [, setLocation] = useLocation();
  const [settings, setSettings] = useState<UserSettings>({
    telegram_api_id: null,
    telegram_api_hash: null,
    monitoring_enabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      setLocation('/login');
    }
  }, [user, authLoading, setLocation]);

  useEffect(() => {
    if (user) {
      loadSettings();
    }
  }, [user]);

  const loadSettings = async () => {
    if (!user) return;

    try {
      const { data, error: fetchError } = await supabase
        .from('users')
        .select('telegram_api_id, telegram_api_hash, monitoring_enabled')
        .eq('id', user.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (data) {
        setSettings({
          telegram_api_id: data.telegram_api_id || '',
          telegram_api_hash: data.telegram_api_hash || '',
          monitoring_enabled: data.monitoring_enabled || false,
        });
      }
    } catch (err) {
      console.error('Error loading settings:', err);
      toast.error('خطأ في تحميل الإعدادات');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    try {
      setSaving(true);
      setError(null);

      const { error: updateError } = await supabase
        .from('users')
        .update({
          telegram_api_id: settings.telegram_api_id || null,
          telegram_api_hash: settings.telegram_api_hash || null,
          monitoring_enabled: settings.monitoring_enabled,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (updateError) throw updateError;

      toast.success('تم حفظ الإعدادات بنجاح');
      if (settings.monitoring_enabled) {
        toast.info('المراقبة مفعلة الآن. سيتم فحص الإشارات كل 5 دقائق.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطأ في حفظ الإعدادات';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleReconnect = () => {
    setLocation('/onboarding');
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="container max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            onClick={() => setLocation('/dashboard')}
            variant="ghost"
            className="rounded-lg"
          >
            <ArrowRight className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-bold text-gray-900 font-display">الإعدادات</h1>
        </div>
      </header>

      {/* Main Content */}
      <div className="container max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="space-y-8">
            {/* Telegram API Settings */}
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-6 font-display">
                بيانات Telegram API
              </h2>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-900">{error}</p>
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    API ID
                  </label>
                  <Input
                    type="text"
                    value={settings.telegram_api_id || ''}
                    onChange={(e) =>
                      setSettings({ ...settings, telegram_api_id: e.target.value })
                    }
                    placeholder="أدخل API ID"
                    className="h-12 rounded-xl border-gray-300"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    يمكنك الحصول على هذا من my.telegram.org
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    API Hash
                  </label>
                  <Input
                    type="text"
                    value={settings.telegram_api_hash || ''}
                    onChange={(e) =>
                      setSettings({ ...settings, telegram_api_hash: e.target.value })
                    }
                    placeholder="أدخل API Hash"
                    className="h-12 rounded-xl border-gray-300"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    احفظ هذا في مكان آمن، لا تشاركه مع أحد
                  </p>
                </div>
              </div>
            </div>

            {/* Monitoring Status */}
            <div className="pt-8 border-t border-gray-200">
              <h2 className="text-xl font-bold text-gray-900 mb-6 font-display">
                حالة المراقبة
              </h2>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200 mb-6">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${settings.monitoring_enabled ? 'bg-green-100' : 'bg-gray-200'}`}>
                    <CheckCircle2 className={`w-5 h-5 ${settings.monitoring_enabled ? 'text-green-600' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">تفعيل المراقبة التلقائية</p>
                    <p className="text-sm text-gray-600">فحص الإشارات والردود كل 5 دقائق</p>
                  </div>
                </div>
                <button
                  onClick={() => setSettings({ ...settings, monitoring_enabled: !settings.monitoring_enabled })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                    settings.monitoring_enabled ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.monitoring_enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div
                className={`flex items-center justify-between p-4 rounded-xl border ${
                  onboarding === 'complete'
                    ? 'bg-blue-50 border-blue-100'
                    : 'bg-amber-50 border-amber-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      onboarding === 'complete' ? 'bg-blue-100' : 'bg-amber-100'
                    }`}
                  >
                    <AlertCircle
                      className={`w-5 h-5 ${
                        onboarding === 'complete' ? 'text-blue-600' : 'text-amber-600'
                      }`}
                    />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">حساب Telegram</p>
                    <p className="text-sm text-gray-600">
                      {onboarding === 'loading'
                        ? 'جاري التحقق من حالة الاتصال...'
                        : onboarding === 'complete'
                          ? 'متصل وجاهز للمراقبة'
                          : 'غير متصل — أكمل الإعداد لبدء المراقبة'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg bg-white"
                  onClick={handleReconnect}
                >
                  {onboarding === 'complete' ? 'إعادة الاتصال' : 'إكمال الإعداد'}
                </Button>
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-8 border-t border-gray-200 flex gap-3">
              <Button
                onClick={() => setLocation('/dashboard')}
                variant="outline"
                className="flex-1 h-12 rounded-xl"
              >
                إلغاء
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    جاري الحفظ...
                  </>
                ) : (
                  'حفظ التغييرات'
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Scheduled auto-replies */}
        <div className="mt-8 bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6 font-display flex items-center gap-2">
            <MessageSquareReply className="w-5 h-5 text-blue-600" />
            الرد الآلي المجدول
          </h2>
          <AutoReplyPanel userId={user?.id} />
        </div>

        {/* Help Section */}
        <div className="mt-8 bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h3 className="text-lg font-bold text-gray-900 mb-4 font-display">
            هل تحتاج إلى مساعدة؟
          </h3>
          <p className="text-gray-600 mb-4">
            للحصول على API ID و API Hash:
          </p>
          <ol className="space-y-3 text-sm text-gray-600">
            <li className="flex gap-3">
              <span className="font-semibold text-gray-900 flex-shrink-0">1.</span>
              <span>انتقل إلى <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">my.telegram.org</a></span>
            </li>
            <li className="flex gap-3">
              <span className="font-semibold text-gray-900 flex-shrink-0">2.</span>
              <span>قم بتسجيل الدخول برقم هاتفك</span>
            </li>
            <li className="flex gap-3">
              <span className="font-semibold text-gray-900 flex-shrink-0">3.</span>
              <span>انقر على "API development tools"</span>
            </li>
            <li className="flex gap-3">
              <span className="font-semibold text-gray-900 flex-shrink-0">4.</span>
              <span>أنشئ تطبيقاً جديداً وانسخ البيانات</span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
