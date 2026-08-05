import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  callTelegramAuth,
  type SendOtpResult,
  type VerifyOtpResult,
  type VerifyPasswordResult,
} from '@/lib/telegramAuth';
import { Loader2, ExternalLink, CheckCircle2, AlertCircle, Phone, Lock, Key } from 'lucide-react';
import { toast } from 'sonner';

const STEPS = [
  'welcome',
  'telegram-setup',
  'credentials',
  'phone-input',
  'otp-verify',
  'password-verify',
  'complete',
] as const;

type OnboardingStep = (typeof STEPS)[number];

/** Telegram sends 5-digit codes today, but the length is server-provided so we honour it. */
const DEFAULT_OTP_LENGTH = 5;

export default function Onboarding() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpLength, setOtpLength] = useState(DEFAULT_OTP_LENGTH);
  const [password, setPassword] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordHint, setPasswordHint] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      setLocation('/login');
    }
  }, [user, authLoading, setLocation]);

  // Prefill credentials the user already saved, so a reconnect does not start from scratch.
  useEffect(() => {
    if (!user) return;
    let active = true;

    supabase
      .from('users')
      .select('telegram_api_id, telegram_api_hash, telegram_phone')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        if (data.telegram_api_id) setApiId(data.telegram_api_id);
        if (data.telegram_api_hash) setApiHash(data.telegram_api_hash);
        if (data.telegram_phone) setPhone(data.telegram_phone);
      });

    return () => {
      active = false;
    };
  }, [user]);

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
    if (!/^\d+$/.test(apiId.trim())) {
      setError('API ID يجب أن يكون رقماً');
      return;
    }
    if (apiHash.trim().length < 32) {
      setError('API Hash يجب أن يكون على الأقل 32 حرفاً');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { error: updateError } = await supabase
        .from('users')
        .update({
          telegram_api_id: apiId.trim(),
          telegram_api_hash: apiHash.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user?.id);

      if (updateError) throw updateError;

      toast.success('تم حفظ بيانات API بنجاح');
      setStep('phone-input');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطأ في حفظ البيانات';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendOTP = async () => {
    if (!/^\+\d{10,15}$/.test(phone.trim())) {
      setError('يرجى إدخال رقم هاتف صحيح بصيغة دولية (مثل +966500000000)');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setOtp('');

      const data = await callTelegramAuth<SendOtpResult>({
        action: 'send-otp',
        phone: phone.trim(),
        apiId: apiId.trim(),
        apiHash: apiHash.trim(),
      });

      setSessionId(data.sessionId);
      setOtpLength(data.codeLength ?? DEFAULT_OTP_LENGTH);
      toast.success(
        data.codeType === 'sms'
          ? 'تم إرسال رمز التحقق برسالة نصية'
          : 'تم إرسال رمز التحقق إلى تطبيق Telegram',
      );
      setStep('otp-verify');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطأ في إرسال الرمز';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (otp.trim().length < otpLength) {
      setError('يرجى إدخال رمز التحقق الكامل');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const data = await callTelegramAuth<VerifyOtpResult>({
        action: 'verify-otp',
        sessionId,
        code: otp.trim(),
      });

      if (data.success) {
        toast.success('تم ربط حساب Telegram بنجاح');
        setStep('complete');
        return;
      }

      // Account is protected by Two-Step Verification.
      setPasswordHint(data.passwordHint);
      toast.info('حسابك محمي بالتحقق بخطوتين. أدخل كلمة المرور للمتابعة.');
      setStep('password-verify');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'رمز التحقق غير صحيح';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPassword = async () => {
    if (!password.trim()) {
      setError('يرجى إدخال كلمة المرور');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await callTelegramAuth<VerifyPasswordResult>({
        action: 'verify-password',
        sessionId,
        password,
      });

      toast.success('تم ربط حساب Telegram بنجاح');
      setStep('complete');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'كلمة المرور غير صحيحة';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  /** Abandons the current attempt and returns to the phone step for a fresh code. */
  const handleRestartVerification = () => {
    setOtp('');
    setPassword('');
    setError(null);
    setSessionId('');
    setPasswordHint(null);
    setStep('phone-input');
  };

  const currentIndex = STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50 to-white">
      <div className="container max-w-2xl mx-auto py-6 sm:py-12 px-4">
        <div className="text-center mb-6 sm:mb-12">
          <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-2 font-display">
            إعداد Telegram Notifier
          </h1>
          <p className="text-sm sm:text-base text-gray-600">
            اتبع الخطوات البسيطة لبدء مراقبة إشاراتك
          </p>
        </div>

        {/* Progress indicator.
            Seven numbered circles do not fit across a phone without either
            scrolling sideways or shrinking past legibility, so small screens get
            a single bar and a step count instead. */}
        <div className="mb-8 sm:mb-12">
          <div className="sm:hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-900">
                الخطوة {currentIndex + 1} من {STEPS.length}
              </span>
              <span className="text-xs text-gray-500">
                {Math.round(((currentIndex + 1) / STEPS.length) * 100)}%
              </span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${((currentIndex + 1) / STEPS.length) * 100}%` }}
              />
            </div>
          </div>

          <div className="hidden sm:flex justify-between">
            {STEPS.map((s, i) => (
              <div key={s} className="flex-1 flex items-center min-w-max">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                    i <= currentIndex ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-1 mx-1 transition-all min-w-[20px] ${
                      i < currentIndex ? 'bg-blue-600' : 'bg-gray-200'
                    }`}
                  ></div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-5 sm:p-8 border border-gray-100">
          {step === 'welcome' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 font-display">مرحباً بك!</h2>
                <p className="text-gray-600">
                  سنساعدك في إعداد تطبيق Telegram لمراقبة الإشارات والردود. العملية بسيطة وتستغرق بضع
                  دقائق فقط.
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
                  {[
                    ['انتقل إلى my.telegram.org', 'افتح الموقع في متصفح جديد واتبع التعليمات'],
                    ['قم بتسجيل الدخول برقم هاتفك', 'استخدم نفس رقم الهاتف المرتبط بحسابك على Telegram'],
                    ['انقر على "API development tools"', 'ستجد هذا الخيار في القائمة الرئيسية'],
                    ['أنشئ تطبيقاً جديداً', 'املأ النموذج وستحصل على API ID و API Hash'],
                    ['انسخ البيانات وعد هنا', 'ستحتاج إلى API ID و API Hash في الخطوة التالية'],
                  ].map(([title, detail], i) => (
                    <li key={title} className="flex gap-4">
                      <span className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold">
                        {i + 1}
                      </span>
                      <div>
                        <p className="font-semibold text-gray-900">{title}</p>
                        <p className="text-sm text-gray-600">{detail}</p>
                      </div>
                    </li>
                  ))}
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
                  <Button className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2">
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
                <label className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  API ID
                </label>
                <Input
                  type="text"
                  value={apiId}
                  onChange={(e) => setApiId(e.target.value)}
                  placeholder="مثال: 1234567"
                  className="h-12 rounded-xl border-gray-300"
                  disabled={loading}
                  dir="ltr"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  API Hash
                </label>
                <Input
                  type="password"
                  value={apiHash}
                  onChange={(e) => setApiHash(e.target.value)}
                  placeholder="مثال: abcdef1234567890abcdef1234567890"
                  className="h-12 rounded-xl border-gray-300"
                  disabled={loading}
                  dir="ltr"
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

          {step === 'phone-input' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 font-display">رقم الهاتف</h2>
                <p className="text-gray-600 mb-4">
                  أدخل رقم هاتفك المرتبط بحساب Telegram (بصيغة دولية، مثل +966500000000)
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-900">{error}</p>
                </div>
              )}

              <div>
                <label className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  رقم الهاتف
                </label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+966500000000"
                  className="h-12 rounded-xl border-gray-300"
                  disabled={loading}
                  dir="ltr"
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-sm text-blue-900">
                  <strong>تلميح:</strong> سيصلك الرمز داخل تطبيق Telegram نفسه، وليس كرسالة SMS.
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={() => setStep('credentials')}
                  variant="outline"
                  className="flex-1 h-12 rounded-xl"
                  disabled={loading}
                >
                  رجوع
                </Button>
                <Button
                  onClick={handleSendOTP}
                  disabled={loading || !phone.trim()}
                  className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      جاري الإرسال...
                    </>
                  ) : (
                    'إرسال الرمز'
                  )}
                </Button>
              </div>
            </div>
          )}

          {step === 'otp-verify' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 font-display">
                  التحقق من الرمز
                </h2>
                <p className="text-gray-600 mb-4">
                  أدخل الرمز المكوّن من {otpLength} أرقام الذي وصلك في تطبيق Telegram
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-900">{error}</p>
                </div>
              )}

              <div>
                <label className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  رمز التحقق
                </label>
                <div className="flex justify-center mb-6" dir="ltr">
                  <InputOTP maxLength={otpLength} value={otp} onChange={setOtp} disabled={loading}>
                    <InputOTPGroup>
                      {Array.from({ length: otpLength }, (_, i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-sm text-green-900">
                  <strong>تم إرسال الرمز:</strong> افتح تطبيق Telegram على أي جهاز آخر لتجد الرمز في
                  محادثة Telegram الرسمية.
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleRestartVerification}
                  variant="outline"
                  className="flex-1 h-12 rounded-xl"
                  disabled={loading}
                >
                  إرسال مرة أخرى
                </Button>
                <Button
                  onClick={handleVerifyOTP}
                  disabled={loading || otp.length < otpLength}
                  className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      جاري التحقق...
                    </>
                  ) : (
                    'تحقق وتأكيد'
                  )}
                </Button>
              </div>
            </div>
          )}

          {step === 'password-verify' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 font-display">
                  التحقق بخطوتين
                </h2>
                <p className="text-gray-600 mb-4">
                  حسابك محمي بكلمة مرور إضافية. يرجى إدخال كلمة المرور للمتابعة.
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-900">{error}</p>
                </div>
              )}

              {passwordHint && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-sm text-blue-900">
                    <strong>تلميح كلمة المرور من Telegram:</strong> {passwordHint}
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  كلمة المرور
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور"
                  className="h-12 rounded-xl border-gray-300"
                  disabled={loading}
                />
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleRestartVerification}
                  variant="outline"
                  className="flex-1 h-12 rounded-xl"
                  disabled={loading}
                >
                  البدء من جديد
                </Button>
                <Button
                  onClick={handleVerifyPassword}
                  disabled={loading || !password.trim()}
                  className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      جاري التحقق...
                    </>
                  ) : (
                    'تحقق من كلمة المرور'
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
                  تم ربط حسابك على Telegram بنجاح. سيبدأ النظام الآن بمراقبة الإشارات والردود كل 5
                  دقائق.
                </p>
              </div>

              <Button
                onClick={() => setLocation('/dashboard')}
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
