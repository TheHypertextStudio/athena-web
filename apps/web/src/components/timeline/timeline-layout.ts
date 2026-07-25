/**
 * `timeline` — the layout model: turns an applied view into an ordered list of render tracks.
 *
 * @remarks
 * The canvas renders a single flat sequence of fixed-height tracks, each either a group band header
 * or a plottable row. Flattening here (rather than nesting in JSX) is what lets vertical position
 * be arithmetic — `sum of preceding track heights` — instead of a DOM measurement, which in turn
 * lets the dependency layer compute edge waypoints without reading layout, and lets the list be
 * windowed later without changing anything else.
 *
 * Grouping is honoured rather than discarded. The previous Projects lens flattened
 * `applied.groups` into bare rows, so choosing "Group by → Team" silently changed nothing on
 * screen; here a group produces a real band header track and its rows follow it.
 *
 * Rows with no dates are **partitioned out, not dropped**. They collect in the unscheduled tray so
 * the timeline never hides work, and — critically — they are never plotted at offset zero, which
 * is what made undated Projects read as broken rows in the old lens.
 */
import type { AppliedView } from '@/components/views/apply-view';
import type { ViewDisplayState } from '@/components/views/field-catalog';

import type { TimelineCatalog, TimelineSpan } from './timeline-catalog';
import { groupHeaderHeightFor, rowHeightFor } from './timeline-geometry';

/** A plottable row resolved to its on-axis span. */
export interface PlacedRow<T> {
  /** The originating row. */
  readonly row: T;
  /** The row's stable id. */
  readonly id: string;
  /** The row's resolved span. */
  readonly span: TimelineSpan;
}

/** A group band header track. */
export interface GroupTrack {
  /** Discriminator. */
  readonly kind: 'group';
  /** The group's stable bucket id. */
  readonly id: string;
  /** The group header label. */
  readonly label: string;
  /** How many plottable rows the band contains (shown as a count on the header). */
  readonly count: number;
  /** The track's vertical offset from the top of the canvas, in pixels. */
  readonly top: number;
  /** The track's height, in pixels. */
  readonly height: number;
}

/** A plottable row track. */
export interface RowTrack<T> {
  /** Discriminator. */
  readonly kind: 'row';
  /** The placed row. */
  readonly placed: PlacedRow<T>;
  /** The track's vertical offset from the top of the canvas, in pixels. */
  readonly top: number;
  /** The track's height, in pixels. */
  readonly height: number;
}

/** One rendered track: a group band header, or a plottable row. */
export type TimelineTrack<T> = GroupTrack | RowTrack<T>;

/** The render-ready layout: ordered tracks, the unscheduled remainder, and the canvas height. */
export interface TimelineLayout<T> {
  /** The ordered tracks, top to bottom. */
  readonly tracks: readonly TimelineTrack<T>[];
  /** Rows carrying no dates, surfaced in the tray rather than plotted. */
  readonly unscheduled: readonly T[];
  /** Every placed row, for deriving the viewport and resolving edges. */
  readonly placed: readonly PlacedRow<T>[];
  /** The total canvas height in pixels (the sum of every track height). */
  readonly height: number;
  /** Vertical offset of each placed row's track center, keyed by row id — for edge routing. */
  readonly centerById: ReadonlyMap<string, number>;
}

/**
 * Build the {@link TimelineLayout} for an applied view.
 *
 * @remarks
 * Consumes the same {@link AppliedView} the list lens renders, so filtering, sorting, and grouping
 * behave identically across lenses — switching lens changes the projection, never the population.
 *
 * @typeParam T - The row type.
 * @param applied - The filtered/sorted/grouped rows from `applyView`.
 * @param catalog - The page's timeline catalog.
 * @param display - The active presentation toggles (the sole source of track heights).
 * @returns the render-ready layout.
 */
export function buildTimelineLayout<T>(
  applied: AppliedView<T>,
  catalog: TimelineCatalog<T>,
  display: ViewDisplayState,
): TimelineLayout<T> {
  const rowHeight = rowHeightFor(display);
  const headerHeight = groupHeaderHeightFor(display);

  const tracks: TimelineTrack<T>[] = [];
  const unscheduled: T[] = [];
  const placed: PlacedRow<T>[] = [];
  const centerById = new Map<string, number>();
  let top = 0;

  const pushRows = (rows: readonly T[]): number => {
    let plotted = 0;
    for (const row of rows) {
      const span = catalog.span(row);
      if (!span) {
        unscheduled.push(row);
        continue;
      }
      const entry: PlacedRow<T> = { row, id: catalog.id(row), span };
      placed.push(entry);
      tracks.push({ kind: 'row', placed: entry, top, height: rowHeight });
      centerById.set(entry.id, top + rowHeight / 2);
      top += rowHeight;
      plotted += 1;
    }
    return plotted;
  };

  if (applied.groups) {
    for (const group of applied.groups) {
      // Reserve the band header's track before its rows so `top` stays monotonic, then backfill
      // the plotted count once the rows are known.
      const headerTop = top;
      top += headerHeight;
      const headerIndex = tracks.length;
      tracks.push({
        kind: 'group',
        id: group.id,
        label: group.label,
        count: 0,
        top: headerTop,
        height: headerHeight,
      });
      const plotted = pushRows(group.rows);
      tracks[headerIndex] = {
        kind: 'group',
        id: group.id,
        label: group.label,
        count: plotted,
        top: headerTop,
        height: headerHeight,
      };
    }
  } else {
    pushRows(applied.rows);
  }

  return { tracks, unscheduled, placed, height: top, centerById };
}
