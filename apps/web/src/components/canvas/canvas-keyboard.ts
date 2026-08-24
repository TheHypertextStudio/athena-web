/** Keyboard interpretation shared by Project and Task graph canvases. */

const EDITABLE_TARGET_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="dialog"]',
  '[data-canvas-shortcuts="ignore"]',
].join(',');

/** A history action claimed by a platform undo or redo chord. */
export type CanvasHistoryShortcut = 'undo' | 'redo';

/** Return whether a keyboard target belongs to an editor, picker, composer, or dialog. */
export function isCanvasEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_TARGET_SELECTOR) !== null;
}

/** Resolve normal macOS and non-macOS undo and redo chords without inspecting user-agent state. */
export function resolveCanvasHistoryShortcut(event: KeyboardEvent): CanvasHistoryShortcut | null {
  if (event.altKey || (!event.metaKey && !event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) return 'redo';
  return null;
}
