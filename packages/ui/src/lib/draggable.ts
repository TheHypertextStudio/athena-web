/**
 * `lib/draggable` — the class applied to the root of anything the user can drag.
 *
 * @remarks
 * Draggable rows and pointer-gesture cards sit over selectable text. Without this, starting a drag
 * first paints a native text selection that fights the gesture and leaves stray highlights behind —
 * the "dragging feels buggy" symptom. `user-select: none` inherits, so putting {@link DRAGGABLE} on
 * a draggable root suppresses selection across the whole object in one place.
 *
 * It deliberately omits `touch-none`: that belongs only on pointer-gesture handles (applied locally
 * there) and would break scrolling if spread onto a draggable list row.
 */
export const DRAGGABLE = 'select-none';
