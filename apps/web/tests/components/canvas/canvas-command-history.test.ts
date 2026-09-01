/** `@docket/web` — route-scoped canvas command history tests. */
import type {
  ObjectCommandReceipt,
  ObjectCommandResult,
} from '../../../src/lib/contracts/object-command';
import { describe, expect, it } from 'vitest';

import {
  CanvasCommandHistory,
  narrowReceiptToResult,
} from '@/components/canvas/canvas-command-history';

function receipt(commandId: string, objectId = commandId): ObjectCommandReceipt {
  return {
    commandId,
    objectKind: 'task',
    action: 'trash',
    entries: [
      {
        kind: 'object',
        objectId,
        property: 'archivedAt',
        before: null,
        after: '2026-08-23T12:00:00.000Z',
      },
    ],
  };
}

describe('CanvasCommandHistory', () => {
  it('caps each route and scope at 50 receipts', () => {
    const history = new CanvasCommandHistory();
    for (let index = 0; index < 51; index += 1) {
      history.push('task:/orgs/o/graph:project-a', {
        label: `Trash ${String(index)}`,
        receipt: receipt(`command-${String(index)}`),
      });
    }

    expect(history.snapshot('task:/orgs/o/graph:project-a').undo).toHaveLength(50);
    expect(history.snapshot('task:/orgs/o/graph:project-a').undo[0]?.label).toBe('Trash 1');
  });

  it('isolates undo and redo stacks by canvas route and scope', () => {
    const history = new CanvasCommandHistory();
    history.push('task:/orgs/o/graph:project-a', { label: 'Trash Task', receipt: receipt('a') });
    history.push('project:/orgs/o/projects:all', {
      label: 'Trash Project',
      receipt: { ...receipt('b'), objectKind: 'project' },
    });

    const undone = history.takeUndo('task:/orgs/o/graph:project-a');
    expect(undone?.label).toBe('Trash Task');
    expect(history.snapshot('project:/orgs/o/projects:all').undo).toHaveLength(1);
    expect(history.snapshot('task:/orgs/o/graph:project-a').redo).toHaveLength(1);
  });
});

describe('narrowReceiptToResult', () => {
  it('keeps only replay entries that the server changed successfully', () => {
    const original: ObjectCommandReceipt = {
      ...receipt('original', 'task-a'),
      entries: [...receipt('a', 'task-a').entries, ...receipt('b', 'task-b').entries],
    };
    const result: ObjectCommandResult = {
      appliedIds: ['task-a'],
      conflictingIds: ['task-b'],
      deniedIds: [],
      receipt: { ...original, commandId: 'replay', entries: original.entries.slice(0, 1) },
    };

    expect(narrowReceiptToResult(original, result).entries).toEqual(original.entries.slice(0, 1));
  });
});
