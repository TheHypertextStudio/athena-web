/**
 * Behavior tests for the task-list nesting that places each subtask under its parent Task.
 */
import type { TaskOut } from '@docket/work/task-model';
import { describe, expect, it } from 'vitest';

import { nestTaskGroups, nestTaskRows } from '../../../src/components/views/task-table-hierarchy';

/** A task with only the fields nesting reads. */
function task(id: string, parentTaskId: string | null = null): TaskOut {
  return { id, parentTaskId } as unknown as TaskOut;
}

/** The ids of rows, in order. */
function ids(rows: readonly TaskOut[]): readonly string[] {
  return rows.map(({ id }) => id);
}

describe('nestTaskRows', () => {
  it('places children right after their parent and keeps sibling order', () => {
    const parent = task('parent');
    const childB = task('child-b', 'parent');
    const childA = task('child-a', 'parent');
    const grandchild = task('grandchild', 'child-a');
    const nested = nestTaskRows([childB, task('other'), parent, childA, grandchild]);

    expect(ids(nested.rows)).toEqual(['other', 'parent', 'child-b', 'child-a', 'grandchild']);
    expect(nested.positions.get(parent)).toMatchObject({ depth: 1, hasChildren: true });
    expect(nested.positions.get(childB)).toMatchObject({ depth: 2, isLastSibling: false });
    expect(nested.positions.get(childA)).toMatchObject({ depth: 2, isLastSibling: true });
    expect(nested.positions.get(grandchild)).toMatchObject({ depth: 3, posInSet: 1 });
    expect(nested.nested).toBe(true);
  });

  it('treats a subtask whose parent is not in the list as top level', () => {
    const orphan = task('orphan', 'elsewhere');
    const nested = nestTaskRows([orphan, task('root')]);

    expect(ids(nested.rows)).toEqual(['orphan', 'root']);
    expect(nested.positions.get(orphan)).toMatchObject({ depth: 1, posInSet: 1, setSize: 2 });
    expect(nested.nested).toBe(false);
  });

  it('keeps every task of a corrupt parent cycle visible', () => {
    const nested = nestTaskRows([task('a', 'b'), task('b', 'a')]);

    expect(ids(nested.rows)).toEqual(['a', 'b']);
  });
});

describe('nestTaskGroups', () => {
  it('nests within each group and leaves a cross-group subtask at the top of its own group', () => {
    const nested = nestTaskGroups([
      { id: 'm1', label: 'First', rows: [task('child', 'parent'), task('parent')] },
      {
        id: 'outer',
        label: 'Outer',
        children: [{ id: 'm2', label: 'Second', rows: [task('stray', 'parent')] }],
      },
    ]);

    const [first, outer] = nested.groups;
    const firstRows = first?.rows ?? [];
    const strayRows = outer?.children?.[0]?.rows ?? [];
    expect(ids(firstRows)).toEqual(['parent', 'child']);
    expect(ids(strayRows)).toEqual(['stray']);
    expect(firstRows.map((row) => nested.positions.get(row)?.depth)).toEqual([1, 2]);
    expect(strayRows.map((row) => nested.positions.get(row)?.depth)).toEqual([1]);
    expect(nested.nested).toBe(true);
  });

  it('gives a task that appears in two groups its own position in each', () => {
    // Grouping by label puts a task with two labels in both groups: nested in one, a root in the
    // other. Each occurrence must carry the depth of the group it renders in.
    const child = task('child', 'parent');
    const nested = nestTaskGroups([
      { id: 'label-a', label: 'A', rows: [task('parent'), child] },
      { id: 'label-b', label: 'B', rows: [child] },
    ]);

    const groupA = nested.groups[0]?.rows ?? [];
    const groupB = nested.groups[1]?.rows ?? [];
    expect(ids(groupA)).toEqual(['parent', 'child']);
    expect(ids(groupB)).toEqual(['child']);
    expect(groupA[1]).not.toBe(groupB[0]);
    expect(groupA.map((row) => nested.positions.get(row)?.depth)).toEqual([1, 2]);
    expect(groupB.map((row) => nested.positions.get(row)?.depth)).toEqual([1]);
  });

  it('reports a list with no subtasks as flat', () => {
    expect(nestTaskGroups([{ id: 'm1', label: 'First', rows: [task('a')] }]).nested).toBe(false);
  });
});
