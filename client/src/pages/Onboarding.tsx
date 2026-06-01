import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

type OnboardingStep = 'welcome' | 'telegram-setup' | 'credentials' | 'complete';

export default function Onboarding() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      setLocation('/login');
    }
  }, [user, authLoading, setLocation]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const handleSaveCredentials = async () => {
    if (!apiId.trim() || !apiHash.trim()) {
      setError('يرجى إدخال API ID و API Hash');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { error: updateError } = await supabase
        .from('users')
        .update({
          telegram_api_id: apiId,
          telegram_api_hash: apiHash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user?.id);

      if (updateError) throw updateError;

      toast.success('تم حفظ بيانات Telegram بنجاح');
      setStep('complete');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطأ في حفظ البيانات';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = () => {
    setLocation('/dashboard');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50 to-white">
      <div className="container max-w-2xl mx-auto py-12 px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2 font-display">
            إعداد Telegram Notifier
          </h1>
          <p className="text-gray-600">
            اتبع الخطوات البسيطة لبدء مراقبة إشاراتك
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex justify-between mb-12">
          {(['welcome', 'telegram-setup', 'credentials', 'complete'] as const).map((s, i) => (
            <div key={s} className="flex-1 flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all ${
                  step === s || (step === 'complete' && i < 3)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {i + 1}
              </div>
              {i < 3 && (
                <div
                  className={`flex-1 h-1 mx-2 transition-all ${
                    step === 'complete' || (step !== 'welcome' && i < 2)
                      ? 'bg-blue-600'
                      : 'bg-gray-200'
                  }`}
                ></div>
              )}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
          {step === 'welcome' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 font-display">
                  مرحباً بك!
                </h2>
                <p className="text-gray-600">
                  سنساعدك في إعداد تطبيق Telegram لمراقبة الإشارات والردود. العملية بسيطة وتستغرق بضع دقائق فقط.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-sm text-blue-900">
                  <strong>ملاحظة:</strong> ستحتاج إلى حساب Telegram نشط وبريد إلكتروني Google للمتابعة.
                </p>
              </div>

              <Button
                onClick={() => setStep('telegram-setup')}
                className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl"
              >
                ابدأ الآن
              </Button>
            </div>
          )}

          {step === 'telegram-setup' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 font-display">
                  إنشاء تطبيق Telegram
                </h2>
                <p className="text-gray-600 mb-4">
                  اتبع هذه الخطوات لإنشاء تطبيق Telegram والحصول على بيانات المصادقة:
                </p>

                <ol className="space-y-4">
                  <li className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold">
                      1
                    </span>
                    <div>
                      <p className="font-semibold text-gray-900">انتقل إلى my.telegram.org</p>
                      <p className="text-sm text-gray-600">
                        افتح الموقع في متصفح جديد واتبع التعليمات
                      </p>
                    </div>
                  </li>

                  <li className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold">
                      2
                    </span>
                    <div>
                      <p className="font-semibold text-gray-900">قم بتسجيل الدخول برقم هاتفك</p>
                      <p className="text-sm text-gray-600">
                        استخدم نفس رقم الهاتف المرتبط بحسابك على Telegram
                      </p>
                    </div>
                  </li>

                  <li className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold">
                      3
                    </span>
                    <div>
                      <p className="font-semibold text-gray-900">انقر على "API development tools"</p>
                      <p className="text-sm text-gray-600">
                        ستجد هذا الخيار في القائمة الرئيسية
                      </p>
                    </div>
                  </li>

                  <li className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold">
                      4
                    </span>
                    <div>
                      <p className="font-semibold text-gray-900">أنشئ تطبيقاً جديداً</p>
                      <p className="text-sm text-gray-600">
                        ملأ النموذج وسيحصل على API ID و API Hash
                      </p>
                    </div>
                  </li>

                  <li className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold">
                      5
                    </span>
                    <div>
                      <p className="font-semibold text-gray-900">انسخ البيانات وعد هنا</p>
                      <p className="text-sm text-gray-600">
                        ستحتاج إلى API ID و API Hash في الخطوة التالية
                      </p>
                    </div>
                  </li>
                </ol>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={() => setStep('welcome')}
                  variant="outline"
                  className="flex-1 h-12 rounded-xl"
                >
                  رجوع
                </Button>
                <a
                  href="https://my.telegram.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1"
                >
                  <Button
                    className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
                  >
                    افتح my.telegram.org
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </a>
              </div>

              <Button
                onClick={() => setStep('credentials')}
                className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl"
              >
                لقد حصلت على البيانات
              </Button>
            </div>
          )}

          {step === 'credentials' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 font-display">
                  أدخل بيانات Telegram
                </h2>
                <p className="text-gray-600 mb-4">
                  الصق API ID و API Hash اللذين حصلت عليهما من my.telegram.org
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-900">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  API ID
                </label>
                <Input
                  type="text"
                  value={apiId}
                  onChange={(e) => setApiId(e.target.value)}
                  placeholder="مثال: 1234567"
                  className="h-12 rounded-xl border-gray-300"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  API Hash
                </label>
                <Input
                  type="text"
                  value={apiHash}
                  onChange={(e) => setApiHash(e.target.value)}
                  placeholder="مثال: abcdef1234567890abcdef1234567890"
                  className="h-12 rounded-xl border-gray-300"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={() => setStep('telegram-setup')}
                  variant="outline"
                  className="flex-1 h-12 rounded-xl"
                  disabled={loading}
                >
                  رجوع
                </Button>
                <Button
                  onClick={handleSaveCredentials}
                  disabled={loading}
                  className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      جاري الحفظ...
                    </>
                  ) : (
                    'حفظ البيانات'
                  )}
                </Button>
              </div>
            </div>
          )}

          {step === 'complete' && (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 font-display">
                  تم الإعداد بنجاح!
                </h2>
                <p className="text-gray-600">
                  تم ربط حسابك على Telegram بنجاح. يمكنك الآن البدء في مراقبة الإشارات والردود.
                </p>
              </div>

              <Button
                onClick={handleComplete}
                className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl"
              >
                انتقل إلى لوحة التحكم
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
