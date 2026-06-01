import { useAuth } from '@/hooks/useAuth';
import { useLocation } from 'wouter';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Bell, MessageSquare, Mail } from 'lucide-react';

export default function Login() {
  const { user, loading, signInWithGoogle } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) {
      setLocation('/dashboard');
    }
  }, [user, setLocation]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50 to-white flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-100 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Bell className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2 font-display">
            Telegram Notifier
          </h1>
          <p className="text-gray-600 text-lg">
            مراقب إشارات تيليجرام الذكي
          </p>
        </div>

        {/* Features */}
        <div className="bg-white rounded-2xl shadow-lg p-8 mb-8 border border-gray-100">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                <MessageSquare className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">مراقبة الإشارات</h3>
                <p className="text-sm text-gray-600">تابع جميع الإشارات والردود على رسائلك</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                <Mail className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">إشعارات فورية</h3>
                <p className="text-sm text-gray-600">استقبل إشعارات بالبريد الإلكتروني فوراً</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                <Bell className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">لوحة تحكم سهلة</h3>
                <p className="text-sm text-gray-600">عرض وإدارة جميع الإشعارات من مكان واحد</p>
              </div>
            </div>
          </div>
        </div>

        {/* Login Button */}
        <Button
          onClick={signInWithGoogle}
          disabled={loading}
          className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2 mb-4"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              جاري تسجيل الدخول...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              تسجيل الدخول مع Google
            </>
          )}
        </Button>

        {/* Footer */}
        <p className="text-center text-sm text-gray-600">
          بتسجيل الدخول، أنت توافق على
          <br />
          <a href="#" className="text-blue-600 hover:text-blue-700 font-medium">شروط الخدمة</a>
          {' و '}
          <a href="#" className="text-blue-600 hover:text-blue-700 font-medium">سياسة الخصوصية</a>
        </p>
      </div>

      <style>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
      `}</style>
    </div>
  );
}
