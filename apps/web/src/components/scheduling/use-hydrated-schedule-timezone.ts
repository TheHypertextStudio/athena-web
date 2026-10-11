'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { resolveScheduleTimezone } from '@docket/planning/wall-time';

const subscribe = (): (() => void) => () => undefined;

/** Keep the first server/browser frame in the same zone, then resolve the viewer's timezone. */
export function useHydratedScheduleTimezone(
  timezone: string | null | undefined,
  initialTimezone?: string | null,
): string {
  const browserSnapshot = useCallback(
    () => resolveScheduleTimezone(timezone ?? initialTimezone ?? undefined),
    [timezone, initialTimezone],
  );
  const serverSnapshot = useCallback(
    () => resolveScheduleTimezone(timezone ?? initialTimezone ?? 'UTC'),
    [timezone, initialTimezone],
  );
  return useSyncExternalStore(subscribe, browserSnapshot, serverSnapshot);
}
