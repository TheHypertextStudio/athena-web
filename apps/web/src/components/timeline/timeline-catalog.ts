/**
 * `timeline` — the reusable, typed **timeline catalog**: how any entity declares itself plottable.
 *
 * @remarks
 * This mirrors what `views/field-catalog.ts` did for filtering. That module let a page declare its
 * fields once and drop in the shared toolbar; this one lets a page declare how its rows map onto a
 * time axis and drop in the shared timeline — bars, markers, dependency edges, zoom, and
 * drag-to-schedule included. A new temporal surface writes a catalog and a data fetch, never a new
 * timeline.
 *
 * The catalog is **pure**: every member is a plain function of a row. It holds no React state,
 * issues no requests, and owns no mutation. Writes are surfaced as callbacks on the canvas
 * component instead, which keeps the catalog trivially unit-testable and keeps a data-layer
 * dependency from leaking into what is fundamentally a projection.
 *
 * Colour arrives as a semantic {@link TimelineTint} rather than a domain enum, so the engine never
 * learns what "health" is; a consumer maps its own vocabulary onto the four tones.
 */

import type { DragSource } from '@docket/ui/lib/draggable';

/** A resolved on-axis span in epoch milliseconds. */
export interface TimelineSpan {
  /** The span start in epoch milliseconds. */
  readonly start: number;
  /** The span end in epoch milliseconds (equal to `start` for a single-date anchor). */
  readonly end: number;
}

/** A dated checkpoint drawn along a bar. */
export interface TimelineMarker {
  /** Stable marker id. */
  readonly id: string;
  /** The marker name, shown on hover. */
  readonly name: string;
  /** The marker's position in epoch milliseconds. */
  readonly at: number;
}

/** A row's dependency relationships, as ids of other rows. */
export interface TimelineEdges {
  /** Rows that must finish before this row can proceed. */
  readonly blockedBy: readonly string[];
  /** Rows that cannot proceed until this row finishes. */
  readonly blocks: readonly string[];
}

/**
 * The semantic tone a bar is drawn in.
 *
 * @remarks
 * Intentionally domain-free. A consumer maps its own vocabulary (Project health, Program status, a
 * risk score) onto these four tones, so the engine carries no knowledge of any one entity's
 * semantics and every timeline in the product reads with the same colour language.
 */
export type TimelineTint = 'positive' | 'caution' | 'critical' | 'neutral';

/**
 * Declares how rows of type `T` project onto a time axis.
 *
 * @typeParam T - The row type (e.g. `ProjectOverviewItem`).
 */
export interface TimelineCatalog<T> {
  /** Stable row identity — used for keys, edge routing, and view transitions. */
  id: (row: T) => string;
  /** The single-line display name shown in the label column and inside the bar. */
  label: (row: T) => string;
  /**
   * Secondary context for the label column (a Team, a Program), or `null` when there is none.
   *
   * @remarks
   * Rendered muted on the *same* line as the label, never as a second line — a second line would
   * make row height depend on whether an individual row happened to have context, which the
   * geometry model forbids. Callers that have no secondary dimension return `null`.
   */
  sublabel: (row: T) => string | null;
  /** The row's deep link. */
  href: (row: T) => string;
  /**
   * The row's on-axis span, or `null` when it carries no dates.
   *
   * @remarks
   * A `null` span is *not* an error and must never be dropped: the canvas routes those rows to the
   * unscheduled tray, where they stay reachable and can be dragged onto the axis.
   */
  span: (row: T) => TimelineSpan | null;
  /**
   * Optional semantic span copy for accessible bar descriptions.
   *
   * @remarks
   * Planning rows use this to say `Q3 2026 to December 2026` while geometry remains on the
   * canonical boundary dates. Other timelines omit it and receive the engine's day formatter.
   */
  spanLabel?: ((row: T) => string | null) | undefined;
  /** The row's dated checkpoints. Undated checkpoints are the catalog's to filter out. */
  markers: (row: T) => readonly TimelineMarker[];
  /** The row's semantic tone. */
  tint: (row: T) => TimelineTint;
  /** Completion in the range 0–1, or `null` when the row has no measurable progress. */
  progress: (row: T) => number | null;
  /** The row's dependency relationships. */
  edges: (row: T) => TimelineEdges;
  /** A short status word for the row, used in accessible descriptions and tray chips. */
  statusLabel: (row: T) => string;
  /**
   * How this row is dragged *as an object* (onto a calendar, another surface), or `null` when it
   * is not draggable.
   *
   * @remarks
   * Applied to the row's **label cell**, never to its bar. The bar owns a pointer-driven drag that
   * reschedules it, and a native HTML5 `draggable` on the same element would pre-empt those
   * pointer events — the two gestures cannot share one target. Splitting them is also the honest
   * division: the label is the row's identity handle, the bar is its schedule.
   *
   * `DragSource` is the design system's domain-free primitive, so the engine still learns nothing
   * about what any consumer's rows actually are.
   */
  dragSource: (row: T) => DragSource | null;
}

/**
 * Resolve a start/target date pair into a span, tolerating a missing endpoint.
 *
 * @remarks
 * Shared by every catalog because the rule is the same everywhere and easy to get subtly wrong.
 * A row with only one date is anchored to that instant (`start === end`) rather than being treated
 * as unscheduled — it *does* have a position, and the canvas renders it as a point-in-time marker
 * instead of stretching it into a misleading span. Endpoints are order-normalized so a target
 * before a start still yields a drawable span rather than a negative width.
 *
 * @param start - The start instant in epoch ms, or `null`.
 * @param end - The target instant in epoch ms, or `null`.
 * @returns the resolved span, or `null` when neither date is present.
 */
export function resolveSpan(start: number | null, end: number | null): TimelineSpan | null {
  if (start === null) return end === null ? null : { start: end, end };
  if (end === null) return { start, end: start };
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/** Whether a span covers a single instant (a point-in-time anchor rather than a duration). */
export function isAnchor(span: TimelineSpan): boolean {
  return span.start === span.end;
}
