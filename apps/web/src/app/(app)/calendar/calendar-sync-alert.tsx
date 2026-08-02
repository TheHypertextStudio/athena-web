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
      className="bg-error-container text-on-error-container text-body-medium shrink-0 rounded-lg px-3 py-2"
    >
      {[conflicts, failures].filter(Boolean).join(' · ')}
    </div>
  );
}
