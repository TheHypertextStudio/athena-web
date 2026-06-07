/**
 * Layout model for the Hub Portfolio roadmap.
 *
 * @remarks
 * Turns the raw {@link HubPortfolioOut} swimlanes into a render-ready model: per-org rows of
 * Program lanes (each holding its dated Project bars + an unscheduled tray) plus the org's
 * own program-less bars, with every Project's `[startDate, targetDate]` resolved to epoch-ms
 * endpoints once so the view never re-parses dates. A bar is *placeable* only when it carries
 * at least one date; a bar with a single date is anchored to a one-day span so it still draws
 * as a visible marker. Bars with no dates collect in an "unscheduled" tray rather than being
 * dropped, so the roadmap never silently hides work.
 *
 * The flattened set of placed bars is also exposed so the page can derive the shared
 * {@link import('./time-scale').TimeScale} from exactly what is on the timeline.
 */
import type { HubPortfolioSwimlane, HubProgramLane, HubProjectBar } from '@docket/types';

import type { Dated } from './time-scale';

/** A Project bar resolved to its on-axis span. */
export interface PlacedBar extends Dated {
  /** The originating project bar DTO. */
  readonly bar: HubProjectBar;
}

/** A Program lane's contents: its placeable bars + its undatable (tray) bars. */
export interface LaneRow {
  /** The program lane DTO (its program identity + status/health). */
  readonly lane: HubProgramLane;
  /** The lane's dated bars, ready to position. */
  readonly placed: readonly PlacedBar[];
  /** The lane's bars with no date — shown in the lane's unscheduled tray. */
  readonly unscheduled: readonly HubProjectBar[];
}

/** One org swimlane's render model: its program lanes + program-less bars. */
export interface SwimlaneRow {
  /** The swimlane's org chip. */
  readonly organization: HubPortfolioSwimlane['organization'];
  /** The org's program lanes (ongoing containers), each with its bars. */
  readonly lanes: readonly LaneRow[];
  /** Program-less project bars directly under the org, dated. */
  readonly placedDirect: readonly PlacedBar[];
  /** Program-less project bars with no date. */
  readonly unscheduledDirect: readonly HubProjectBar[];
  /** Total project bars contributed by this org (dated + unscheduled), for the focus chip. */
  readonly barCount: number;
}

/** Resolve a project bar's `[start, end]` span, or null when it carries no date. */
function resolveSpan(bar: HubProjectBar): { start: number; end: number } | null {
  const startMs = bar.startDate ? Date.parse(bar.startDate) : NaN;
  const targetMs = bar.targetDate ? Date.parse(bar.targetDate) : NaN;
  const hasStart = !Number.isNaN(startMs);
  const hasTarget = !Number.isNaN(targetMs);
  if (!hasStart && !hasTarget) return null;
  // Anchor against whichever endpoint(s) exist; order-normalize so start ≤ end.
  const a = hasStart ? startMs : targetMs;
  const b = hasTarget ? targetMs : startMs;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** Partition a set of bars into placed (dated) + unscheduled. */
function partition(bars: readonly HubProjectBar[]): {
  placed: PlacedBar[];
  unscheduled: HubProjectBar[];
} {
  const placed: PlacedBar[] = [];
  const unscheduled: HubProjectBar[] = [];
  for (const bar of bars) {
    const span = resolveSpan(bar);
    if (span) placed.push({ bar, start: span.start, end: span.end });
    else unscheduled.push(bar);
  }
  return { placed, unscheduled };
}

/** The full layout model: the swimlane rows + the flattened placed bars for the scale. */
export interface PortfolioLayout {
  /** The per-org swimlane render rows. */
  readonly rows: readonly SwimlaneRow[];
  /** Every placed (dated) bar across all swimlanes, for deriving the shared scale. */
  readonly allPlaced: readonly PlacedBar[];
  /** Whether any swimlane carries at least one bar (dated or not). */
  readonly hasAnyBars: boolean;
}

/**
 * Build the {@link PortfolioLayout} from the portfolio swimlanes.
 *
 * @param swimlanes - The `api.v1.hub.portfolio` swimlanes (already org-separated).
 * @returns the render-ready layout model.
 */
export function buildLayout(swimlanes: readonly HubPortfolioSwimlane[]): PortfolioLayout {
  const allPlaced: PlacedBar[] = [];
  let hasAnyBars = false;

  const rows: SwimlaneRow[] = swimlanes.map((swimlane) => {
    const lanes: LaneRow[] = swimlane.programs.map((lane) => {
      const { placed, unscheduled } = partition(lane.projects);
      allPlaced.push(...placed);
      if (lane.projects.length > 0) hasAnyBars = true;
      return { lane, placed, unscheduled };
    });

    const { placed: placedDirect, unscheduled: unscheduledDirect } = partition(swimlane.unassigned);
    allPlaced.push(...placedDirect);
    if (swimlane.unassigned.length > 0) hasAnyBars = true;

    const barCount =
      swimlane.unassigned.length +
      swimlane.programs.reduce((sum, lane) => sum + lane.projects.length, 0);

    return {
      organization: swimlane.organization,
      lanes,
      placedDirect,
      unscheduledDirect,
      barCount,
    };
  });

  return { rows, allPlaced, hasAnyBars };
}
