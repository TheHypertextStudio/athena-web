'use client';

/**
 * The Hub Portfolio roadmap timeline — one shared, horizontally-scrollable time axis with the
 * caller's org swimlanes laid out across it.
 *
 * @remarks
 * This is the flagship cross-org visual. A single {@link TimeScale} (derived from every dated
 * Project bar in view) drives a sticky axis header and a column of org {@link Swimlane} bands.
 * The header pins to the top during vertical scroll and the per-swimlane org-label column pins
 * to the left during horizontal scroll, so the axis and the org each stay readable while the
 * other dimension moves. A subtle "today" rule is drawn when the current date falls inside the
 * window, anchoring the roadmap to the present.
 *
 * The whole grid sizes its track to `--track-width` (scaled from the tick count) so dense,
 * many-month roadmaps overflow into horizontal scroll instead of crushing the bars, while a
 * short roadmap fills the available width. Health is communicated by bar tint with a compact
 * legend, and focus dimming is delegated to each band.
 */
import type { CSSProperties, JSX } from 'react';
import { useMemo } from 'react';

import { cn } from '@docket/ui';

import {
  HEALTH_LABEL,
  HEALTH_UNKNOWN_FILL_CLASS,
  HEALTH_UNKNOWN_LABEL,
  HEALTH_FILL_CLASS,
} from './health';
import type { SwimlaneRow } from './layout';
import { Swimlane } from './swimlane';
import { type TimeScale, pct } from './time-scale';

/** The fixed width of the pinned org-label column (CSS length). */
const LABEL_COL = '12rem';

/** Approximate pixels per tick used to size the scrollable track. */
const PX_PER_TICK = 96;

/** Props for {@link RoadmapTimeline}. */
export interface RoadmapTimelineProps {
  /** The swimlane render rows, in org order. */
  rows: readonly SwimlaneRow[];
  /** The shared, resolved time scale. */
  scale: TimeScale;
  /** The focused org id (its band stays bright; others dim), or null for no focus. */
  focusedOrgId: string | null;
}

/**
 * Render the roadmap: the sticky axis header + the org swimlane bands.
 *
 * @param props - The {@link RoadmapTimelineProps}.
 * @returns the rendered timeline.
 */
export function RoadmapTimeline({ rows, scale, focusedOrgId }: RoadmapTimelineProps): JSX.Element {
  // The "today" rule offset, when the current instant lands inside the window.
  const todayLeft = useMemo(() => {
    const now = Date.now();
    return now >= scale.min && now <= scale.max ? pct(now, scale) : null;
  }, [scale]);

  // Size the track from the tick density so dense roadmaps overflow into horizontal scroll.
  const trackWidth = Math.max(scale.ticks.length * PX_PER_TICK, 640);

  return (
    <div
      className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border"
      style={
        {
          '--label-col': LABEL_COL,
        } as CSSProperties
      }
    >
      <div className="max-h-[calc(100vh-16rem)] overflow-auto">
        {/* The inner canvas: pinned label column + a track sized to the tick density. */}
        <div style={{ minWidth: `calc(${LABEL_COL} + ${trackWidth}px)` }}>
          {/* ── Sticky axis header ───────────────────────────────────────── */}
          <div className="bg-surface-container-low/95 supports-[backdrop-filter]:bg-surface-container-low/80 border-outline-variant sticky top-0 z-30 grid grid-cols-[var(--label-col)_1fr] border-b backdrop-blur">
            <div className="bg-surface-container-low/95 border-outline-variant sticky left-0 z-10 flex items-center border-r px-4 py-2.5">
              <span className="text-on-surface-variant text-xs font-medium">Organization</span>
            </div>
            <div className="relative h-9">
              {scale.ticks.map((tick, index) =>
                // Skip the final boundary label so it never clips at the right edge.
                index === scale.ticks.length - 1 ? null : (
                  <div
                    key={tick.at}
                    className="text-on-surface-variant absolute top-0 flex h-full items-center px-2 text-[11px] font-medium tabular-nums"
                    style={{ left: `${pct(tick.at, scale)}%` }}
                  >
                    {tick.label}
                  </div>
                ),
              )}
              {todayLeft !== null ? (
                <div
                  aria-hidden="true"
                  className="bg-primary/60 absolute top-0 z-[1] h-full w-px"
                  style={{ left: `${todayLeft}%` }}
                  title="Today"
                />
              ) : null}
            </div>
          </div>

          {/* ── Swimlane bands ───────────────────────────────────────────── */}
          <div className="relative">
            {rows.map((row) => (
              <Swimlane
                key={row.organization.id}
                row={row}
                scale={scale}
                todayLeft={todayLeft}
                dimmed={focusedOrgId !== null && focusedOrgId !== row.organization.id}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Health legend ──────────────────────────────────────────────── */}
      <div className="border-outline-variant flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-4 py-2.5">
        <span className="text-on-surface-variant text-xs font-medium">Health</span>
        {(Object.keys(HEALTH_LABEL) as (keyof typeof HEALTH_LABEL)[]).map((key) => (
          <LegendItem key={key} fill={HEALTH_FILL_CLASS[key]} label={HEALTH_LABEL[key]} />
        ))}
        <LegendItem fill={HEALTH_UNKNOWN_FILL_CLASS} label={HEALTH_UNKNOWN_LABEL} />
        <span className="text-on-surface-variant inline-flex items-center gap-1.5 text-[11px]">
          <span
            aria-hidden="true"
            className="bg-surface border-outline-variant size-2 rotate-45 rounded-[1px] border"
          />
          Milestone
        </span>
      </div>
    </div>
  );
}

/** Props for {@link LegendItem}. */
interface LegendItemProps {
  /** The swatch fill class. */
  fill: string;
  /** The legend label. */
  label: string;
}

/** A single health legend entry: a colored swatch + its label. */
function LegendItem({ fill, label }: LegendItemProps): JSX.Element {
  return (
    <span className="text-on-surface-variant inline-flex items-center gap-1.5 text-[11px]">
      <span aria-hidden="true" className={cn('size-2.5 rounded-sm', fill)} />
      {label}
    </span>
  );
}
