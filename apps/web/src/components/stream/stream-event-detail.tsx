'use client';

/**
 * `stream` — the expanded detail panel for one event, opened in place inside the feed.
 *
 * @remarks
 * This is where the old right-side drawer's payload lives now. The drawer was a hand-rolled
 * `fixed inset-0` scrim with no focus trap, no Escape handling, and no scroll lock, and it
 * answered a question — "what exactly was this event?" — by covering the timeline that gives
 * the event its context. Unfolding in place answers the same question without the swap, which
 * is also what the shared-element rule in `docs/design/ghost-grammar.md` asks for.
 *
 * ## Why the panel repeats things the line already showed
 *
 * It does not. The collapsed line is deliberately subject-free (`streamEventSentence`) because
 * the episode above it already names the subject; the panel restates the event with its subject
 * (`streamDescription`), which is the sentence you would quote elsewhere. The line clamps its
 * typed detail to two rows; the panel shows all of it. The line shows a relative time; the panel
 * shows the instant. Every field here is the *unabbreviated* form of something the line
 * abbreviated — that is what expanding buys.
 */
import { OpenInNew } from '@docket/ui/icons';
import { Badge, Surface, focusRing } from '@docket/ui/primitives';
import { cn } from '@docket/ui';
import type { JSX } from 'react';

import Link from '@/components/docket-link';

import { ProviderBadge } from './provider-badge';
import {
  KIND_LABEL,
  streamDescription,
  streamEventDetailLabel,
  streamExactTime,
  streamHref,
  type StreamEventRow,
} from './stream-meta';

/** Props for {@link StreamEventDetail}. */
export interface StreamEventDetailProps {
  /** The event being expanded. */
  readonly row: StreamEventRow;
  /** The panel's own id — the disclosure button's `aria-controls` target. */
  readonly id: string;
  /** The disclosure button's id, so the region is named by the line that opened it. */
  readonly labelledBy: string;
}

/**
 * Whether following this event's link leaves Docket.
 *
 * @remarks
 * The old drawer stamped an "opens elsewhere" glyph on every subject link, including internal
 * Docket routes, which made the glyph a decoration rather than information.
 *
 * @param row - The event.
 * @param href - Its resolved destination.
 * @returns `true` when the destination is outside the app.
 */
function leavesTheApp(row: StreamEventRow, href: string): boolean {
  return row.origin === 'external' || /^https?:\/\//.test(href);
}

/** One event's full detail, unfolded in place beneath its line. */
export function StreamEventDetail({ row, id, labelledBy }: StreamEventDetailProps): JSX.Element {
  const href = streamHref(row);
  const detail = streamEventDetailLabel(row);
  const exactTime = streamExactTime(row);
  return (
    <Surface
      tone="floating"
      shape="medium"
      pad="comfortable"
      id={id}
      role="region"
      aria-labelledby={labelledBy}
      className="mt-1 mb-2 ml-5 flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ProviderBadge system={row.system} />
        <Badge variant="outline">{KIND_LABEL[row.kind]}</Badge>
        {exactTime ? (
          <time
            dateTime={row.occurredAt}
            className="text-on-surface-variant text-label-small ml-auto tabular-nums"
          >
            {exactTime}
          </time>
        ) : null}
      </div>

      <p className="text-on-surface text-body-medium">{streamDescription(row)}</p>

      {detail ? (
        <p className="text-on-surface-variant text-body-small whitespace-pre-wrap">{detail}</p>
      ) : null}

      {href && row.entityTitle ? (
        <Link
          href={href}
          className={cn(
            'text-primary text-body-medium inline-flex min-h-10 w-fit max-w-full items-center gap-1 rounded-sm outline-none',
            focusRing,
          )}
        >
          <span className="truncate">{row.entityTitle}</span>
          {leavesTheApp(row, href) ? (
            <OpenInNew className="size-4 shrink-0" aria-hidden="true" />
          ) : null}
        </Link>
      ) : null}
    </Surface>
  );
}
