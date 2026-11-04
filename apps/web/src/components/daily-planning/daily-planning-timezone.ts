'use client';

import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

interface PlanningTimezoneSetup {
  readonly ready: boolean;
  readonly isError: boolean;
  readonly retry: () => void;
}

/** Establish a local planning day only when the person has no saved timezone preference. */
export function usePlanningTimezoneSetup(
  timezone: string | undefined,
  preferencesReady: boolean,
): PlanningTimezoneSetup {
  const attempted = useRef(false);
  const initialize = useApiMutation({
    failure: 'silent',
    mutationFn: async () => {
      const current = await unwrap(
        () => api.v1.hub.preferences.$get(),
        'Could not read your timezone.',
      );
      if (current.timezone) return current;
      return unwrap(
        () =>
          api.v1.hub.preferences.$patch({
            json: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          }),
        'Could not save your local timezone.',
      );
    },
    invalidateKeys: [queryKeys.hubPreferences(), ['me', 'daily-planning-day']],
  });
  const { mutateAsync } = initialize;
  useEffect(() => {
    if (!preferencesReady || timezone || attempted.current) return;
    attempted.current = true;
    void mutateAsync(undefined).catch(() => undefined);
  }, [preferencesReady, timezone, mutateAsync]);
  return {
    ready: Boolean(timezone) || initialize.isSuccess,
    isError: !timezone && initialize.isError,
    retry: (): void => {
      void mutateAsync(undefined).catch(() => undefined);
    },
  };
}
