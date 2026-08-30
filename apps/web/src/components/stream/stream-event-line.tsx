'use client';

/**
 * `stream` — one compact, subject-free event line, and the detail it unfolds in place.
 *
 * @remarks
 * The line used to open a right-side drawer. It now expands beneath itself instead: same
 * information, no overlay, and the timeline the event belongs to stays on screen behind it.
 *
 * ## Two disclosures, one rule
 *
 * An episode already has a disclosure — "3 related events" — and every line now has its own.
 * They stay legible because they mean structurally different things:
 *
 * > A disclosure that adds stations to the spine reveals **more events**. A disclosure that
 * > opens a raised card **off** the spine reveals **more about one event**.
 *
 * So depth is read from containment and offset rather than by counting indents, and the two
 * affordances never look alike: the episode's is a labelled text button on the rail, this one
 * is a full-width row whose only mark is a trailing chevron.
 *
 * ## Why the ids are deterministic
 *
 * `useId()` emits `:r1:`, which is a valid DOM id and an *invalid* CSS selector — so a test
 * cannot reach the panel through `#id`, and neither can anything else that resolves an
 * `aria-controls` value as a selector. The event id is already unique per row.
 */
import { ChevronDown } from '@docket/ui/icons';
import { ActorAvatar, RelativeTime } from '@docket/ui/components';
import { focusRingInset } from '@docket/ui/primitives';
import { cn } from '@docket/ui';
import type { JSX } from 'react';

import { relativeTime } from '../agents/format-time';
import { StreamEventDetail } from './stream-event-detail';
import {
  streamActorKind,
  streamEventDetailLabel,
  streamEventSentence,
  type StreamEventRow,
} from './stream-meta';
import { SpineCell } from './stream-spine';

/** The disclosure button's id for one event. */
export function eventLineId(rowId: string): string {
  return `stream-event-${rowId}`;
}

/** The expanded panel's id for one event. */
export function eventDetailId(rowId: string): string {
  return `stream-event-detail-${rowId}`;
}

/** Props for {@link StreamEventLine}. */
export interface StreamEventLineProps {
  /** The event. */
  readonly row: StreamEventRow;
  /** Whether this line's detail panel is open. */
  readonly expanded: boolean;
  /** Toggle this line's detail panel. The episode owns which one is open. */
  readonly onToggle: (id: string) => void;
  /** Demote the line — a related event disclosed behind the episode's own toggle. */
  readonly quiet?: boolean;
  /** Terminate the rail at this line's station — it is the last row of the episode. */
  readonly terminal?: boolean;
}

/** One event as a disclosure: action, typed detail, occurrence time, and its full record. */
export function StreamEventLine({
  row,
  expanded,
  onToggle,
  quiet = false,
  terminal = false,
}: StreamEventLineProps): JSX.Element {
  const detail = streamEventDetailLabel(row);
  const exactTime = new Date(row.occurredAt).toLocaleString();
  const buttonId = eventLineId(row.id);
  const panelId = eventDetailId(row.id);

  return (
    <>
      <button
        type="button"
        id={buttonId}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => {
          onToggle(row.id);
        }}
        className={cn(
          // The state layer, not a container tint: the day group is already
          // `surface-container-low`, so a `hover:bg-surface-container-low` row would be
          // invisible on top of it.
          'hover:bg-on-surface/8 active:bg-on-surface/10',
          'grid min-h-10 w-full grid-cols-[1.25rem_auto_minmax(0,1fr)_auto] items-start gap-x-2 rounded-md pr-2 text-left outline-none',
          focusRingInset,
          quiet && 'opacity-75',
        )}
      >
        <SpineCell mark={quiet ? 'related' : 'event'} terminal={terminal} />
        {/* The sentence already names the actor; the avatar carries kind, not identity, so
            labelling it would make every row announce its actor twice. */}
        <span aria-hidden="true" className="mt-2.5">
          <ActorAvatar
            kind={streamActorKind(row)}
            name={row.actorName ?? 'Someone'}
            avatarUrl={row.actorAvatarUrl}
            size={20}
          />
        </span>
        <span className="min-w-0 py-2">
          <span className={cn('block', quiet ? 'text-body-small' : 'text-body-medium')}>
            {streamEventSentence(row)}
          </span>
          {detail ? (
            <span className="text-on-surface-variant text-body-small mt-0.5 line-clamp-2 block">
              {detail}
            </span>
          ) : null}
        </span>
        <span className="flex min-h-10 shrink-0 items-center gap-1">
          <RelativeTime
            iso={row.occurredAt}
            aria-label={exactTime}
            className="text-on-surface-variant text-label-small"
          >
            {relativeTime(row.occurredAt)}
          </RelativeTime>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'text-on-surface-variant size-4 transition-transform ease-(--ease-out)',
              expanded && 'rotate-180',
            )}
          />
        </span>
      </button>

      {/* `0fr → 1fr` on a grid row animates height with no measurement, no ResizeObserver, and
          no layout thrash inside an infinitely-scrolling list. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows]',
          expanded
            ? 'grid-rows-[1fr] duration-(--dur-base) ease-(--ease-emphasized-decel)'
            : 'grid-rows-[0fr] duration-(--dur-fast) ease-(--ease-emphasized-accel)',
        )}
      >
        <div className="overflow-hidden">
          {expanded ? <StreamEventDetail row={row} id={panelId} labelledBy={buttonId} /> : null}
        </div>
      </div>
    </>
  );
}
