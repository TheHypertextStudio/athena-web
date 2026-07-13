import type { JSX } from 'react';

interface SchedulingCanvasNoticeProps {
  readonly emptyMessage: string;
  readonly error?: string | null;
  readonly gutterWidth: number;
  readonly isEmpty: boolean;
  readonly viewportWidth: number;
}

/** Keep degraded and empty-state guidance attached to the visible schedule viewport. */
export function SchedulingCanvasNotice({
  emptyMessage,
  error,
  gutterWidth,
  isEmpty,
  viewportWidth,
}: SchedulingCanvasNoticeProps): JSX.Element | null {
  const normalizedError = error?.trim();
  const hasError = normalizedError !== undefined && normalizedError.length > 0;
  if (!hasError && !isEmpty) return null;

  return (
    <div className="pointer-events-none absolute top-full right-0 left-0 z-20 mt-4">
      <div
        role={hasError ? 'alert' : 'status'}
        className="bg-surface/90 text-on-surface-variant sticky h-fit w-fit max-w-sm rounded-lg border px-3 py-2 text-xs break-words shadow-sm"
        style={{
          left: gutterWidth + 16,
          maxWidth: Math.max(0, viewportWidth - gutterWidth - 32),
        }}
      >
        {hasError ? normalizedError : emptyMessage}
      </div>
    </div>
  );
}
