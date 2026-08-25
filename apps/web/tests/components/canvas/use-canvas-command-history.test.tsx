import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  type RenderHookResult,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ObjectCommandIn, ObjectCommandReceipt, ObjectCommandResult } from '@docket/types';
import type * as QueryModule from '@/lib/query';

const { mutateAsync, replayAccessPost } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  replayAccessPost: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          'object-commands': {
            $post: vi.fn(),
            'replay-access': { $post: replayAccessPost },
          },
        },
      },
    },
  },
}));

vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof QueryModule>();
  return {
    ...actual,
    useApiMutation: () => ({ mutateAsync, isPending: false }),
  };
});

vi.mock('@/components/confirm-destructive-dialog', () => ({
  ConfirmDestructiveDialog: () => null,
}));

import {
  CanvasCommandProviderWithHistory,
  useCanvasCommandContext,
} from '@/components/canvas/canvas-command-context';
import {
  type CanvasCommandHistoryControls,
  useCanvasCommandHistory,
} from '@/components/canvas/use-canvas-command-history';
import { SelectionProvider } from '@/components/selection';

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

function replayAccessResponse(allowed: boolean, deniedIds: readonly string[] = []): Response {
  return new Response(JSON.stringify({ allowed, deniedIds }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderHistory(scopeKey: string): RenderHookResult<CanvasCommandHistoryControls, unknown> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderHook(() => useCanvasCommandHistory('org-1', scopeKey, []), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

function AccessControls(): React.JSX.Element {
  const commands = useCanvasCommandContext();
  return (
    <>
      <output aria-label="Undo availability">
        {commands?.canUndo ? 'Undo enabled' : 'Undo disabled'}
      </output>
      <button
        type="button"
        onClick={() => {
          void commands?.execute(
            {
              commandId: 'retained-access-error',
              objectKind: 'task',
              objectIds: ['task-a'],
              operation: { type: 'replace_property', property: 'priority', value: 'high' },
            } as ObjectCommandIn,
            {
              historyLabel: 'Change object',
              title: 'Priority changed',
              detail: 'Task is now set to High',
              unchangedTitle: 'Priority unchanged',
              unchangedDetail: 'Task is already set to High',
            },
          );
        }}
      >
        Apply change
      </button>
      <button
        type="button"
        onClick={() => {
          void commands?.undo();
        }}
      >
        Run Undo
      </button>
      <button type="button" onKeyDown={commands?.onCanvasKeyDown}>
        Keyboard surface
      </button>
    </>
  );
}

function AccessErrorHarness(): React.JSX.Element {
  const history = useCanvasCommandHistory('org-1', 'retained-access-error', []);
  return (
    <SelectionProvider items={[]} organizationId="org-1" surfaceId="access-error-canvas">
      <CanvasCommandProviderWithHistory
        objectKind="task"
        canEdit={false}
        history={history}
        onCreateObject={vi.fn()}
        onOpenObject={vi.fn()}
      >
        <AccessControls />
      </CanvasCommandProviderWithHistory>
    </SelectionProvider>
  );
}

async function executeReceipt(
  rendered: RenderHookResult<CanvasCommandHistoryControls, unknown>,
  receipt: ObjectCommandReceipt,
): Promise<void> {
  mutateAsync.mockResolvedValueOnce(commandResult(receipt));
  await act(async () => {
    await rendered.result.current.execute(
      {
        commandId: receipt.commandId,
        objectKind: receipt.objectKind,
        objectIds: receipt.entries.map(({ objectId }) => objectId),
        operation: { type: 'replace_property', property: 'priority', value: 'high' },
      } as ObjectCommandIn,
      {
        historyLabel: 'Change object',
        title: 'Priority changed',
        detail: 'Task is now set to High',
        unchangedTitle: 'Priority unchanged',
        unchangedDetail: 'Task is already set to High',
      },
    );
  });
}

describe('useCanvasCommandHistory', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    replayAccessPost.mockReset();
    replayAccessPost.mockImplementation(async () => replayAccessResponse(true));
  });

  it('reports the existing state when a forward command changes nothing', async () => {
    const rendered = renderHistory('unchanged-forward');
    mutateAsync.mockResolvedValueOnce(
      commandResult(objectReceipt('unchanged-forward', 'replace_property', [])),
    );

    await act(async () => {
      await rendered.result.current.execute(
        {
          commandId: 'unchanged-forward',
          objectKind: 'task',
          objectIds: ['task-a'],
          operation: { type: 'replace_property', property: 'priority', value: 'high' },
        } as ObjectCommandIn,
        {
          historyLabel: 'Change priority',
          title: 'Priority changed',
          detail: 'Task is now set to High',
          unchangedTitle: 'Priority unchanged',
          unchangedDetail: 'Task is already set to High',
        },
      );
    });

    expect(rendered.result.current.notice).toMatchObject({
      title: 'Priority unchanged',
      detail: 'Task is already set to High',
      offerUndo: false,
    });
    expect(rendered.result.current.canUndo).toBe(false);
  });

  it('keeps Undo disabled while replay access is loading, then enables it when allowed', async () => {
    let resolveAccess!: (response: Response) => void;
    replayAccessPost.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveAccess = resolve;
      }),
    );
    const receipt = objectReceipt('loading-access', 'replace_property', ['task-a']);
    const rendered = renderHistory(receipt.commandId);

    await executeReceipt(rendered, receipt);
    expect(rendered.result.current.canUndo).toBe(false);

    await act(async () => {
      resolveAccess(replayAccessResponse(true));
    });
    await waitFor(() => {
      expect(rendered.result.current.canUndo).toBe(true);
    });
  });

  it('keeps Undo disabled when any replay target is denied', async () => {
    replayAccessPost.mockImplementation(async () => replayAccessResponse(false, ['task-b']));
    const receipt = objectReceipt('denied-access', 'replace_property', ['task-a', 'task-b']);
    const rendered = renderHistory(receipt.commandId);

    await executeReceipt(rendered, receipt);
    await waitFor(() => {
      expect(replayAccessPost).toHaveBeenCalledOnce();
    });

    expect(rendered.result.current.canUndo).toBe(false);
  });

  it('rechecks allowed access immediately before replay', async () => {
    const receipt = objectReceipt('allowed-recheck', 'replace_property', ['task-a']);
    const rendered = renderHistory(receipt.commandId);
    await executeReceipt(rendered, receipt);
    await waitFor(() => {
      expect(rendered.result.current.canUndo).toBe(true);
    });
    mutateAsync.mockResolvedValueOnce(commandResult(receipt));

    await act(async () => {
      await rendered.result.current.undo();
    });

    expect(replayAccessPost).toHaveBeenCalledTimes(3);
    expect(replayAccessPost).toHaveBeenNthCalledWith(1, {
      param: { orgId: 'org-1' },
      json: { direction: 'undo', receipt },
    });
    expect(replayAccessPost).toHaveBeenNthCalledWith(3, {
      param: { orgId: 'org-1' },
      json: { direction: 'redo', receipt },
    });
    expect(replayAccessPost.mock.invocationCallOrder[1]).toBeLessThan(
      mutateAsync.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
    );
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(rendered.result.current.notice).toMatchObject({
      title: 'Object change undone',
      detail: '1 task returned to the previous state',
    });
  });

  it('does not consume history when invocation-time access is denied', async () => {
    replayAccessPost
      .mockImplementationOnce(async () => replayAccessResponse(true))
      .mockImplementationOnce(async () => replayAccessResponse(false, ['task-a']));
    const receipt = objectReceipt('revoked-recheck', 'replace_property', ['task-a']);
    const rendered = renderHistory(receipt.commandId);
    await executeReceipt(rendered, receipt);
    await waitFor(() => {
      expect(rendered.result.current.canUndo).toBe(true);
    });

    await act(async () => {
      await rendered.result.current.undo();
    });

    expect(mutateAsync).toHaveBeenCalledOnce();
    expect(rendered.result.current.canUndo).toBe(false);
  });

  it('uses application-owned copy when the invocation-time access check fails', async () => {
    replayAccessPost
      .mockImplementationOnce(async () => replayAccessResponse(true))
      .mockRejectedValueOnce(new Error('provider leaked permission failure'));
    const receipt = objectReceipt('failed-recheck', 'replace_property', ['task-a']);
    const rendered = renderHistory(receipt.commandId);
    await executeReceipt(rendered, receipt);
    await waitFor(() => {
      expect(rendered.result.current.canUndo).toBe(true);
    });

    await act(async () => {
      await rendered.result.current.undo();
    });

    expect(rendered.result.current.notice).toMatchObject({
      title: 'Object change was not undone',
      detail: 'No collaborator changes were overwritten',
    });
    expect(rendered.result.current.notice?.detail).not.toContain('provider');
    expect(mutateAsync).toHaveBeenCalledOnce();
  });

  it('keeps displayed, direct, and keyboard Undo unavailable after an access refetch fails', async () => {
    replayAccessPost
      .mockImplementationOnce(async () => replayAccessResponse(true))
      .mockRejectedValue(new Error('provider access outage'));
    const receipt = objectReceipt('retained-access-error', 'replace_property', ['task-a']);
    mutateAsync.mockResolvedValueOnce(commandResult(receipt));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AccessErrorHarness />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Undo availability')).toHaveTextContent('Undo enabled');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run Undo' }));
    await waitFor(() => {
      expect(replayAccessPost).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByLabelText('Undo availability')).toHaveTextContent('Undo disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Run Undo' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Keyboard surface' }), {
      key: 'z',
      ctrlKey: true,
    });
    expect(replayAccessPost).toHaveBeenCalledTimes(2);
    expect(mutateAsync).toHaveBeenCalledOnce();
  });

  it('keeps Redo unavailable when its access refetch fails with retained allowed data', async () => {
    replayAccessPost
      .mockImplementationOnce(async () => replayAccessResponse(true))
      .mockImplementationOnce(async () => replayAccessResponse(true))
      .mockImplementationOnce(async () => replayAccessResponse(true))
      .mockRejectedValue(new Error('provider access outage'));
    const receipt = objectReceipt('retained-redo-access-error', 'replace_property', ['task-a']);
    const rendered = renderHistory(receipt.commandId);
    await executeReceipt(rendered, receipt);
    await waitFor(() => {
      expect(rendered.result.current.canUndo).toBe(true);
    });
    mutateAsync.mockResolvedValueOnce(commandResult(receipt));
    await act(async () => {
      await rendered.result.current.undo();
    });
    await waitFor(() => {
      expect(rendered.result.current.canRedo).toBe(true);
    });

    await act(async () => {
      await rendered.result.current.redo();
    });

    expect(rendered.result.current.canRedo).toBe(false);
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it('offers Undo after a bulk property change', async () => {
    const receipt = objectReceipt('bulk-priority', 'replace_property', ['task-a', 'task-b']);
    const rendered = renderHistory('bulk-property-review');

    await executeReceipt(rendered, receipt);

    expect(rendered.result.current.notice).toMatchObject({ offerUndo: true });
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
    const rendered = renderHistory('bulk-association-review');

    await executeReceipt(rendered, receipt);

    expect(rendered.result.current.notice).toMatchObject({ offerUndo: true });
  });

  it('does not consume an older receipt while an Undo replay is pending', async () => {
    const first = objectReceipt('trash-first', 'trash', ['task-first']);
    const second = objectReceipt('trash-second', 'trash', ['task-second']);
    const rendered = renderHistory('pending-replay-review');
    await executeReceipt(rendered, first);
    await executeReceipt(rendered, second);
    await waitFor(() => {
      expect(rendered.result.current.canUndo).toBe(true);
    });

    let resolveReplay!: (value: ObjectCommandResult) => void;
    mutateAsync.mockReturnValueOnce(
      new Promise<ObjectCommandResult>((resolve) => {
        resolveReplay = resolve;
      }),
    );
    let firstUndo!: Promise<void>;
    let repeatedUndo!: Promise<void>;
    act(() => {
      firstUndo = rendered.result.current.undo();
      repeatedUndo = rendered.result.current.undo();
    });
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(3);
    });
    expect(rendered.result.current.pending).toBe(true);
    expect(rendered.result.current.notice).toBeNull();

    await act(async () => {
      resolveReplay(commandResult(second));
      await Promise.all([firstUndo, repeatedUndo]);
    });
  });
});
