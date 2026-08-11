'use client';

/** `stream` — one compact, subject-free event line inside an episode. */
import { cn } from '@docket/ui';
import { focusRing } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { relativeTime } from '../agents/format-time';
import { streamEventDetailLabel, streamEventSentence, type StreamEventRow } from './stream-meta';

/** Props for {@link StreamEventLine}. */
export interface StreamEventLineProps {
  readonly row: StreamEventRow;
  readonly onSelect?: (row: StreamEventRow) => void;
  readonly quiet?: boolean;
}

/** Render one event action, typed detail, and accessible occurrence time. */
export function StreamEventLine({
  row,
  onSelect,
  quiet = false,
}: StreamEventLineProps): JSX.Element {
  const detail = streamEventDetailLabel(row);
  const exactTime = new Date(row.occurredAt).toLocaleString();
  const content = (
    <>
      <span className="min-w-0">
        <span className={cn('block leading-snug', quiet ? 'text-body-small' : 'text-body-medium')}>
          {streamEventSentence(row)}
        </span>
        {detail ? (
          <span className="text-on-surface-variant mt-0.5 block text-xs leading-relaxed">
            {detail}
          </span>
        ) : null}
      </span>
      <time
        dateTime={row.occurredAt}
        title={exactTime}
        aria-label={exactTime}
        className="text-on-surface-variant shrink-0 text-xs max-sm:col-start-1 max-sm:mt-1"
      >
        {relativeTime(row.occurredAt)}
      </time>
    </>
  );

  if (!onSelect) {
    return (
      <div
        className={cn(
          'grid min-h-10 grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2',
          quiet && 'opacity-75',
        )}
      >
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        onSelect(row);
      }}
      className={cn(
        'hover:bg-surface-container-low grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-md px-2 py-2 text-left outline-none',
        focusRing,
        quiet && 'opacity-75',
      )}
    >
      {content}
    </button>
  );
}
