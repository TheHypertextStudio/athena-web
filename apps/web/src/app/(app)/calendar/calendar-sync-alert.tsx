import type { JSX } from 'react';

/** Summarize calendar sync failures without exposing provider or server error details. */
export function CalendarSyncAlert({
  conflictCount,
  failedCount,
}: {
  readonly conflictCount: number;
  readonly failedCount: number;
}): JSX.Element | null {
  if (conflictCount === 0 && failedCount === 0) return null;
  const conflicts = conflictCount
    ? `${String(conflictCount)} sync conflict${conflictCount === 1 ? '' : 's'}`
    : null;
  const failures = failedCount
    ? `${String(failedCount)} sync error${failedCount === 1 ? '' : 's'}`
    : null;
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm font-medium"
    >
      {[conflicts, failures].filter(Boolean).join(' · ')}
    </div>
  );
}
