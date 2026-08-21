import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

interface CalendarReadFailureNoticeProps {
  readonly message: string | null;
  readonly onRetry: () => void;
  readonly retrying: boolean;
}

/** Keep a failed calendar read actionable without replacing the usable schedule underneath it. */
export function CalendarReadFailureNotice({
  message,
  onRetry,
  retrying,
}: CalendarReadFailureNoticeProps): JSX.Element | null {
  if (!message) return null;

  return (
    <div
      role="status"
      className="bg-surface-container-high text-on-surface-variant text-label-small flex min-w-0 flex-1 flex-nowrap items-center gap-1 rounded-md px-2 py-1"
    >
      <span className="min-w-0 flex-1 truncate" title={message}>
        {message}
      </span>
      <Button
        variant="outline"
        controlSize="sm"
        className="shrink-0 [@media(pointer:coarse)]:min-h-10"
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}
