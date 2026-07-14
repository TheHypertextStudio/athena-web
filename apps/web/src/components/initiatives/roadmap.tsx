'use client';

/**
 * The timeline-first roadmap for an Initiative detail.
 *
 * @remarks
 * An Initiative is a theme with no work inside it; its detail is a **roadmap rollup** of the
 * Projects + Programs it associates with (api `…/initiatives/:id/timeline`):
 *
 * - **Program lanes** render first, as always-on horizontal lanes. Programs are ongoing and
 *   undated (they have no end state), so each lane spans the full width with a health swatch
 *   and a status label — never a dated bar.
 * - **Project bars** render below, positioned along a shared time axis derived from the
 *   Projects' `[startDate, targetDate]` spans. Each bar is colored by the Project's health
 *   (so a struggling effort reads red regardless of where it sits in time) and deep-links to
 *   the Project detail. Projects with no dates can't be placed on the axis, so they collect
 *   in a clearly-labelled "Unscheduled" tray beneath the dated bars rather than being hidden.
 *
 * The axis is computed from the dated bars (padded to whole months); when nothing is dated
 * the time axis is omitted entirely and only the lanes + unscheduled tray show. The bars are
 * laid out with percentage offsets against the window so the component is fully responsive,
 * and every bar carries an `aria-label` describing its span + health for assistive tech.
 */
import type { Health, InitiativeTimelineBar, InitiativeTimelineLane } from '@docket/types';
import { cn } from '@docket/ui';
import { Flag, FolderKanban } from '@docket/ui/icons';
import type { JSX } from 'react';

import { formatAxisTick, formatDate, toMillis } from './format-date';
import { HEALTH_FILL_CLASS, HEALTH_LABEL, HEALTH_UNKNOWN_FILL_CLASS } from './health';
import { computeWindow, pct, placeBars } from './roadmap-math';

/** Human label for a Project/Program lifecycle status. */
const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** The health-keyed fill class for a bar/swatch, defaulting to the neutral no-verdict fill. */
function fillFor(health: Health | null): string {
  return health ? HEALTH_FILL_CLASS[health] : HEALTH_UNKNOWN_FILL_CLASS;
}

/** Resolve a status string to its display label, falling back to the raw value. */
function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/** Props for {@link Roadmap}. */
export interface RoadmapProps {
  /** The always-on Program lanes from the timeline roll-up. */
  lanes: readonly InitiativeTimelineLane[];
  /** The Project bars from the timeline roll-up. */
  bars: readonly InitiativeTimelineBar[];
  /** The target date of the Initiative itself (a roadmap milestone), when set (ISO). */
  targetDate: string | null;
  /** Singular Program noun (vocabulary-resolved). */
  programNoun: string;
  /** Singular Project noun (vocabulary-resolved). */
  projectNoun: string;
  /** Plural Project noun (vocabulary-resolved). */
  projectNounPlural: string;
  /** Called with a Project id when its bar is activated (deep-link to the project detail). */
  onOpenProject: (projectId: string) => void;
}

/**
 * The roadmap: Program lanes + a dated Project-bar timeline + an unscheduled tray.
 *
 * @param props - The {@link RoadmapProps}.
 * @returns the rendered roadmap.
 */
export function Roadmap({
  lanes,
  bars,
  targetDate,
  programNoun,
  projectNoun,
  projectNounPlural,
  onOpenProject,
}: RoadmapProps): JSX.Element {
  const { placed, unscheduled } = placeBars(bars);
  const window = computeWindow(placed);
  // The Initiative's own target date is drawn as a milestone marker when it falls inside the
  // computed axis window; its left offset (percent) is precomputed so the JSX stays simple.
  const initiativeTargetMs = toMillis(targetDate);
  const targetMarkerLeft =
    window &&
    initiativeTargetMs !== null &&
    initiativeTargetMs >= window.min &&
    initiativeTargetMs <= window.max
      ? pct(initiativeTargetMs, window)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={`${programNoun} lanes`} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Flag aria-hidden="true" className="text-on-surface-variant size-4" />
          <h2 className="text-on-surface text-base font-semibold">
            {programNoun} lanes
            <span className="text-on-surface-variant ml-2 font-normal tabular-nums">
              {lanes.length}
            </span>
          </h2>
        </div>
        {lanes.length === 0 ? (
          <p className="border-outline-variant text-on-surface-variant text-body-medium rounded-lg border border-dashed p-4 text-center">
            No {programNoun.toLowerCase()} lanes — link a {programNoun.toLowerCase()} to this theme
            to track it as an ongoing lane.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lanes.map((lane) => (
              <li
                key={lane.id}
                className="border-outline-variant bg-surface-container flex min-h-10 items-center gap-3 rounded-lg border px-3"
              >
                <span
                  aria-hidden="true"
                  className={cn('size-2.5 shrink-0 rounded-full', fillFor(lane.health))}
                />
                <span className="text-on-surface text-body-medium min-w-0 flex-1 truncate font-medium">
                  {lane.name}
                </span>
                <span className="text-on-surface-variant shrink-0 text-xs">
                  {statusLabel(lane.status)}
                </span>
                <span className="text-on-surface-variant shrink-0 text-xs">
                  {lane.health ? HEALTH_LABEL[lane.health] : 'No verdict'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={`${projectNoun} timeline`} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <FolderKanban aria-hidden="true" className="text-on-surface-variant size-4" />
          <h2 className="text-on-surface text-base font-semibold">
            {projectNoun} roadmap
            <span className="text-on-surface-variant ml-2 font-normal tabular-nums">
              {bars.length}
            </span>
          </h2>
        </div>

        {placed.length === 0 ? (
          <p className="border-outline-variant text-on-surface-variant text-body-medium rounded-lg border border-dashed p-4 text-center">
            No scheduled {projectNounPlural.toLowerCase()} on the roadmap yet.
          </p>
        ) : window ? (
          <div className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border">
            {/* Axis ticks */}
            <div className="border-outline-variant relative h-7 border-b">
              {window.ticks.map((tick, index) =>
                // Skip the final boundary tick label to avoid clipping at the right edge.
                index === window.ticks.length - 1 ? null : (
                  <div
                    key={tick}
                    className="text-on-surface-variant absolute top-0 flex h-full items-center px-2 text-[11px] tabular-nums"
                    style={{ left: `${pct(tick, window)}%` }}
                  >
                    {formatAxisTick(tick)}
                  </div>
                ),
              )}
              {/* The Initiative's own target date, drawn as a milestone marker when in range. */}
              {targetMarkerLeft !== null ? (
                <div
                  className="bg-destructive/70 absolute top-0 h-full w-px"
                  style={{ left: `${targetMarkerLeft}%` }}
                  title={`Target — ${formatDate(targetDate) ?? ''}`}
                  aria-hidden="true"
                />
              ) : null}
            </div>

            {/* Bars */}
            <ul className="relative flex flex-col gap-2 p-3">
              {/* Vertical gridlines aligned to the month ticks, behind the bars. */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                {window.ticks.map((tick) => (
                  <div
                    key={tick}
                    className="border-outline-variant/40 absolute inset-y-0 border-l"
                    style={{ left: `calc(${pct(tick, window)}% + 0.75rem)` }}
                  />
                ))}
              </div>

              {placed.map(({ bar, start, end }) => {
                const left = pct(start, window);
                const width = Math.max(pct(end, window) - left, 1.5);
                const spanCopy =
                  formatDate(bar.startDate) && formatDate(bar.targetDate)
                    ? `${formatDate(bar.startDate)} – ${formatDate(bar.targetDate)}`
                    : (formatDate(bar.startDate) ?? formatDate(bar.targetDate) ?? 'Unscheduled');
                return (
                  <li key={bar.id} className="relative h-8">
                    <button
                      type="button"
                      onClick={() => {
                        onOpenProject(bar.id);
                      }}
                      aria-label={`${bar.name} — ${statusLabel(bar.status)}, ${spanCopy}${
                        bar.health ? `, ${HEALTH_LABEL[bar.health]}` : ''
                      }`}
                      className={cn(
                        'focus-visible:ring-ring absolute top-0 flex h-8 min-w-0 items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium text-white shadow-sm transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
                        fillFor(bar.health),
                      )}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      <span className="truncate">{bar.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {unscheduled.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-on-surface-variant text-xs font-medium">Unscheduled</h3>
            <ul className="flex flex-wrap gap-2">
              {unscheduled.map((bar) => (
                <li key={bar.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenProject(bar.id);
                    }}
                    aria-label={`${bar.name} — ${statusLabel(bar.status)}, unscheduled${
                      bar.health ? `, ${HEALTH_LABEL[bar.health]}` : ''
                    }`}
                    className="border-outline-variant bg-surface-container-low hover:bg-surface-container-high focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span
                      aria-hidden="true"
                      className={cn('size-2 rounded-full', fillFor(bar.health))}
                    />
                    <span className="text-on-surface truncate">{bar.name}</span>
                    <span className="text-on-surface-variant">{statusLabel(bar.status)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
