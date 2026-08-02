/**
 * `components/selection/selection-model` — the pure rules of multi-select.
 *
 * @remarks
 * Every list-like view in Docket selects the same way, so the rules live in one pure module that
 * knows nothing about React or the DOM. What a click or a keystroke *means* is decided here; where
 * the pixels are is decided by {@link ./selection-context}.
 *
 * The conventions are the platform ones, not invented ones — people arrive already knowing them
 * from Finder, Explorer, Gmail and every mail client since:
 *
 * | Gesture                 | Meaning |
 * | ----------------------- | ------- |
 * | Click                   | Select only this; it becomes the anchor. |
 * | ⌘/Ctrl + Click          | Toggle this one, leaving the rest alone. |
 * | Shift + Click           | Select the contiguous run from the anchor to here. |
 * | ↑ / ↓                   | Move the active row. |
 * | Shift + ↑ / ↓           | Extend the run from the anchor to the new active row. |
 * | Home / End (+ Shift)    | Jump to, or extend to, the ends. |
 * | ⌘/Ctrl + A              | Select everything in the view. |
 * | Space                   | Toggle the active row. |
 * | Enter                   | Open the active row. |
 * | Escape                  | Clear the selection. |
 *
 * The anchor is the subtle part: it is *not* the last row touched, it is the row a range extends
 * *from*. Clicking sets it; ⌘-clicking moves it to the toggled row; shift-clicking leaves it alone
 * so successive shift-clicks re-cut the same range rather than accumulating.
 */

/** A selection's complete state, keyed by `objectKey` values. */
export interface SelectionState {
  /** The selected object keys. */
  readonly selected: ReadonlySet<string>;
  /** The key a range extends from, or `null` when there is no anchor yet. */
  readonly anchorKey: string | null;
  /** The keyboard-active row, or `null` when focus has not entered the list. */
  readonly activeKey: string | null;
}

/** The empty selection. */
export const EMPTY_SELECTION: SelectionState = {
  selected: new Set<string>(),
  anchorKey: null,
  activeKey: null,
};

/** Every way a selection can change. */
export type SelectionIntent =
  /** Select only this key; it becomes the anchor and the active row. */
  | { readonly type: 'replace'; readonly key: string }
  /** Add or remove this key without disturbing the rest; it becomes the anchor. */
  | { readonly type: 'toggle'; readonly key: string }
  /** Select the contiguous run from the anchor to this key. */
  | { readonly type: 'range'; readonly key: string }
  /** Move the active row without changing what is selected. */
  | { readonly type: 'move-active'; readonly key: string }
  /** Move the active row and extend the run from the anchor to it. */
  | { readonly type: 'extend-active'; readonly key: string }
  /** Select every key in the view. */
  | { readonly type: 'select-all' }
  /** Select exactly these keys (a surface restoring persisted state, or a "select none/all" bar). */
  | { readonly type: 'set'; readonly keys: readonly string[] }
  /** Clear the selection, leaving the active row where it is. */
  | { readonly type: 'clear' };

/** Keys between `from` and `to` inclusive, in view order, tolerating either direction. */
function runBetween(order: readonly string[], from: string, to: string): string[] {
  const start = order.indexOf(from);
  const end = order.indexOf(to);
  if (start === -1 || end === -1) return end === -1 ? [] : [to];
  const [low, high] = start <= end ? [start, end] : [end, start];
  return order.slice(low, high + 1);
}

/** Whether two selections hold the same keys. */
function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/**
 * Apply one intent to a selection.
 *
 * @remarks
 * Returns the *same* state object when nothing changed, so a React store using it re-renders only
 * on a real change (arrowing onto an already-active row, clearing an empty selection).
 *
 * Keys that are no longer in `order` are dropped from the result: a list that refetches and loses
 * a row must not keep it selected, or a bulk action would operate on something the user can no
 * longer see.
 *
 * @param state - The current selection.
 * @param intent - What happened.
 * @param order - Every selectable key in the view, in the order it is rendered.
 * @returns The next selection state.
 */
export function applySelectionIntent(
  state: SelectionState,
  intent: SelectionIntent,
  order: readonly string[],
): SelectionState {
  const next = computeNext(state, intent, order);
  const pruned = pruneToOrder(next, order);
  return sameState(state, pruned) ? state : pruned;
}

/** The raw transition, before pruning and identity-preservation. */
function computeNext(
  state: SelectionState,
  intent: SelectionIntent,
  order: readonly string[],
): SelectionState {
  switch (intent.type) {
    case 'replace':
      return { selected: new Set([intent.key]), anchorKey: intent.key, activeKey: intent.key };

    case 'toggle': {
      const selected = new Set(state.selected);
      if (selected.has(intent.key)) selected.delete(intent.key);
      else selected.add(intent.key);
      return { selected, anchorKey: intent.key, activeKey: intent.key };
    }

    case 'range': {
      const anchor = state.anchorKey ?? state.activeKey ?? order[0] ?? intent.key;
      return {
        selected: new Set(runBetween(order, anchor, intent.key)),
        anchorKey: anchor,
        activeKey: intent.key,
      };
    }

    case 'move-active':
      return { ...state, activeKey: intent.key };

    case 'extend-active': {
      const anchor = state.anchorKey ?? state.activeKey ?? intent.key;
      return {
        selected: new Set(runBetween(order, anchor, intent.key)),
        anchorKey: anchor,
        activeKey: intent.key,
      };
    }

    case 'select-all':
      return {
        selected: new Set(order),
        anchorKey: state.anchorKey ?? order[0] ?? null,
        activeKey: state.activeKey ?? order[0] ?? null,
      };

    case 'set': {
      const selected = new Set(intent.keys);
      return {
        selected,
        anchorKey:
          state.anchorKey !== null && selected.has(state.anchorKey)
            ? state.anchorKey
            : (intent.keys[0] ?? null),
        activeKey: state.activeKey,
      };
    }

    case 'clear':
      return { selected: new Set<string>(), anchorKey: null, activeKey: state.activeKey };
  }
}

/**
 * Drop keys the view no longer renders, preserving object identity when nothing changed.
 *
 * @remarks
 * Called by a surface whenever its item list changes (a refetch, a filter, a search). Without it a
 * row that scrolls out of existence stays selected, and a bulk action then operates on something
 * the user cannot see — the exact class of silent wrongness the reliability bar forbids.
 *
 * @param state - The current selection.
 * @param order - Every selectable key the view now renders.
 * @returns The pruned selection, or `state` itself when nothing needed dropping.
 */
export function pruneSelection(state: SelectionState, order: readonly string[]): SelectionState {
  const pruned = pruneToOrder(state, order);
  return sameState(state, pruned) ? state : pruned;
}

/** Drop keys the view no longer renders. */
function pruneToOrder(state: SelectionState, order: readonly string[]): SelectionState {
  const known = new Set(order);
  const selected = new Set([...state.selected].filter((key) => known.has(key)));
  return {
    selected,
    anchorKey: state.anchorKey !== null && known.has(state.anchorKey) ? state.anchorKey : null,
    activeKey: state.activeKey !== null && known.has(state.activeKey) ? state.activeKey : null,
  };
}

/** Whether two states are equivalent by value. */
function sameState(a: SelectionState, b: SelectionState): boolean {
  return (
    a.anchorKey === b.anchorKey && a.activeKey === b.activeKey && sameKeys(a.selected, b.selected)
  );
}

/** The modifier state a pointer gesture carries. */
export interface SelectionPointerModifiers {
  /** Whether Shift was held. */
  readonly shiftKey: boolean;
  /** Whether ⌘ was held (macOS). */
  readonly metaKey: boolean;
  /** Whether Ctrl was held (Windows/Linux, and macOS right-click emulation). */
  readonly ctrlKey: boolean;
}

/**
 * Translate a click on a row into a selection intent.
 *
 * @remarks
 * Shift wins over ⌘/Ctrl when both are held, matching every platform file manager: the combination
 * means "extend", not "toggle a range".
 *
 * @param key - The clicked row's object key.
 * @param modifiers - Which modifiers the click carried.
 * @returns The intent to apply.
 */
export function intentFromClick(
  key: string,
  modifiers: SelectionPointerModifiers,
): SelectionIntent {
  if (modifiers.shiftKey) return { type: 'range', key };
  if (modifiers.metaKey || modifiers.ctrlKey) return { type: 'toggle', key };
  return { type: 'replace', key };
}

/** The keyboard event fields the selection model reads. */
export interface SelectionKeyEvent {
  /** The pressed key value. */
  readonly key: string;
  /** Whether Shift was held. */
  readonly shiftKey: boolean;
  /** Whether ⌘ was held. */
  readonly metaKey: boolean;
  /** Whether Ctrl was held. */
  readonly ctrlKey: boolean;
}

/** What a keystroke means to a list. */
export interface SelectionKeyResolution {
  /** The selection change to apply, or `null` when the keystroke only opens a row. */
  readonly intent: SelectionIntent | null;
  /** Whether the keystroke should open the active row. */
  readonly activate: boolean;
  /** Whether the list handled the keystroke and should call `preventDefault`. */
  readonly handled: boolean;
}

/** Nothing happened. */
const UNHANDLED: SelectionKeyResolution = { intent: null, activate: false, handled: false };

/**
 * Translate a keystroke into a selection intent.
 *
 * @remarks
 * Pure and total: the caller passes the current state and the rendered order, and gets back what
 * to do. That makes the entire keyboard contract — including range extension, select-all, and
 * clearing — testable without a DOM.
 *
 * @param event - The keystroke.
 * @param state - The current selection.
 * @param order - Every selectable key in the view, in render order.
 * @returns What the list should do about it.
 */
export function resolveSelectionKey(
  event: SelectionKeyEvent,
  state: SelectionState,
  order: readonly string[],
): SelectionKeyResolution {
  if (order.length === 0) return UNHANDLED;
  const activeIndex = state.activeKey === null ? -1 : order.indexOf(state.activeKey);
  const modified = event.metaKey || event.ctrlKey;

  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const target =
        activeIndex === -1
          ? step === 1
            ? 0
            : order.length - 1
          : Math.min(order.length - 1, Math.max(0, activeIndex + step));
      const key = order[target];
      if (key === undefined) return UNHANDLED;
      return {
        intent: { type: event.shiftKey ? 'extend-active' : 'move-active', key },
        activate: false,
        handled: true,
      };
    }

    case 'Home':
    case 'End': {
      const key = event.key === 'Home' ? order[0] : order[order.length - 1];
      if (key === undefined) return UNHANDLED;
      return {
        intent: { type: event.shiftKey ? 'extend-active' : 'move-active', key },
        activate: false,
        handled: true,
      };
    }

    case 'a':
    case 'A': {
      if (!modified) return UNHANDLED;
      return { intent: { type: 'select-all' }, activate: false, handled: true };
    }

    case ' ':
    case 'Spacebar': {
      if (state.activeKey === null) return UNHANDLED;
      return { intent: { type: 'toggle', key: state.activeKey }, activate: false, handled: true };
    }

    case 'Enter': {
      if (state.activeKey === null) return UNHANDLED;
      return { intent: null, activate: true, handled: true };
    }

    case 'Escape': {
      if (state.selected.size === 0) return UNHANDLED;
      return { intent: { type: 'clear' }, activate: false, handled: true };
    }

    default:
      return UNHANDLED;
  }
}
