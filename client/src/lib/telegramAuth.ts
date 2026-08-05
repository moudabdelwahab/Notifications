import { supabase } from '@/lib/supabase';

export interface SendOtpResult {
  success: true;
  sessionId: string;
  phoneCodeHash: string;
  /** Delivery channel Telegram used: 'app' | 'sms' | 'call' | … */
  codeType?: string;
  /** Number of digits in the code Telegram sent. */
  codeLength?: number;
  timeout?: number;
}

export type VerifyOtpResult =
  | { success: true; phone: string }
  | { success: false; requiresPassword: true; sessionId: string; passwordHint: string | null };

export interface VerifyPasswordResult {
  success: true;
  phone: string;
}

/**
 * Calls the `telegram-auth` Edge Function and surfaces the server's own error message.
 *
 * supabase-js rejects any non-2xx reply with a generic "non-2xx status code" message and
 * tucks the real body away in `error.context`, so unwrap that before giving up — otherwise
 * every Telegram error reaches the user as the same meaningless string.
 */
export async function callTelegramAuth<T>(body: Record<string, unknown>): Promise<T> {
  return callEdgeFunction<T>('telegram-auth', body);
}

/** Same unwrapping for any of the project's Edge Functions. */
export async function callEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === 'function') {
      const parsed = await response.json().catch(() => null);
      if (parsed?.error) throw new Error(String(parsed.error));
    }
    throw new Error(error.message || 'تعذر الاتصال بخدمة التحقق. حاول مرة أخرى.');
  }

  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String((data as { error: unknown }).error));
  }

  return data as T;
}

/**
 * True once the user has a stored Telegram session — the single source of truth for
 * "onboarding finished", since that session is exactly what the monitoring worker needs.
 */
export async function hasTelegramSession(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('telegram_sessions')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[onboarding] Failed to read telegram session:', error);
    return false;
  }
  return Boolean(data);
}
