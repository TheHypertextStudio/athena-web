/**
 * `lib/draggable` — the shared drag-source primitive every draggable surface spreads onto its root.
 *
 * @remarks
 * Two separate problems live here, and they have the same fix.
 *
 * **Selection.** Draggable rows and pointer-gesture cards sit over selectable text. Without
 * `user-select: none`, starting a drag first paints a native text selection that fights the gesture
 * and leaves stray highlights behind — the "dragging feels buggy" symptom. Chromium's UA stylesheet
 * already implies `user-select: none` for `draggable="true"` elements, but Firefox and Safari do
 * not, so {@link DRAGGABLE} states it explicitly rather than relying on one engine's default.
 *
 * **Reach.** A drag must start from *anywhere* inside the object's bounds — its icon, its badges,
 * its metadata — not just the strip of padding between its children. Native HTML5 drag already
 * behaves this way: a `draggable` ancestor starts its drag from presses on `<button>`, `<input>`,
 * and even `<a draggable={false}>` descendants. The one thing that genuinely breaks it is a child
 * calling `preventDefault()` on `mousedown`/`pointerdown`, which suppresses the drag before it
 * begins — measured, not assumed.
 *
 * {@link DRAGGABLE} deliberately omits `touch-none`: that belongs only on pointer-gesture handles
 * (applied locally there) and would break scrolling if spread onto a draggable list row.
 *
 * This module stays free of any domain vocabulary — it knows about DOM drag events and nothing
 * about initiatives, projects, or tasks. The typed payload written onto a drag lives in the app
 * (`@/lib/entity-drag`), so `@docket/ui` never learns Docket's object model.
 */
import type * as React from 'react';

/**
 * The class applied to the root of anything the user can drag.
 *
 * @remarks
 * Pairs selection suppression with the gesture's cursor. The row keeps `cursor-pointer` at rest
 * because its primary action is still *click to open* — a permanent `cursor-grab` would advertise
 * the wrong affordance. The cursor becomes `grabbing` only while the pointer is held down, so the
 * drag announces itself exactly when the user commits to it.
 */
export const DRAGGABLE = 'select-none active:cursor-grabbing';

/**
 * A mechanical drag source: what to write when the gesture starts, and how to clean up after.
 *
 * @remarks
 * Deliberately opaque about *what* is being dragged. Callers build one of these from their own
 * typed payload writer, so this primitive composes with any drag vocabulary.
 */
export interface DragSource {
  /** Write the drag payload onto the event's `dataTransfer`. */
  readonly onDragStart: (event: React.DragEvent) => void;
  /** Clear any drag-local UI state once the gesture ends (dropped or cancelled). */
  readonly onDragEnd?: (event: React.DragEvent) => void;
  /**
   * Whether this row may be dragged at all. Defaults to `true`; pass `false` for rows the viewer
   * cannot move (a cross-workspace reference, a read-only projection) so the row keeps its normal
   * text-selection behavior instead of pretending to be draggable.
   */
  readonly enabled?: boolean;
}

/** The DOM props a drag source contributes to a row root. */
export interface DragSourceProps {
  draggable: boolean;
  className: string;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd?: (event: React.DragEvent) => void;
}

/**
 * Turn a {@link DragSource} into props to spread onto any row root, whatever element it renders.
 *
 * @remarks
 * Returns `undefined` when there is no source or it is disabled, so a row can spread the result
 * unconditionally (`{...(dragSourceProps(drag) ?? {})}`) without branching. The returned
 * `className` must be merged by the caller (via `cn`) rather than overwriting the row's own
 * classes.
 *
 * @param source - The drag source, or `undefined` for a row that is not draggable.
 * @returns Props to spread, or `undefined` when the row should not be draggable.
 *
 * @example
 * ```tsx
 * const dragProps = dragSourceProps(drag);
 * <div {...dragProps} className={cn(rowClassName, dragProps?.className)} />
 * ```
 *
 * @see {@link DRAGGABLE} for the selection-suppression class this applies.
 */
export function dragSourceProps(source?: DragSource): DragSourceProps | undefined {
  if (!source || source.enabled === false) return undefined;
  return {
    draggable: true,
    className: DRAGGABLE,
    onDragStart: source.onDragStart,
    ...(source.onDragEnd ? { onDragEnd: source.onDragEnd } : {}),
  };
}
