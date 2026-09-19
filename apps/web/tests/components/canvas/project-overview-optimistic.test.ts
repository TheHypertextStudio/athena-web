/** `@docket/web` — optimistic Project overview dependency patch tests. */
import { describe, expect, it } from 'vitest';

import type { ObjectCommandReceipt } from '../../../src/lib/contracts/object-command';
import type { ProjectOverviewItem } from '../../../src/lib/contracts/project';
import {
  applyProjectDependencyChange,
  projectDependencyChangesFromReceipt,
  type ProjectDependencyChange,
} from '../../../src/components/canvas/project-overview-optimistic';

function row(
  id: string,
  blockedByIds: string[] = [],
  blocksIds: string[] = [],
): ProjectOverviewItem {
  return { id, name: id, blockedByIds, blocksIds } as unknown as ProjectOverviewItem;
}

const ADD: ProjectDependencyChange = {
  type: 'add_dependency',
  blockingId: 'a',
  blockedId: 'b',
};

function receipt(
  action: ObjectCommandReceipt['action'],
  entries: ObjectCommandReceipt['entries'],
  objectKind: ObjectCommandReceipt['objectKind'] = 'project',
): ObjectCommandReceipt {
  return { commandId: 'command', objectKind, action, entries };
}

describe('applyProjectDependencyChange', () => {
  it('adds the edge to both endpoints and leaves other rows untouched', () => {
    const items = [row('a'), row('b'), row('c')];

    const next = applyProjectDependencyChange(items, ADD);

    expect(next[0]?.blocksIds).toEqual(['b']);
    expect(next[1]?.blockedByIds).toEqual(['a']);
    expect(next[2]).toBe(items[2]);
    expect(items[1]?.blockedByIds).toEqual([]);
  });

  it('is idempotent: applying the same add twice changes nothing more', () => {
    const once = applyProjectDependencyChange([row('a'), row('b')], ADD);
    const twice = applyProjectDependencyChange(once, ADD);

    expect(twice).toEqual(once);
    expect(twice[0]).toBe(once[0]);
    expect(twice[1]).toBe(once[1]);
  });

  it('removes the edge from both endpoints and tolerates an edge that is already gone', () => {
    const items = [row('a', [], ['b', 'x']), row('b', ['a', 'y'])];
    const remove = { ...ADD, type: 'remove_dependency' } as const;

    const next = applyProjectDependencyChange(items, remove);
    const again = applyProjectDependencyChange(next, remove);

    expect(next[0]?.blocksIds).toEqual(['x']);
    expect(next[1]?.blockedByIds).toEqual(['y']);
    expect(again[0]).toBe(next[0]);
    expect(again[1]).toBe(next[1]);
  });

  it('ignores rows that are filtered out of the overview', () => {
    const items = [row('a')];

    const next = applyProjectDependencyChange(items, ADD);

    expect(next[0]?.blocksIds).toEqual(['b']);
    expect(next).toHaveLength(1);
  });
});

describe('projectDependencyChangesFromReceipt', () => {
  const entries: ObjectCommandReceipt['entries'] = [
    {
      kind: 'relation',
      objectId: 'a',
      relation: 'dependency',
      relatedId: 'b',
      before: false,
      after: true,
    },
    {
      kind: 'relation',
      objectId: 'a',
      relation: 'label',
      relatedId: 'l',
      before: false,
      after: true,
    },
    { kind: 'object', objectId: 'a', property: 'status', before: 'x', after: 'y' },
  ];

  it('reads forward and redo receipts by their after value', () => {
    const forward = projectDependencyChangesFromReceipt(
      receipt('add_dependency', entries),
      'forward',
    );
    const redo = projectDependencyChangesFromReceipt(receipt('add_dependency', entries), 'redo');

    expect(forward).toEqual([ADD]);
    expect(redo).toEqual([ADD]);
  });

  it('reads an undo receipt by its before value, so undoing an add removes the edge', () => {
    expect(projectDependencyChangesFromReceipt(receipt('add_dependency', entries), 'undo')).toEqual(
      [{ type: 'remove_dependency', blockingId: 'a', blockedId: 'b' }],
    );
  });

  it('ignores task receipts and non-dependency entries', () => {
    expect(
      projectDependencyChangesFromReceipt(receipt('add_dependency', entries, 'task'), 'forward'),
    ).toEqual([]);
    expect(
      projectDependencyChangesFromReceipt(receipt('replace_property', entries.slice(1)), 'forward'),
    ).toEqual([]);
  });
});
