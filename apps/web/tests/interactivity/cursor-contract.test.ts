import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CURSOR_CLICKABLE,
  CURSOR_DISABLED,
  CURSOR_DRAGGABLE,
  CURSOR_DROP_STATE,
  interactionCursor,
} from '../../src/lib/actions/cursor';

describe('cursor contract', () => {
  it('names each affordance with the native cursor for it', () => {
    expect(CURSOR_CLICKABLE).toBe('cursor-pointer');
    expect(CURSOR_DRAGGABLE).toContain('cursor-grab');
    expect(CURSOR_DRAGGABLE).toContain('active:cursor-grabbing');
    expect(CURSOR_DISABLED).toBe('cursor-not-allowed');
    expect(CURSOR_DROP_STATE).toBe('data-[drop-state=reject]:cursor-no-drop');
  });

  it('follows the gesture through its whole lifecycle without JavaScript', () => {
    // grab at rest → grabbing while the pointer is down → grab again after the drop, expressed
    // purely in CSS so no sampled frame during a drag can report the resting cursor.
    const [rest, , pressed] = CURSOR_DRAGGABLE.split(' ');
    expect(rest).toBe('cursor-grab');
    expect(pressed).toBe('active:cursor-grabbing');
  });

  it('suppresses text selection on draggables', () => {
    // A drag that starts over selectable text paints a stray native selection first — the single
    // most common "dragging feels broken" symptom.
    expect(CURSOR_DRAGGABLE).toContain('select-none');
  });

  it('resolves an element that is more than one thing in a fixed precedence', () => {
    expect(interactionCursor({ clickable: true })).toBe(CURSOR_CLICKABLE);
    expect(interactionCursor({ draggable: true })).toBe(CURSOR_DRAGGABLE);
    // A draggable row is also clickable; the row as a whole is a thing you pick up, and its
    // navigation is carried by a link inside it that reports `pointer` on its own.
    expect(interactionCursor({ draggable: true, clickable: true })).toBe(CURSOR_DRAGGABLE);
    expect(interactionCursor({ draggable: true, clickable: true, disabled: true })).toBe(
      CURSOR_DISABLED,
    );
  });

  it('leaves a non-interactive element’s cursor inherited rather than forcing it', () => {
    expect(interactionCursor({})).toBe('');
  });
});

/** Every source file under the interaction contract's owned directories. */
function contractSources(): { path: string; source: string }[] {
  const roots = [
    'src/lib/actions',
    'src/components/dnd',
    'src/components/context-menu',
    'src/components/selection',
  ];
  const files: { path: string; source: string }[] = [];
  for (const root of roots) {
    for (const entry of readdirSync(root)) {
      const path = join(root, entry);
      if (!statSync(path).isFile()) continue;
      if (!/\.tsx?$/.test(entry)) continue;
      files.push({ path, source: readFileSync(path, 'utf8') });
    }
  }
  return files;
}

describe('interaction contract never signals with size', () => {
  it('uses no scale transform on any interactive state', () => {
    // Scaling on hover/press changes an element's measured box, which is exactly what a control
    // must never do — and it is the affordance the cursor already carries honestly.
    const offenders = contractSources().filter(({ source }) =>
      /(?:hover|active|focus|group-hover|focus-visible):scale-|whileTap|whileHover|transform:\s*scale\(/.test(
        source,
      ),
    );
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });

  it('reveals hover-only affordances with opacity, never by adding them to the layout', () => {
    // The checkbox column is laid out at all times; only its opacity changes, so revealing it
    // cannot reflow the row's contents sideways under the pointer.
    const checkbox = readFileSync('src/components/selection/selection-checkbox.tsx', 'utf8');
    expect(checkbox).toContain('opacity-0 group-hover/row:opacity-100');
    expect(checkbox).toContain('size-4 shrink-0');
  });
});
