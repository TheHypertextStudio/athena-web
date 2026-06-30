'use client';

/**
 * `stream` — the per-row action cluster (open · done · snooze · Ask Athena).
 *
 * @remarks
 * Pure + controlled: it renders affordances and calls back; all API wiring lives in
 * `use-stream-page`. "Open" is a link to the source (external permalink or internal route);
 * the rest are buttons. The row reveals this cluster on hover/focus. `pending` disables the
 * buttons while a mutation for this row is in flight.
 */
import { CheckCircle2, Link as LinkIcon, Schedule, Sparkles } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import NextLink from 'next/link';
import type { JSX } from 'react';

import { streamHref, type StreamEventRow } from './stream-meta';

/** Callback bundle for row actions (supplied by the page hook). */
export interface StreamRowActions {
  /** Mark the event read/done. */
  readonly onMarkDone?: (row: StreamEventRow) => void;
  /** Snooze the event (the hook owns the "until"). */
  readonly onSnooze?: (row: StreamEventRow) => void;
  /** Hand the event to Athena to draft a plan. */
  readonly onAskAthena?: (row: StreamEventRow) => void;
}

/** Props for {@link StreamEventActions}. */
export interface StreamEventActionsProps {
  readonly row: StreamEventRow;
  readonly actions: StreamRowActions;
  /** Whether a mutation for this row is in flight (disables the buttons). */
  readonly pending?: boolean;
}

const BTN =
  'flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40';

/** The trailing action cluster for one stream row. */
export function StreamEventActions({ row, actions, pending }: StreamEventActionsProps): JSX.Element {
  const href = streamHref(row);
  const external = href?.startsWith('http') ?? false;
  return (
    <div className="flex items-center gap-0.5">
      {href ? (
        <NextLink
          href={href}
          {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
          className={BTN}
          aria-label="Open source"
          title="Open source"
        >
          <LinkIcon className="h-4 w-4" />
        </NextLink>
      ) : null}
      {actions.onMarkDone ? (
        <button
          type="button"
          className={BTN}
          disabled={pending}
          onClick={() => actions.onMarkDone?.(row)}
          aria-label="Mark done"
          title="Mark done"
        >
          <CheckCircle2 className="h-4 w-4" />
        </button>
      ) : null}
      {actions.onSnooze ? (
        <button
          type="button"
          className={BTN}
          disabled={pending}
          onClick={() => actions.onSnooze?.(row)}
          aria-label="Snooze"
          title="Snooze"
        >
          <Schedule className="h-4 w-4" />
        </button>
      ) : null}
      {actions.onAskAthena ? (
        <button
          type="button"
          className={cn(BTN, 'text-[var(--color-primary)]')}
          disabled={pending}
          onClick={() => actions.onAskAthena?.(row)}
          aria-label="Ask Athena"
          title="Ask Athena to handle this"
        >
          <Sparkles className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
