'use client';

import type { HubTodayOut } from '@docket/types';
import Link from 'next/link';
import { type JSX, useMemo } from 'react';

import { OrgChip } from '@/components/org-chip';

/** A single timeboxed block from the Hub `today.calendar` array. */
type CalendarBlock = HubTodayOut['calendar'][number];

/** The first and last hour (24h) the day column renders, inclusive. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
/** Pixels per hour in the day column — drives block top/height geometry. */
const HOUR_HEIGHT = 56;

/** The hour labels rendered down the gutter of the day column. */
const HOUR_LABELS: readonly number[] = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, i) => DAY_START_HOUR + i,
);

/** Format an hour (0–23) as a compact 12-hour label, e.g. `9 AM`, `12 PM`. */
function formatHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(display)} ${period}`;
}

/** Format an ISO timestamp as a local `h:mm` clock label, e.g. `9:30`. */
function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Fractional hours since midnight (local) for an ISO timestamp. */
function hoursOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
}

/** The placed geometry (top offset + height, in px) for a timeboxed block. */
interface PlacedBlock {
  block: CalendarBlock;
  top: number;
  height: number;
}

/** Props for {@link CalendarPane}. */
export interface CalendarPaneProps {
  /** The day's timeboxed blocks (Hub `today.calendar`). */
  blocks: readonly CalendarBlock[];
  /** Resolve a task's title by id (from the plan), for the block label. */
  taskTitle: (taskId: string) => string;
  /** Resolve an org's display name by id, for the block's org chip. */
  orgName: (orgId: string) => string;
}

/**
 * The Today calendar pane — the day's timeboxed blocks in a single day column.
 *
 * @remarks
 * Renders a fixed-window day grid (7 AM–10 PM) with hour gridlines down a labeled gutter.
 * Each timeboxed daily-plan block is absolutely positioned by its start/end against the
 * grid, clamped to the visible window, and links to its task. Blocks carry an
 * {@link OrgChip} so a cross-org day stays attributable. When the day has no timeboxes the
 * pane shows a calm empty state rather than a bare grid.
 */
export function CalendarPane({ blocks, taskTitle, orgName }: CalendarPaneProps): JSX.Element {
  const placed = useMemo<PlacedBlock[]>(() => {
    return [...blocks]
      .map((block) => {
        const startH = Math.max(hoursOfDay(block.startsAt), DAY_START_HOUR);
        const endH = Math.min(hoursOfDay(block.endsAt), DAY_END_HOUR + 1);
        const top = (startH - DAY_START_HOUR) * HOUR_HEIGHT;
        // Floor the height to ~half an hour so very short timeboxes stay legible.
        const height = Math.max((endH - startH) * HOUR_HEIGHT, HOUR_HEIGHT / 2);
        return { block, top, height };
      })
      .sort((a, b) => a.top - b.top);
  }, [blocks]);

  const gridHeight = HOUR_LABELS.length * HOUR_HEIGHT;

  if (blocks.length === 0) {
    return (
      <div className="border-border/60 text-muted-foreground flex flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm">
        No timeboxed blocks today. Drag tasks onto your calendar to plan focus time.
      </div>
    );
  }

  return (
    <div className="border-border/60 bg-card/40 relative overflow-hidden rounded-lg border">
      <div className="relative" style={{ height: gridHeight }}>
        {/* Hour gridlines + gutter labels. */}
        {HOUR_LABELS.map((hour, i) => (
          <div
            key={hour}
            className="border-border/40 absolute inset-x-0 border-t"
            style={{ top: i * HOUR_HEIGHT }}
          >
            <span className="text-muted-foreground absolute -top-2 left-2 bg-transparent text-[10px] tabular-nums">
              {formatHour(hour)}
            </span>
          </div>
        ))}

        {/* Timeboxed blocks, absolutely placed against the grid. */}
        <div className="absolute inset-y-0 right-2 left-14">
          {placed.map(({ block, top, height }) => (
            <Link
              key={`${block.taskId}-${block.startsAt}`}
              href={`/orgs/${block.organizationId}/my-work`}
              style={{ top, height }}
              className="group bg-primary/10 hover:bg-primary/15 border-primary/30 focus-visible:ring-ring focus-visible:ring-offset-background absolute inset-x-0 flex flex-col gap-0.5 overflow-hidden rounded-md border-l-2 px-2.5 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
            >
              <span className="text-foreground truncate text-xs font-medium">
                {taskTitle(block.taskId)}
              </span>
              <span className="text-muted-foreground truncate text-[11px] tabular-nums">
                {formatClock(block.startsAt)} – {formatClock(block.endsAt)}
              </span>
              {height >= HOUR_HEIGHT ? (
                <div className="mt-auto">
                  <OrgChip orgId={block.organizationId} name={orgName(block.organizationId)} />
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
