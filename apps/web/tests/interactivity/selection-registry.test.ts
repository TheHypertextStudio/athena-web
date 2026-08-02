/**
 * The surface registry is the one seam that lets a document-level handler learn what a list has
 * selected. Every path through it is a failure a person would feel: a stale reader answering for
 * an unmounted list would offer to move rows that are no longer on screen, and a missing answer
 * where one exists would silently downgrade "Move 5 tasks…" to "Move this task…".
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { ObjectRef } from '../../src/lib/actions/object';
import {
  readSelectionSurface,
  readSelectionSurfaceFor,
  registerSelectionSurface,
  SELECTION_SURFACE_ATTRIBUTE,
  SELECTION_SURFACE_SELECTOR,
  type SelectionSurfaceSnapshot,
} from '../../src/components/selection/selection-registry';

const task: ObjectRef = { kind: 'task', id: '1', organizationId: 'org1', title: 'Task 1' };

/** A snapshot for `surfaceId`, selecting `objects`. */
function snapshot(
  surfaceId: string,
  objects: readonly ObjectRef[] = [task],
): SelectionSurfaceSnapshot {
  return { surfaceId, organizationId: 'org1', selectedObjects: objects };
}

const disposers: (() => void)[] = [];

/** Register a surface and remember its disposer, so no test leaks into the next. */
function register(surfaceId: string, read: () => SelectionSurfaceSnapshot): () => void {
  const dispose = registerSelectionSurface(surfaceId, read);
  disposers.push(dispose);
  return dispose;
}

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.innerHTML = '';
});

describe('selection surface registry', () => {
  it('reads the surface live, never a value cached at registration time', () => {
    let selected: readonly ObjectRef[] = [];
    register('tasks', () => snapshot('tasks', selected));

    expect(readSelectionSurface('tasks')?.selectedObjects).toEqual([]);
    selected = [task];
    expect(readSelectionSurface('tasks')?.selectedObjects).toEqual([task]);
  });

  it('answers null for an absent, unmounted, or unnamed surface', () => {
    expect(readSelectionSurface('never-mounted')).toBeNull();
    expect(readSelectionSurface(null)).toBeNull();
    expect(readSelectionSurface(undefined)).toBeNull();

    const dispose = register('tasks', () => snapshot('tasks'));
    expect(readSelectionSurface('tasks')).not.toBeNull();
    dispose();
    expect(readSelectionSurface('tasks')).toBeNull();
  });

  it('lets a remount win, and makes the old surface disposer a no-op', () => {
    // React can mount the replacement before it runs the outgoing effect's cleanup. If that stale
    // cleanup deleted the entry by id, the freshly mounted list would go unreachable and its
    // selection would stop reaching the right-click menu.
    const disposeFirst = register('tasks', () => snapshot('tasks', []));
    register('tasks', () => snapshot('tasks', [task]));

    disposeFirst();

    expect(readSelectionSurface('tasks')?.selectedObjects).toEqual([task]);
  });

  it('finds the surface containing any element inside it', () => {
    register('tasks', () => snapshot('tasks'));
    document.body.innerHTML = `
      <div ${SELECTION_SURFACE_ATTRIBUTE}="tasks">
        <div role="row"><a href="/tasks/1" id="title">Task 1</a></div>
      </div>`;

    const title = document.getElementById('title');
    expect(readSelectionSurfaceFor(title)?.selectedObjects).toEqual([task]);
    expect(document.querySelector(SELECTION_SURFACE_SELECTOR)).not.toBeNull();
  });

  it('answers null outside a surface, for a detached node, and for no element at all', () => {
    register('tasks', () => snapshot('tasks'));
    document.body.innerHTML = `<div id="loose">Not in a list</div>`;

    expect(readSelectionSurfaceFor(null)).toBeNull();
    expect(readSelectionSurfaceFor(document.getElementById('loose'))).toBeNull();
  });

  it('answers null when a container names a surface that is not mounted', () => {
    // The attribute is DOM state and the registry is module state; they can disagree mid-unmount.
    // The handler must degrade to "no selection here", never throw inside a `contextmenu` listener.
    document.body.innerHTML = `<div ${SELECTION_SURFACE_ATTRIBUTE}="ghost"><span id="row">x</span></div>`;
    expect(readSelectionSurfaceFor(document.getElementById('row'))).toBeNull();
  });
});
