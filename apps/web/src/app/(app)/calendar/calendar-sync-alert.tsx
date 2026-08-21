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
      title={[conflicts, failures].filter(Boolean).join(' · ')}
      className="bg-error-container text-on-error-container text-label-small min-w-0 shrink truncate rounded-md px-2 py-1"
    >
      {[conflicts, failures].filter(Boolean).join(' · ')}
    </div>
  );
}
