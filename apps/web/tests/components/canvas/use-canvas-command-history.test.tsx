import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ObjectCommandIn, ObjectCommandReceipt, ObjectCommandResult } from '@docket/types';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@/lib/query', () => ({
  unwrap: vi.fn(),
  useApiMutation: () => ({ mutateAsync, isPending: false }),
}));

import { useCanvasCommandHistory } from '@/components/canvas/use-canvas-command-history';

function objectReceipt(
  commandId: string,
  action: ObjectCommandReceipt['action'],
  objectIds: readonly string[],
): ObjectCommandReceipt {
  return {
    commandId,
    objectKind: 'task',
    action,
    entries: objectIds.map((objectId) => ({
      kind: 'object' as const,
      objectId,
      property: action === 'trash' ? 'archivedAt' : 'priority',
      before: action === 'trash' ? null : 'none',
      after: action === 'trash' ? '2026-08-24T12:00:00.000Z' : 'high',
    })),
  };
}

function commandResult(receipt: ObjectCommandReceipt): ObjectCommandResult {
  return {
    appliedIds: receipt.entries.map(({ objectId }) => objectId),
    conflictingIds: [],
    deniedIds: [],
    receipt,
  };
}

describe('useCanvasCommandHistory', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
  });

  it('offers Undo after a bulk property change', async () => {
    const receipt = objectReceipt('bulk-priority', 'replace_property', ['task-a', 'task-b']);
    mutateAsync.mockResolvedValueOnce(commandResult(receipt));
    const { result } = renderHook(() =>
      useCanvasCommandHistory('org-1', 'bulk-property-review', []),
    );

    await act(async () => {
      await result.current.execute(
        {
          commandId: receipt.commandId,
          objectKind: 'task',
          objectIds: ['task-a', 'task-b'],
          operation: { type: 'replace_property', property: 'priority', value: 'high' },
        } as ObjectCommandIn,
        'Change priority',
      );
    });

    expect(result.current.notice).toMatchObject({ offerUndo: true });
  });

  it('offers Undo after a bulk association change', async () => {
    const receipt: ObjectCommandReceipt = {
      commandId: 'bulk-label',
      objectKind: 'task',
      action: 'add_association',
      entries: ['task-a', 'task-b'].map((objectId) => ({
        kind: 'relation' as const,
        objectId,
        relation: 'label' as const,
        relatedId: 'label-a',
        before: false,
        after: true,
      })),
    };
    mutateAsync.mockResolvedValueOnce(commandResult(receipt));
    const { result } = renderHook(() =>
      useCanvasCommandHistory('org-1', 'bulk-association-review', []),
    );

    await act(async () => {
      await result.current.execute(
        {
          commandId: receipt.commandId,
          objectKind: 'task',
          objectIds: ['task-a', 'task-b'],
          operation: {
            type: 'add_association',
            association: 'label',
            associationIds: ['label-a'],
          },
        } as ObjectCommandIn,
        'Add label',
      );
    });

    expect(result.current.notice).toMatchObject({ offerUndo: true });
  });

  it('does not consume an older receipt while an Undo replay is pending', async () => {
    const first = objectReceipt('trash-first', 'trash', ['task-first']);
    const second = objectReceipt('trash-second', 'trash', ['task-second']);
    mutateAsync
      .mockResolvedValueOnce(commandResult(first))
      .mockResolvedValueOnce(commandResult(second));
    const { result } = renderHook(() =>
      useCanvasCommandHistory('org-1', 'pending-replay-review', []),
    );
    await act(async () => {
      await result.current.execute(
        {
          commandId: first.commandId,
          objectKind: 'task',
          objectIds: ['task-first'],
          operation: { type: 'trash' },
        } as ObjectCommandIn,
        'Trash first Task',
      );
      await result.current.execute(
        {
          commandId: second.commandId,
          objectKind: 'task',
          objectIds: ['task-second'],
          operation: { type: 'trash' },
        } as ObjectCommandIn,
        'Trash second Task',
      );
    });

    let resolveReplay!: (value: ObjectCommandResult) => void;
    const replayResult = commandResult(second);
    mutateAsync.mockReturnValue(
      new Promise<ObjectCommandResult>((resolve) => {
        resolveReplay = resolve;
      }),
    );
    let firstUndo!: Promise<void>;
    let repeatedUndo!: Promise<void>;
    act(() => {
      firstUndo = result.current.undo();
      repeatedUndo = result.current.undo();
    });
    const callsWhilePending = mutateAsync.mock.calls.length;
    expect(result.current.pending).toBe(true);
    expect(result.current.notice).toBeNull();

    await act(async () => {
      resolveReplay(replayResult);
      await Promise.all([firstUndo, repeatedUndo]);
    });

    expect(callsWhilePending).toBe(3);
  });
});
