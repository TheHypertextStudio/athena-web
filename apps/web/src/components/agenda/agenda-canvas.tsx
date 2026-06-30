'use client';

/**
 * `agenda/agenda-canvas` — one component that arranges the agenda for every view.
 *
 * @remarks
 * A singular surface for multiple views of the same data: it renders the shared {@link
 * AgendaEntryCard}s either stacked (the **list**) or positioned by time on an hour grid (the
 * **timeline**). The cards are the same elements in both arrangements — keyed by a stable
 * `view-transition-name` — so switching the view (or the day, both wrapped in a View Transition by
 * {@link useAgenda}) *rearranges* the same cards and the browser morphs them, rather than swapping
 * two separate view components.
 */
import { Stack } from '@docket/ui/primitives';
import { type JSX, useMemo } from 'react';

import { type AgendaEntry, type TimeboxedEntry, isTimeboxed, useAgenda } from './agenda-context';
import AgendaEntryCard from './agenda-entry-card';

/** The first and last hour (24h) the timeline renders, inclusive. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
/** Pixels per hour on the timeline — drives card top/height geometry. */
const HOUR_HEIGHT = 56;

/** The hour labels down the timeline gutter. */
const HOUR_LABELS: readonly number[] = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, i) => DAY_START_HOUR + i,
);

/** Format an hour (0–23) as a compact 12-hour label, e.g. `9 AM`. */
function formatHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(display)} ${period}`;
}

/** Fractional hours since local midnight for an ISO timestamp. */
function hoursOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
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
  const { entries, view } = useAgenda();
  if (entries.length === 0) return <AgendaEmpty />;
  return view === 'timeline' ? <TimelineArrangement entries={entries} /> : <ListArrangement entries={entries} />;
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

/** The timeline arrangement: the same cards, positioned by time on an hour grid. */
function TimelineArrangement({ entries }: ArrangementProps): JSX.Element {
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
      <div className="absolute inset-y-0 right-0 left-12">
        {placed.map(({ entry, top, height }) => (
          <div key={entry.id} className="absolute inset-x-0" style={{ top, height }}>
            <AgendaEntryCard entry={entry} layout="block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Calm empty state when the day has no planned entries. */
function AgendaEmpty(): JSX.Element {
  return (
    <Stack
      align="center"
      gap={2}
      className="border-outline-variant text-on-surface-variant justify-center rounded-xl border border-dashed p-8 text-center"
    >
      <p className="text-on-surface text-body font-medium">Nothing planned</p>
      <p className="max-w-xs text-xs">Capture or pull in tasks to plan this day.</p>
    </Stack>
  );
}
