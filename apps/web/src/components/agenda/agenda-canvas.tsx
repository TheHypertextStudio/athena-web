'use client';

/**
 * `agenda/agenda-canvas` — one component that arranges the agenda for every view.
 *
 * @remarks
 * A singular surface for multiple views of the same data: it renders the shared {@link
 * AgendaEntryCard}s either stacked (the **list**) or positioned by time on an hour grid (the
 * **timeline**). The cards are the same elements in both arrangements — keyed by a stable
 * `view-transition-name` — so switching the view (wrapped in a View Transition by {@link useAgenda})
 * *rearranges* the same cards and the browser morphs them, rather than swapping two separate view
 * components. (Day navigation is a plain in-place update, not a transition — see {@link useAgenda}.)
 */
import { cn } from '@docket/ui/lib/utils';
import { Stack } from '@docket/ui/primitives';
import {
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { formatClock, formatHour } from '@/lib/format-time';
import { prefersReducedMotion } from '@/lib/motion';
import { useNow } from '@/lib/use-now';

import { type AgendaEntry, type TimeboxedEntry, isTimeboxed, useAgenda } from './agenda-context';
import AgendaEntryCard from './agenda-entry-card';

/** The first and last hour (24h) the timeline renders, inclusive. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
/** Pixels per hour on the timeline — drives card top/height geometry. */
const HOUR_HEIGHT = 56;
/** Drag-to-reschedule snaps to 15-minute steps. */
const SNAP_PX = HOUR_HEIGHT / 4;

/** The hour labels down the timeline gutter. */
const HOUR_LABELS: readonly number[] = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, i) => DAY_START_HOUR + i,
);

/** Fractional hours since local midnight for an ISO timestamp. */
function hoursOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
}

/** An ISO instant on the same calendar day as `iso`, at `hours` past local midnight (fractional). */
function timeAt(iso: string, hours: number): string {
  const d = new Date(iso);
  const whole = Math.floor(hours);
  d.setHours(whole, Math.round((hours - whole) * 60), 0, 0);
  return d.toISOString();
}

/** Start time in ms for a timeboxed entry, or `null` for untimed. */
function startMs(entry: AgendaEntry): number | null {
  return isTimeboxed(entry) ? new Date(entry.startsAt).getTime() : null;
}

/** Order entries chronologically: timeboxed by start first, then untimed in plan order. */
function chronological(entries: readonly AgendaEntry[]): AgendaEntry[] {
  return [...entries].sort((a, b) => {
    const as = startMs(a);
    const bs = startMs(b);
    if (as !== null && bs !== null) return as - bs;
    if (as !== null) return -1;
    if (bs !== null) return 1;
    return a.sort - b.sort;
  });
}

/** Arranges the agenda for the active view. */
export default function AgendaCanvas(): JSX.Element {
  // The single context read for the canvas: the arrangements below are pure, props-driven views.
  const { entries, view, isToday } = useAgenda();
  // No empty state: the timeline is the default and always renders its hour grid (an empty calendar
  // is still a calendar). The list simply stacks whatever entries there are.
  return view === 'list' ? (
    <ListArrangement entries={entries} />
  ) : (
    <TimelineArrangement entries={entries} isToday={isToday} />
  );
}

/** Props shared by the view arrangements. */
interface ArrangementProps {
  /** The day's entries to arrange. */
  entries: readonly AgendaEntry[];
}

/** The list arrangement: the same cards, stacked in chronological order. */
function ListArrangement({ entries }: ArrangementProps): JSX.Element {
  const ordered = useMemo(() => chronological(entries), [entries]);
  return (
    <Stack as="ul" gap={1}>
      {ordered.map((entry) => (
        <li key={entry.id}>
          <AgendaEntryCard entry={entry} />
        </li>
      ))}
    </Stack>
  );
}

/** A timeboxed card placed on the grid (top offset + height, in px). */
interface PlacedEntry {
  entry: TimeboxedEntry;
  top: number;
  height: number;
}

/** Props for {@link TimelineArrangement}: the shared entries plus whether the day is today. */
interface TimelineArrangementProps extends ArrangementProps {
  /** Whether the shown day is today — drives the "now" line. */
  isToday: boolean;
}

/** The timeline arrangement: the same cards, positioned by time on an hour grid. */
function TimelineArrangement({ entries, isToday }: TimelineArrangementProps): JSX.Element {
  const placed = useMemo<PlacedEntry[]>(
    () =>
      entries
        .filter(isTimeboxed)
        .map((entry) => {
          const startH = Math.max(hoursOfDay(entry.startsAt), DAY_START_HOUR);
          const endH = Math.min(hoursOfDay(entry.endsAt), DAY_END_HOUR + 1);
          const top = (startH - DAY_START_HOUR) * HOUR_HEIGHT;
          // Floor very short timeboxes to ~half an hour so they stay legible.
          const height = Math.max((endH - startH) * HOUR_HEIGHT, HOUR_HEIGHT / 2);
          return { entry, top, height };
        })
        .sort((a, b) => a.top - b.top),
    [entries],
  );
  const gridHeight = HOUR_LABELS.length * HOUR_HEIGHT;

  // A *live* "now" line on today's grid: `useNow` ticks it every 30s so it visibly creeps down the
  // day (a smooth `top` transition glides it), and even an empty calendar reads as alive.
  const now = useNow(30_000);
  const nowHours = now.getHours() + now.getMinutes() / 60;
  const showNow = isToday && nowHours >= DAY_START_HOUR && nowHours <= DAY_END_HOUR + 1;
  const nowTop = (nowHours - DAY_START_HOUR) * HOUR_HEIGHT;

  // On open, bring "now" into view (centered) so today's grid lands where the day actually is,
  // rather than pinned to 7 AM. Once per mount; honors reduced-motion.
  const nowRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!showNow || scrolledRef.current || !nowRef.current) return;
    scrolledRef.current = true;
    nowRef.current.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
  }, [showNow]);

  return (
    <div className="relative" style={{ height: gridHeight }}>
      {HOUR_LABELS.map((hour, i) => (
        <div
          key={hour}
          className="border-outline-variant absolute inset-x-0 border-t"
          style={{ top: i * HOUR_HEIGHT }}
        >
          <span className="text-on-surface-variant absolute -top-2 left-0 text-[10px] tabular-nums">
            {formatHour(hour)}
          </span>
        </div>
      ))}
      {/* Past time reads quieter than what's ahead — a subtle scrim from the top down to now. */}
      {showNow ? (
        <div
          className="bg-surface-container-high/25 pointer-events-none absolute inset-x-0 top-0 z-0 motion-safe:transition-[height] motion-safe:duration-500 motion-safe:ease-linear"
          style={{ height: Math.max(nowTop, 0) }}
        />
      ) : null}
      {showNow ? (
        <div
          ref={nowRef}
          className="bg-primary pointer-events-none absolute inset-x-0 z-10 h-px motion-safe:transition-[top] motion-safe:duration-500 motion-safe:ease-linear"
          style={{ top: nowTop }}
        >
          {/* A steady dot with a slow ping ring — the classic "this is live" beacon. */}
          <div className="absolute top-1/2 left-0 size-2 -translate-y-1/2">
            <div className="bg-primary/40 absolute inset-0 rounded-full motion-safe:animate-ping" />
            <div className="bg-primary absolute inset-0 rounded-full" />
          </div>
        </div>
      ) : null}
      <div className="absolute inset-y-0 right-0 left-12">
        {placed.map(({ entry, top, height }) => (
          <TimelineBlock key={entry.id} entry={entry} top={top} height={height} />
        ))}
      </div>
    </div>
  );
}

/** Props for {@link TimelineBlock}. */
interface TimelineBlockProps {
  /** The timeboxed entry to place + (when editable) drag. */
  entry: TimeboxedEntry;
  /** Pixel offset from the grid top. */
  top: number;
  /** Pixel height of the block. */
  height: number;
}

/**
 * A timeboxed card on the grid that you can **drag to reschedule** (plan tasks only).
 *
 * @remarks
 * Native Pointer Events (with pointer capture) move the block, snapped to 15-minute steps and
 * clamped to the visible day; a live badge shows the target start time. A drag past a small
 * threshold reschedules on release (`setTimebox`, preserving duration) and suppresses the card's
 * navigation click; a plain click still opens the task. Calendar events (no `planItemId`) render
 * fixed. `touch-none` keeps a touch-drag from scrolling the rail.
 */
function TimelineBlock({ entry, top, height }: TimelineBlockProps): JSX.Element {
  const { setTimebox } = useAgenda();
  const editable = entry.planItemId != null;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const movedRef = useRef(false);
  const maxTop = HOUR_LABELS.length * HOUR_HEIGHT - height;

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    // Reset first so a click that trails a *previous* drag doesn't stay suppressed. Then let the
    // checkbox / ⋯ actions handle their own clicks; drag only starts from the card body.
    movedRef.current = false;
    if (!editable || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    startYRef.current = event.clientY;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragging) return;
    const raw = event.clientY - startYRef.current;
    if (Math.abs(raw) > 4) movedRef.current = true;
    const snapped = Math.round(raw / SNAP_PX) * SNAP_PX;
    const nextTop = Math.min(Math.max(top + snapped, 0), maxTop);
    setOffset(nextTop - top);
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragging) return;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    const finalTop = top + offset;
    setOffset(0);
    if (!movedRef.current) return; // a click, not a drag
    const startHours = DAY_START_HOUR + finalTop / HOUR_HEIGHT;
    const durationHours =
      (new Date(entry.endsAt).getTime() - new Date(entry.startsAt).getTime()) / 3_600_000;
    setTimebox(
      entry,
      timeAt(entry.startsAt, startHours),
      timeAt(entry.startsAt, startHours + durationHours),
    );
  }
  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>): void {
    // Swallow the click that trails a drag so the block doesn't also navigate to the task.
    if (movedRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  const badgeHours = DAY_START_HOUR + (top + offset) / HOUR_HEIGHT;

  return (
    <div
      className={cn(
        'absolute inset-x-0 touch-none',
        editable && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
        dragging
          ? 'z-30 opacity-95 shadow-lg motion-safe:scale-[1.02]'
          : 'motion-safe:transition-[top] motion-safe:duration-200 motion-safe:ease-out',
      )}
      style={{ top: top + offset, height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClickCapture={onClickCapture}
    >
      {dragging ? (
        <span className="bg-primary text-on-primary absolute -top-2 right-1 z-10 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums shadow-sm">
          {formatClock(timeAt(entry.startsAt, badgeHours))}
        </span>
      ) : null}
      <AgendaEntryCard entry={entry} layout="block" />
    </div>
  );
}
