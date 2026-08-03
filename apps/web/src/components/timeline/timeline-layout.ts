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
 * **Undated rows are rows.** They stay in the same ordered track list, at the same height, with the
 * same label cell and the same drag affordances — only their span is `null`, so the plot area
 * draws an empty schedulable lane instead of a bar. The previous model partitioned them into a
 * separate tray docked under the chart, which read as an unrelated island of chips and gave the
 * same object two different shapes depending on whether someone had typed a date yet. What it must
 * never do is plot them at offset zero, which is what made undated Projects look like broken rows
 * in the lens before that.
 *
 * Within each group (or the whole list when ungrouped) the dated rows come first in view order and
 * the undated ones follow, still in view order. This is the *only* re-ordering the model does, and
 * it is a property of the projection rather than of the query: on a time axis a row with no
 * position cannot be interleaved among rows that have one without reading as a gap in the chart.
 * The list lens, which has no such axis, keeps the view's order untouched.
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
  /** How many rows the band contains (shown as a count on the header). */
  readonly count: number;
  /** The track's vertical offset from the top of the canvas, in pixels. */
  readonly top: number;
  /** The track's height, in pixels. */
  readonly height: number;
}

/** A row track — one entity, dated or not. */
export interface RowTrack<T> {
  /** Discriminator. */
  readonly kind: 'row';
  /** The originating row. */
  readonly row: T;
  /** The row's stable id. */
  readonly id: string;
  /**
   * The row's resolved span, or `null` when it carries no dates.
   *
   * @remarks
   * `null` is a first-class state, not an error: the row still occupies a track of the ordinary
   * height with its ordinary label, and the plot area renders an empty schedulable lane.
   */
  readonly span: TimelineSpan | null;
  /** The track's vertical offset from the top of the canvas, in pixels. */
  readonly top: number;
  /** The track's height, in pixels. */
  readonly height: number;
}

/** One rendered track: a group band header, or a row. */
export type TimelineTrack<T> = GroupTrack | RowTrack<T>;

/** The render-ready layout: ordered tracks, the placed subset, and the canvas height. */
export interface TimelineLayout<T> {
  /** The ordered tracks, top to bottom. */
  readonly tracks: readonly TimelineTrack<T>[];
  /** Every dated row, for deriving the viewport and resolving edges. */
  readonly placed: readonly PlacedRow<T>[];
  /** How many rows carry no dates (for copy and empty-state hints). */
  readonly undatedCount: number;
  /** The total canvas height in pixels (the sum of every track height). */
  readonly height: number;
  /** Vertical offset of each row's track center, keyed by row id — for edge routing. */
  readonly centerById: ReadonlyMap<string, number>;
}

/**
 * Build the {@link TimelineLayout} for an applied view.
 *
 * @remarks
 * Consumes the same {@link AppliedView} the list lens renders, so filtering, sorting, and grouping
 * behave identically across lenses — switching lens changes the projection, never the population.
 * Row order is the view's order, with the dated rows of each bucket emitted before its undated
 * ones (see the module note for why that one re-ordering belongs to the projection).
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
  const placed: PlacedRow<T>[] = [];
  const centerById = new Map<string, number>();
  let undatedCount = 0;
  let top = 0;

  const pushRows = (rows: readonly T[]): number => {
    // Resolve every span once, then emit the dated rows before the undated ones. Two passes over
    // a resolved array rather than two calls to `catalog.span` per row.
    const resolved = rows.map((row) => ({ row, id: catalog.id(row), span: catalog.span(row) }));
    const emit = (entry: (typeof resolved)[number]): void => {
      if (entry.span) placed.push({ row: entry.row, id: entry.id, span: entry.span });
      else undatedCount += 1;
      tracks.push({
        kind: 'row',
        row: entry.row,
        id: entry.id,
        span: entry.span,
        top,
        height: rowHeight,
      });
      centerById.set(entry.id, top + rowHeight / 2);
      top += rowHeight;
    };
    for (const entry of resolved) if (entry.span) emit(entry);
    for (const entry of resolved) if (!entry.span) emit(entry);
    return resolved.length;
  };

  if (applied.groups) {
    for (const group of applied.groups) {
      // Reserve the band header's track before its rows so `top` stays monotonic, then backfill
      // the row count once the rows are known.
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
      const count = pushRows(group.rows);
      tracks[headerIndex] = {
        kind: 'group',
        id: group.id,
        label: group.label,
        count,
        top: headerTop,
        height: headerHeight,
      };
    }
  } else {
    pushRows(applied.rows);
  }

  return { tracks, placed, undatedCount, height: top, centerById };
}
