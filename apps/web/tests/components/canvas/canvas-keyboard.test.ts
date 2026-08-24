/** `@docket/web` — canvas undo, redo, and destructive shortcut boundaries. */
import { describe, expect, it } from 'vitest';

import {
  isCanvasEditableTarget,
  resolveCanvasHistoryShortcut,
} from '@/components/canvas/canvas-keyboard';

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'z',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('resolveCanvasHistoryShortcut', () => {
  it('recognizes platform undo and both redo conventions', () => {
    expect(resolveCanvasHistoryShortcut(key({ metaKey: true }))).toBe('undo');
    expect(resolveCanvasHistoryShortcut(key({ ctrlKey: true }))).toBe('undo');
    expect(resolveCanvasHistoryShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(resolveCanvasHistoryShortcut(key({ key: 'y', ctrlKey: true }))).toBe('redo');
  });

  it('does not claim modified or unrelated shortcuts', () => {
    expect(resolveCanvasHistoryShortcut(key({ metaKey: true, altKey: true }))).toBeNull();
    expect(resolveCanvasHistoryShortcut(key({ key: 'k', metaKey: true }))).toBeNull();
  });
});

describe('isCanvasEditableTarget', () => {
  it('protects fields, editors, pickers, composers, and dialogs', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <input data-target="input" />
      <div contenteditable="true" data-target="editor"></div>
      <div role="dialog"><button data-target="dialog">Save</button></div>
      <div data-canvas-shortcuts="ignore"><button data-target="picker">Choose</button></div>
    `;
    for (const name of ['input', 'editor', 'dialog', 'picker']) {
      expect(isCanvasEditableTarget(host.querySelector(`[data-target="${name}"]`))).toBe(true);
    }
    expect(isCanvasEditableTarget(host)).toBe(false);
  });

  it('protects portaled picker listboxes and their options', () => {
    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    listbox.innerHTML = '<li role="option"><button data-target="option">Active</button></li>';
    document.body.append(listbox);

    expect(isCanvasEditableTarget(listbox)).toBe(true);
    expect(isCanvasEditableTarget(listbox.querySelector('[data-target="option"]'))).toBe(true);

    listbox.remove();
  });
});
