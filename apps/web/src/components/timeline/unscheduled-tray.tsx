'use client';

/**
 * `timeline` — the tray holding rows that carry no dates.
 *
 * @remarks
 * Undated work still belongs to the plan, so it is neither dropped nor — as the previous Projects
 * lens did — plotted at offset zero with the words "Not scheduled" sitting inside the plot area.
 * Rendering a dateless row on a time axis is a category error: it has no position, and pretending
 * otherwise is exactly what made those rows look broken.
 *
 * Instead the tray sits *below* the axis, outside the plot area, and each entry is a drag **source**
 * — press a chip and drag onto the track to give the row its first dates. That makes scheduling
 * the same gesture everywhere on this surface rather than a detour through a form.
 */
import { cn } from '@docket/ui';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import type { TimelineTint } from './timeline-catalog';
import { TINT_DOT_CLASS } from './timeline-tint';

/** One tray entry: the minimum needed to identify and schedule an undated row. */
export interface TrayEntry {
  /** The row's stable id. */
  readonly id: string;
  /** The row's display name. */
  readonly label: string;
  /** A short status word. */
  readonly status: string;
  /** The row's semantic tone. */
  readonly tint: TimelineTint;
}

/** Props for {@link UnscheduledTray}. */
export interface UnscheduledTrayProps {
  /** The undated rows to surface. */
  entries: readonly TrayEntry[];
  /** Begin a create-drag for an entry, scheduling it where the pointer lands on the track. */
  onSchedulePointerDown: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
  /** Open an entry's detail. */
  onActivate: (id: string) => void;
}

/**
 * Render the unscheduled tray, or nothing when every row is dated.
 *
 * @param props - The {@link UnscheduledTrayProps}.
 * @returns the tray, or `null`.
 */
export default function UnscheduledTray({
  entries,
  onSchedulePointerDown,
  onActivate,
}: UnscheduledTrayProps): JSX.Element | null {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="text-on-surface-variant shrink-0 text-xs font-medium">
        Unscheduled
        <span className="hidden @2xl:inline"> — drag onto the timeline</span>
      </span>
      <ul className="flex min-w-0 flex-wrap gap-1.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onPointerDown={(event) => {
                onSchedulePointerDown(event, entry.id);
              }}
              onClick={() => {
                onActivate(entry.id);
              }}
              aria-label={`${entry.label} — ${entry.status}, unscheduled. Drag to schedule.`}
              className="border-outline-variant bg-surface-container-low hover:bg-surface-container-high focus-visible:ring-ring inline-flex cursor-grab items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing"
              style={{ viewTransitionName: `entity-${entry.id}` }}
            >
              <span
                aria-hidden="true"
                className={cn('size-2 rounded-full', TINT_DOT_CLASS[entry.tint])}
              />
              <span className="text-on-surface max-w-[14rem] truncate">{entry.label}</span>
              <span className="text-on-surface-variant">{entry.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
