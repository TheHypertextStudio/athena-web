'use client';

/**
 * One org swimlane band in the Hub Portfolio roadmap.
 *
 * @remarks
 * A swimlane is the default grouping row of the portfolio: a single tenant's slice of the
 * cross-org roadmap, and it NEVER merges with another org's work. The band leads with a
 * sticky org-label column (the org's accent dot + name, pinned during horizontal scroll) and
 * then lays its content against the shared time axis:
 *
 * - **Program lanes** render as ongoing containers — a labelled sub-row with a health swatch
 *   and status, but *no bar* (Programs are open-ended), holding their Project bars.
 * - **Project bars** position across the weeks/months they span (see {@link ProjectBar}).
 * - Program-less Projects render in a leading, unlabelled lane directly under the org.
 * - Dateless Projects collect in per-lane {@link UnscheduledTray}s.
 *
 * When another org is focused via the filter chips, the whole band dims (`dimmed`) rather than
 * disappearing, so the cross-org picture stays intact. The org label deep-links to that org's
 * Programs surface.
 */
import type { JSX } from 'react';

import { cn } from '@docket/ui';
import { getOrgAccent } from '@docket/ui/lib/org-accent';
import { FolderKanban } from '@docket/ui/icons';
import Link from 'next/link';

import { fillFor, asHealth, labelFor } from './health';
import { statusLabel } from './format';
import type { LaneRow, SwimlaneRow } from './layout';
import { ProjectBar } from './project-bar';
import type { TimeScale } from './time-scale';
import { UnscheduledTray } from './unscheduled-tray';

/** Props for {@link Swimlane}. */
export interface SwimlaneProps {
  /** The swimlane render row. */
  row: SwimlaneRow;
  /** The shared time scale all bars in the band position against. */
  scale: TimeScale;
  /** The "today" rule offset (% of the track), or null when today is outside the window. */
  todayLeft: number | null;
  /** Whether the band is dimmed (a different org is focused). */
  dimmed: boolean;
}

/**
 * Render one org swimlane band.
 *
 * @param props - The {@link SwimlaneProps}.
 * @returns the rendered band.
 */
export function Swimlane({ row, scale, todayLeft, dimmed }: SwimlaneProps): JSX.Element {
  const orgAccent = getOrgAccent(row.organization.id);
  return (
    <div className={cn('grid grid-cols-[var(--label-col)_1fr]', dimmed && 'opacity-40')}>
      {/* ── Sticky org label column ─────────────────────────────────────── */}
      <div className="bg-surface-container-low border-outline-variant sticky left-0 z-20 flex items-start border-r border-b px-4 py-3">
        <Link
          href={`/orgs/${row.organization.id}/programs`}
          className="focus-visible:ring-ring group flex min-w-0 items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
          title={`${row.organization.name} · ${row.barCount} on the roadmap`}
        >
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: orgAccent }}
          />
          <span className="text-on-surface group-hover:text-on-surface/80 min-w-0 truncate text-sm font-semibold">
            {row.organization.name}
          </span>
        </Link>
      </div>

      {/* ── Track region (aligned to the shared axis) ───────────────────── */}
      <div className="border-outline-variant relative border-b">
        {/* Vertical gridlines (+ the today rule), behind everything in the track. */}
        <Gridlines scale={scale} todayLeft={todayLeft} />

        <div className="relative flex flex-col gap-1.5 py-3">
          {/* Program-less project bars, in a leading unlabelled lane. */}
          {row.placedDirect.length > 0 ? (
            <ul className="relative flex flex-col gap-1.5 px-1">
              {row.placedDirect.map(({ bar, start, end }) => (
                <li key={bar.id}>
                  <ProjectBar bar={bar} start={start} end={end} scale={scale} dimmed={dimmed} />
                </li>
              ))}
            </ul>
          ) : null}

          {/* Program lanes — ongoing containers, no bar of their own. */}
          {row.lanes.map((laneRow) => (
            <ProgramLane
              key={laneRow.lane.program.id}
              laneRow={laneRow}
              scale={scale}
              dimmed={dimmed}
            />
          ))}

          {/* Program-less dateless bars. */}
          <div className="px-3">
            <UnscheduledTray bars={row.unscheduledDirect} dimmed={dimmed} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Props for {@link ProgramLane}. */
interface ProgramLaneProps {
  /** The program lane render row. */
  laneRow: LaneRow;
  /** The shared time scale. */
  scale: TimeScale;
  /** Whether the parent band is dimmed. */
  dimmed: boolean;
}

/**
 * A Program lane within a swimlane: a labelled header (swatch + status, no bar) over its bars.
 *
 * @param props - The {@link ProgramLaneProps}.
 * @returns the rendered lane.
 */
function ProgramLane({ laneRow, scale, dimmed }: ProgramLaneProps): JSX.Element {
  const { program } = laneRow.lane;
  const health = asHealth(program.health);
  return (
    <section
      aria-label={`${program.name} — ${statusLabel(program.status)}, ${labelFor(health)}`}
      className="bg-surface-container rounded-md py-1.5"
    >
      <header className="flex items-center gap-2 px-3 pb-1">
        <FolderKanban aria-hidden="true" className="text-on-surface-variant size-3.5" />
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', fillFor(health))} />
        <span className="text-on-surface min-w-0 truncate text-xs font-medium">{program.name}</span>
        <span className="text-on-surface-variant shrink-0 text-[11px]">
          {statusLabel(program.status)}
        </span>
      </header>

      {laneRow.placed.length > 0 ? (
        <ul className="flex flex-col gap-1.5 px-1">
          {laneRow.placed.map(({ bar, start, end }) => (
            <li key={bar.id}>
              <ProjectBar bar={bar} start={start} end={end} scale={scale} dimmed={dimmed} />
            </li>
          ))}
        </ul>
      ) : null}

      {laneRow.unscheduled.length > 0 ? (
        <div className="px-3">
          <UnscheduledTray bars={laneRow.unscheduled} dimmed={dimmed} />
        </div>
      ) : null}
    </section>
  );
}

/** Props for {@link Gridlines}. */
interface GridlinesProps {
  /** The shared time scale providing the tick offsets. */
  scale: TimeScale;
  /** The "today" rule offset (% of the track), or null when out of window. */
  todayLeft: number | null;
}

/** The vertical month/week/quarter gridlines (+ the today rule) behind a swimlane's track. */
function Gridlines({ scale, todayLeft }: GridlinesProps): JSX.Element {
  const span = scale.max - scale.min;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {scale.ticks.map((tick) => (
        <div
          key={tick.at}
          className="border-outline-variant absolute inset-y-0 border-l"
          style={{ left: `${span > 0 ? ((tick.at - scale.min) / span) * 100 : 0}%` }}
        />
      ))}
      {todayLeft !== null ? (
        <div className="bg-primary/25 absolute inset-y-0 w-px" style={{ left: `${todayLeft}%` }} />
      ) : null}
    </div>
  );
}
