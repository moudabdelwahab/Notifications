import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

const POLL_MS = 60_000;

/** Past this, a scan is overdue rather than merely slow. */
const LATE_AFTER_MINUTES = 90;
/** Past this, the schedule has almost certainly stopped rather than slipped. */
const STALLED_AFTER_MINUTES = 180;

export type ScanState = 'unknown' | 'fresh' | 'late' | 'stalled';

export interface LastScan {
  lastScannedAt: string | null;
  /** Whole minutes since the last successful scan, or null if there has never been one. */
  minutesAgo: number | null;
  state: ScanState;
  /** Ready-to-render Arabic phrasing for `minutesAgo`. */
  label: string;
}

function describe(minutes: number): string {
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `من ${minutes} دقيقة`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `من ${hours} ساعة` : `من ${hours} ساعة و${rest} دقيقة`;
  }

  const days = Math.floor(hours / 24);
  return `من ${days} يوم`;
}

function stateFor(minutes: number): ScanState {
  if (minutes >= STALLED_AFTER_MINUTES) return 'stalled';
  if (minutes >= LATE_AFTER_MINUTES) return 'late';
  return 'fresh';
}

/**
 * Reports when the monitor worker last actually scanned this account.
 *
 * This replaces a countdown to the workflow's five-minute cron, which was
 * fiction: GitHub throttles scheduled runs on a quiet repository, and over 24
 * measured runs the real gap between scans was 51 minutes at best and 73 on
 * average. The timer therefore reached zero roughly fourteen times per actual
 * scan, and the refresh it triggered each time found nothing new.
 *
 * `onScanLanded` fires when `last_scanned_at` genuinely moves, so the caller
 * refreshes on a real event instead of on a guess.
 */
export function useLastScan(userId: string | undefined, onScanLanded?: () => void): LastScan {
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  // Re-renders the elapsed label while nothing is being fetched.
  const [, setTick] = useState(0);

  const landedRef = useRef(onScanLanded);
  landedRef.current = onScanLanded;
  // Distinguishes "first read" from "the worker ran again", so opening the page
  // does not look like a scan just landed.
  const seenRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    const read = async () => {
      const { data } = await supabase
        .from('telegram_sessions')
        .select('last_scanned_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (!active) return;
      const value = (data?.last_scanned_at as string | null) ?? null;
      setLastScannedAt(value);

      if (seenRef.current !== undefined && value !== seenRef.current) {
        landedRef.current?.();
      }
      seenRef.current = value;
    };

    void read();
    const poll = setInterval(() => void read(), POLL_MS);
    // The elapsed reading would otherwise sit still for a whole minute.
    const clock = setInterval(() => setTick((n) => n + 1), 30_000);

    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [userId]);

  if (!lastScannedAt) {
    return { lastScannedAt: null, minutesAgo: null, state: 'unknown', label: 'لم يبدأ بعد' };
  }

  const minutesAgo = Math.max(0, Math.floor((Date.now() - Date.parse(lastScannedAt)) / 60_000));
  return {
    lastScannedAt,
    minutesAgo,
    state: stateFor(minutesAgo),
    label: describe(minutesAgo),
  };
}
