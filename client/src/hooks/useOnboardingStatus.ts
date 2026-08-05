import { useCallback, useEffect, useState } from 'react';
import { hasTelegramSession } from '@/lib/telegramAuth';

export type OnboardingState = 'loading' | 'complete' | 'incomplete';

/**
 * Reports whether the given user has finished Telegram onboarding.
 *
 * Pass `undefined` while auth is still resolving — the hook stays in `loading`
 * rather than reporting a premature `incomplete`, which would bounce a
 * fully-onboarded user back into the wizard on every page load.
 */
export function useOnboardingStatus(userId: string | undefined) {
  const [state, setState] = useState<OnboardingState>('loading');

  const refresh = useCallback(async () => {
    if (!userId) {
      setState('loading');
      return;
    }
    const connected = await hasTelegramSession(userId);
    setState(connected ? 'complete' : 'incomplete');
  }, [userId]);

  useEffect(() => {
    let active = true;

    if (!userId) {
      setState('loading');
      return;
    }

    hasTelegramSession(userId).then((connected) => {
      if (active) setState(connected ? 'complete' : 'incomplete');
    });

    return () => {
      active = false;
    };
  }, [userId]);

  return { state, refresh };
}
