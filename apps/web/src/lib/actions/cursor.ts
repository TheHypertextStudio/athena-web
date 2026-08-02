/**
 * `lib/actions/cursor` — the app's cursor contract.
 *
 * @remarks
 * The cursor is the only affordance the app gets for free from the operating system, and it is the
 * one users read without thinking. The rule Docket holds itself to is that the cursor always names
 * the *most applicable* thing the pointer can do right now:
 *
 * | State                              | Cursor      | Why |
 * | ---------------------------------- | ----------- | --- |
 * | A control that performs one action | `pointer`   | Buttons, links, tabs, menu items. |
 * | An object you can pick up          | `grab`      | The whole object moves, not one action. |
 * | …while the pointer is down on it   | `grabbing`  | The gesture has been committed to. |
 * | A drop target that refuses this    | `no-drop`   | Releasing here does nothing. |
 * | A control that exists but is off   | `not-allowed` | Present, deliberate, unavailable. |
 * | Text                               | `text`      | Native selection is the affordance. |
 *
 * **Precedence, when an element is more than one of these.** A draggable list row is also
 * clickable, and the two rules disagree. Docket resolves it in favour of `grab`: the row *as a
 * whole* is a thing you pick up, and its navigational affordance is expressed by a real
 * `<a href>` on the title — which is both better semantics (a link is keyboard-operable and
 * middle-clickable for free) and a deeper element, so hovering the title correctly reports
 * `pointer` while hovering the row reports `grab`. A row that opens via a bare `onClick` on its
 * container has no way to express both and must not be built.
 *
 * **Never signal interactivity by changing size.** These are cursor and colour changes only. No
 * hover/active `scale`, no size-changing transform — a control must measure identically at rest,
 * on hover, on focus, and while pressed.
 *
 * Every class here is a static Tailwind literal so the extractor sees it; nothing is composed at
 * runtime from fragments.
 */

/** A control whose click performs one action: buttons, links, tabs, menu items, checkboxes. */
export const CURSOR_CLICKABLE = 'cursor-pointer' as const;

/**
 * An object the pointer can pick up.
 *
 * @remarks
 * Pairs the resting `grab` with the pressed `grabbing`, so the cursor follows the gesture through
 * its whole lifecycle without any JavaScript: `grab` at rest → `grabbing` from pointer-down
 * through the drag → `grab` again after the drop. `select-none` is bundled in because a drag that
 * begins over selectable text paints a stray native selection first, which is the single most
 * common "dragging feels broken" symptom.
 */
export const CURSOR_DRAGGABLE = 'cursor-grab select-none active:cursor-grabbing' as const;

/** Content whose affordance is native text selection. */
export const CURSOR_TEXT = 'cursor-text' as const;

/** A control that is present and deliberate but currently unavailable. */
export const CURSOR_DISABLED = 'cursor-not-allowed' as const;

/**
 * A drop target's cursor, driven by its `data-drop-state` attribute.
 *
 * @remarks
 * The browser already shows a rejecting cursor when a `dragover` handler sets
 * `dataTransfer.dropEffect = 'none'`, but that is invisible to `getComputedStyle`, so the app
 * states it in CSS as well. Both paths agree, and the refusal is assertable in a test.
 */
export const CURSOR_DROP_STATE = 'data-[drop-state=reject]:cursor-no-drop' as const;

/** The interaction states an element can be in, in precedence order. */
export interface InteractionCursorState {
  /** The element is present but currently unavailable. Wins over everything. */
  readonly disabled?: boolean;
  /** The element can be picked up and moved. Wins over `clickable`. */
  readonly draggable?: boolean;
  /** Clicking the element performs one action. */
  readonly clickable?: boolean;
}

/**
 * Resolve the cursor class for an element's interaction state.
 *
 * @remarks
 * Returns the empty string when an element is none of these, so a caller can pass the result
 * straight to `cn` without branching and the element keeps its inherited cursor rather than being
 * forced to `default`.
 *
 * @param state - Which affordances the element currently has.
 * @returns The Tailwind class string, or `''` for a non-interactive element.
 *
 * @example
 * ```tsx
 * <div className={cn('flex h-10 items-center', interactionCursor({ draggable: canDrag }))} />
 * ```
 */
export function interactionCursor(state: InteractionCursorState): string {
  if (state.disabled === true) return CURSOR_DISABLED;
  if (state.draggable === true) return CURSOR_DRAGGABLE;
  if (state.clickable === true) return CURSOR_CLICKABLE;
  return '';
}
