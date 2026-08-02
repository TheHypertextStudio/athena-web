import { describe, expect, it } from 'vitest';

import {
  applySelectionIntent,
  EMPTY_SELECTION,
  intentFromClick,
  pruneSelection,
  resolveSelectionKey,
  type SelectionState,
} from '../../src/components/selection/selection-model';

/** Five rows, the smallest list that can prove a range is contiguous rather than an endpoint pair. */
const ORDER = ['task:1', 'task:2', 'task:3', 'task:4', 'task:5'];

/** Apply a run of intents from a starting state, for readable multi-gesture assertions. */
function run(
  intents: readonly Parameters<typeof applySelectionIntent>[1][],
  start: SelectionState = EMPTY_SELECTION,
): SelectionState {
  return intents.reduce((state, intent) => applySelectionIntent(state, intent, ORDER), start);
}

/** The selected keys, in view order, for stable comparison. */
function selectedKeys(state: SelectionState): string[] {
  return ORDER.filter((key) => state.selected.has(key));
}

describe('selection: modifier-click conventions', () => {
  it('selects exactly the contiguous run on shift-click', () => {
    const state = run([
      intentFromClick('task:1', { shiftKey: false, metaKey: false, ctrlKey: false }),
      intentFromClick('task:5', { shiftKey: true, metaKey: false, ctrlKey: false }),
    ]);
    expect(selectedKeys(state)).toEqual(ORDER);
    expect(state.selected.size).toBe(5);
  });

  it('toggles one row out of a range on cmd-click', () => {
    const state = run([
      intentFromClick('task:1', { shiftKey: false, metaKey: false, ctrlKey: false }),
      intentFromClick('task:5', { shiftKey: true, metaKey: false, ctrlKey: false }),
      intentFromClick('task:3', { shiftKey: false, metaKey: true, ctrlKey: false }),
    ]);
    expect(selectedKeys(state)).toEqual(['task:1', 'task:2', 'task:4', 'task:5']);
  });

  it('treats ctrl-click as cmd-click for Windows and Linux', () => {
    const state = run([
      intentFromClick('task:2', { shiftKey: false, metaKey: false, ctrlKey: true }),
      intentFromClick('task:4', { shiftKey: false, metaKey: false, ctrlKey: true }),
    ]);
    expect(selectedKeys(state)).toEqual(['task:2', 'task:4']);
  });

  it('lets shift win when both modifiers are held', () => {
    // Every platform file manager reads shift+cmd as "extend", never "toggle a range".
    expect(intentFromClick('task:3', { shiftKey: true, metaKey: true, ctrlKey: false })).toEqual({
      type: 'range',
      key: 'task:3',
    });
  });

  it('re-cuts the range from the same anchor on successive shift-clicks', () => {
    // The anchor is where a range extends *from*, not the last row touched: shift-clicking twice
    // must replace the range, not accumulate two of them.
    const state = run([
      intentFromClick('task:2', { shiftKey: false, metaKey: false, ctrlKey: false }),
      intentFromClick('task:5', { shiftKey: true, metaKey: false, ctrlKey: false }),
      intentFromClick('task:3', { shiftKey: true, metaKey: false, ctrlKey: false }),
    ]);
    expect(selectedKeys(state)).toEqual(['task:2', 'task:3']);
    expect(state.anchorKey).toBe('task:2');
  });

  it('cuts a range backwards as readily as forwards', () => {
    const state = run([
      intentFromClick('task:4', { shiftKey: false, metaKey: false, ctrlKey: false }),
      intentFromClick('task:2', { shiftKey: true, metaKey: false, ctrlKey: false }),
    ]);
    expect(selectedKeys(state)).toEqual(['task:2', 'task:3', 'task:4']);
  });

  it('replaces the whole selection on a plain click', () => {
    const state = run([
      intentFromClick('task:1', { shiftKey: false, metaKey: false, ctrlKey: false }),
      intentFromClick('task:5', { shiftKey: true, metaKey: false, ctrlKey: false }),
      intentFromClick('task:3', { shiftKey: false, metaKey: false, ctrlKey: false }),
    ]);
    expect(selectedKeys(state)).toEqual(['task:3']);
  });
});

describe('selection: keyboard operation', () => {
  const noModifiers = { shiftKey: false, metaKey: false, ctrlKey: false };

  it('moves the active row with arrows without selecting anything', () => {
    let state = applySelectionIntent(
      EMPTY_SELECTION,
      resolveSelectionKey({ key: 'ArrowDown', ...noModifiers }, EMPTY_SELECTION, ORDER).intent ?? {
        type: 'clear',
      },
      ORDER,
    );
    expect(state.activeKey).toBe('task:1');
    expect(state.selected.size).toBe(0);

    const next = resolveSelectionKey({ key: 'ArrowDown', ...noModifiers }, state, ORDER);
    state = applySelectionIntent(state, next.intent ?? { type: 'clear' }, ORDER);
    expect(state.activeKey).toBe('task:2');
  });

  it('extends the selection with shift+arrow', () => {
    let state: SelectionState = { selected: new Set(), anchorKey: null, activeKey: 'task:2' };
    for (let step = 0; step < 2; step += 1) {
      const resolution = resolveSelectionKey(
        { key: 'ArrowDown', shiftKey: true, metaKey: false, ctrlKey: false },
        state,
        ORDER,
      );
      expect(resolution.handled).toBe(true);
      state = applySelectionIntent(state, resolution.intent ?? { type: 'clear' }, ORDER);
    }
    expect(selectedKeys(state)).toEqual(['task:2', 'task:3', 'task:4']);
    expect(state.activeKey).toBe('task:4');
  });

  it('selects every row with cmd/ctrl+A', () => {
    for (const modifier of [
      { metaKey: true, ctrlKey: false },
      { metaKey: false, ctrlKey: true },
    ]) {
      const resolution = resolveSelectionKey(
        { key: 'a', shiftKey: false, ...modifier },
        EMPTY_SELECTION,
        ORDER,
      );
      expect(resolution.handled).toBe(true);
      const state = applySelectionIntent(
        EMPTY_SELECTION,
        resolution.intent ?? { type: 'clear' },
        ORDER,
      );
      expect(state.selected.size).toBe(ORDER.length);
    }
  });

  it('leaves a bare "a" to the surface so typeahead and search keep working', () => {
    expect(resolveSelectionKey({ key: 'a', ...noModifiers }, EMPTY_SELECTION, ORDER).handled).toBe(
      false,
    );
  });

  it('clears the selection with Escape', () => {
    const selected = run([intentFromClick('task:1', noModifiers)]);
    const resolution = resolveSelectionKey({ key: 'Escape', ...noModifiers }, selected, ORDER);
    expect(resolution.handled).toBe(true);
    const cleared = applySelectionIntent(selected, resolution.intent ?? { type: 'clear' }, ORDER);
    expect(cleared.selected.size).toBe(0);
  });

  it('leaves Escape to the surface when there is nothing to clear', () => {
    // Otherwise a list would swallow the Escape that should have closed the dialog around it.
    expect(
      resolveSelectionKey({ key: 'Escape', ...noModifiers }, EMPTY_SELECTION, ORDER).handled,
    ).toBe(false);
  });

  it('toggles the active row with Space and opens it with Enter', () => {
    const state: SelectionState = { selected: new Set(), anchorKey: null, activeKey: 'task:3' };
    const space = resolveSelectionKey({ key: ' ', ...noModifiers }, state, ORDER);
    expect(space.intent).toEqual({ type: 'toggle', key: 'task:3' });

    const enter = resolveSelectionKey({ key: 'Enter', ...noModifiers }, state, ORDER);
    expect(enter).toEqual({ intent: null, activate: true, handled: true });
  });

  it('jumps and extends to the ends with Home and End', () => {
    const state: SelectionState = { selected: new Set(), anchorKey: 'task:3', activeKey: 'task:3' };
    expect(resolveSelectionKey({ key: 'Home', ...noModifiers }, state, ORDER).intent).toEqual({
      type: 'move-active',
      key: 'task:1',
    });
    expect(
      resolveSelectionKey(
        { key: 'End', shiftKey: true, metaKey: false, ctrlKey: false },
        state,
        ORDER,
      ).intent,
    ).toEqual({ type: 'extend-active', key: 'task:5' });
  });

  it('clamps at the ends rather than wrapping', () => {
    const atTop: SelectionState = { selected: new Set(), anchorKey: null, activeKey: 'task:1' };
    expect(resolveSelectionKey({ key: 'ArrowUp', ...noModifiers }, atTop, ORDER).intent).toEqual({
      type: 'move-active',
      key: 'task:1',
    });
    const atBottom: SelectionState = { selected: new Set(), anchorKey: null, activeKey: 'task:5' };
    expect(
      resolveSelectionKey({ key: 'ArrowDown', ...noModifiers }, atBottom, ORDER).intent,
    ).toEqual({ type: 'move-active', key: 'task:5' });
  });

  it('handles nothing in an empty list', () => {
    expect(
      resolveSelectionKey({ key: 'ArrowDown', ...noModifiers }, EMPTY_SELECTION, []).handled,
    ).toBe(false);
  });
});

describe('selection: staying honest about what exists', () => {
  it('drops rows the view no longer renders', () => {
    // A selection that outlives its rows would let a bulk action operate on something invisible.
    const selected = run([
      intentFromClick('task:1', { shiftKey: false, metaKey: false, ctrlKey: false }),
      intentFromClick('task:5', { shiftKey: true, metaKey: false, ctrlKey: false }),
    ]);
    const pruned = pruneSelection(selected, ['task:1', 'task:2']);
    expect(selectedKeys(pruned)).toEqual(['task:1', 'task:2']);
    expect(pruned.activeKey).toBeNull();
  });

  it('returns the same state object when nothing changed', () => {
    const selected = run([
      intentFromClick('task:1', { shiftKey: false, metaKey: false, ctrlKey: false }),
    ]);
    expect(pruneSelection(selected, ORDER)).toBe(selected);
    expect(applySelectionIntent(selected, { type: 'move-active', key: 'task:1' }, ORDER)).toBe(
      selected,
    );
  });

  it('accepts a directly-set selection, e.g. a restored view state', () => {
    const state = applySelectionIntent(
      EMPTY_SELECTION,
      { type: 'set', keys: ['task:2', 'task:4', 'ghost:9'] },
      ORDER,
    );
    expect(selectedKeys(state)).toEqual(['task:2', 'task:4']);
  });
});
