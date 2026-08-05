import { useEffect, useRef, useState } from 'react';

// Matches the monitor workflow's cron schedule (every 5 minutes).
const SCAN_INTERVAL_MS = 5 * 60 * 1000;

function msUntilNextSlot(): number {
  const now = Date.now();
  return SCAN_INTERVAL_MS - (now % SCAN_INTERVAL_MS);
}

/**
 * Counts down to the next scheduled scan and fires `onRollover` when it lands,
 * so the list refreshes itself instead of the timer being decorative.
 *
 * The cron fires on absolute 5-minute boundaries, which is why this counts down
 * to a wall-clock slot rather than 5 minutes from page load. GitHub Actions can
 * still run a scheduled job late under load — the UI says so rather than
 * pretending the timer is a guarantee.
 */
export function useNextScanCountdown(onRollover?: () => void) {
  const [remainingMs, setRemainingMs] = useState(msUntilNextSlot);
  const rolloverRef = useRef(onRollover);
  rolloverRef.current = onRollover;

  useEffect(() => {
    let previous = msUntilNextSlot();

    const id = setInterval(() => {
      const next = msUntilNextSlot();
      // The remaining time jumps back up to ~5 minutes exactly when a slot passes.
      if (next > previous) rolloverRef.current?.();
      previous = next;
      setRemainingMs(next);
    }, 1000);

    return () => clearInterval(id);
  }, []);

  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return {
    remainingMs,
    label: `${minutes}:${String(seconds).padStart(2, '0')}`,
    /** 0 → just scanned, 1 → about to scan. Useful for a progress bar. */
    progress: 1 - remainingMs / SCAN_INTERVAL_MS,
  };
}
