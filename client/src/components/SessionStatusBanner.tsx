import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

type SessionStatus = 'active' | 'expired' | 'invalid';

interface SessionHealth {
  status: SessionStatus;
  status_message: string | null;
  last_scanned_at: string | null;
}

/**
 * Warns when the Telegram session has stopped working.
 *
 * Without this the failure is completely silent: the worker logs the error, the
 * scheduled run still goes green, and the only symptom is notifications quietly
 * never arriving again.
 */
export default function SessionStatusBanner({ userId }: { userId: string | undefined }) {
  const [health, setHealth] = useState<SessionHealth | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!userId) return;
    let active = true;

    supabase
      .from('telegram_sessions')
      .select('status, status_message, last_scanned_at')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setHealth(data as SessionHealth | null);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  if (!health || health.status === 'active') return null;

  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
      <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
        <AlertTriangle className="w-5 h-5 text-red-600" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-red-900 mb-1">توقفت مراقبة حسابك</p>
        <p className="text-sm text-red-800">
          {health.status_message ?? 'جلسة Telegram لم تعد صالحة. أعد ربط حسابك للمتابعة.'}
        </p>
        {health.last_scanned_at && (
          <p className="text-xs text-red-700 mt-1">
            آخر فحص ناجح: {new Date(health.last_scanned_at).toLocaleString('ar-EG')}
          </p>
        )}
      </div>

      <Button
        onClick={() => setLocation('/onboarding')}
        className="bg-red-600 hover:bg-red-700 text-white rounded-lg flex-shrink-0"
      >
        أعد الربط
      </Button>
    </div>
  );
}
