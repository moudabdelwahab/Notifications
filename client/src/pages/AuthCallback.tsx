import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

/**
 * AuthCallback Component
 * Handles the OAuth callback from Supabase after Google login
 * Processes the session and redirects to dashboard on success
 */
export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get the current session from Supabase
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (session?.user) {
          // Session is valid, redirect to dashboard
          setLocation('/dashboard');
        } else {
          // No session found, redirect back to login
          setError('فشل تسجيل الدخول. يرجى المحاولة مرة أخرى.');
          setTimeout(() => {
            setLocation('/login');
          }, 2000);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'حدث خطأ أثناء معالجة تسجيل الدخول';
        setError(message);
        console.error('Auth callback error:', err);
        
        // Redirect to login after showing error
        setTimeout(() => {
          setLocation('/login');
        }, 2000);
      } finally {
        setIsProcessing(false);
      }
    };

    handleCallback();
  }, [setLocation]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50 to-white flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-100 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
      </div>

      <div className="relative z-10 w-full max-w-md text-center">
        {isProcessing ? (
          <>
            <div className="flex justify-center mb-6">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">جاري تسجيل الدخول...</h2>
            <p className="text-gray-600">يرجى الانتظار أثناء معالجة بيانات تسجيل الدخول</p>
          </>
        ) : error ? (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <span className="text-2xl text-red-600">✕</span>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">خطأ في تسجيل الدخول</h2>
            <p className="text-red-600 mb-4">{error}</p>
            <p className="text-gray-600 text-sm">جاري إعادة التوجيه إلى صفحة تسجيل الدخول...</p>
          </>
        ) : (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <span className="text-2xl text-green-600">✓</span>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">تم تسجيل الدخول بنجاح</h2>
            <p className="text-gray-600">جاري إعادة التوجيه إلى لوحة التحكم...</p>
          </>
        )}
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
