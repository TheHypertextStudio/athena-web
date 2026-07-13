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
      className="border-border bg-muted/40 text-muted-foreground text-caption flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
    >
      <span>{message}</span>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 [@media(pointer:coarse)]:h-10"
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}
