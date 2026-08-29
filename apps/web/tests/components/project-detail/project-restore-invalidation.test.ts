import type {
  ObjectCommandReceipt,
  ObjectCommandRequest,
  ObjectCommandResult,
} from '@docket/types';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { createElement, type JSX, type ReactNode, useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type ProjectRestoreController,
  type ProjectRestoreReadResult,
  useProjectRestoreController,
} from '@/components/project-detail/project-restore-controller';
import { QueuedOfflineWriteError } from '@/components/pwa/offline-write';
import type { OutboxEntry, OutboxStatus } from '@/components/pwa/outbox-model';
import { ResolvedAccountProvider, useResolvedAccountId } from '@/components/resolved-account';
import { queryKeys } from '@/lib/query';
import { ApiRequestError } from '@/lib/query-core';
import {
  ProjectRestorePrimaryAction,
  refreshRestoredProject,
} from '../../../src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client';

const outboxHarness = vi.hoisted(() => {
  let entries: readonly unknown[] = [];
  const listeners = new Set<() => void>();

  return {
    outboxSnapshot: (): readonly unknown[] => entries,
    subscribeOutbox: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    replaceEntries: (nextEntries: readonly unknown[]): void => {
      entries = nextEntries;
      for (const listener of listeners) listener();
    },
    reset: (): void => {
      entries = [];
      listeners.clear();
    },
  };
});

vi.mock('@/components/pwa/outbox', () => ({
  outboxSnapshot: outboxHarness.outboxSnapshot,
  subscribeOutbox: outboxHarness.subscribeOutbox,
}));

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function createHookWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const queryClient = createQueryClient();
  return function HookWrapper({ children }: { children: ReactNode }): JSX.Element {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const receipt: ObjectCommandReceipt = {
  commandId: 'trash-command',
  objectKind: 'project',
  action: 'trash',
  entries: [],
};

const restoreRequest: ObjectCommandRequest = {
  commandId: 'restore-command',
  direction: 'undo',
  receipt,
};

const restoreScope = {
  accountId: 'account-1',
  organizationId: 'org-1',
  projectId: 'project-1',
} as const;

function restoreOutboxEntry(status: OutboxStatus, id = 'queued-restore-1'): OutboxEntry {
  return {
    id,
    userId: restoreScope.accountId,
    epoch: 'epoch-1',
    method: 'POST',
    path: `/v1/orgs/${restoreScope.organizationId}/object-commands`,
    body: JSON.stringify(restoreRequest),
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': restoreRequest.commandId,
    },
    label: 'Object change',
    createdAt: 1,
    notBeforeAt: null,
    attempts: 0,
    status,
  };
}

function queuedRestoreError(entryId = 'queued-restore-1'): ApiRequestError {
  return new ApiRequestError({
    message: 'application copy',
    status: 0,
    cause: new QueuedOfflineWriteError(entryId),
  });
}

function restoreResult(appliedIds: readonly string[]): ObjectCommandResult {
  return {
    appliedIds: [...appliedIds],
    conflictingIds: [],
    deniedIds: [],
    receipt: { ...receipt, commandId: 'restore-result', action: 'restore' },
  };
}

afterEach(() => {
  cleanup();
  outboxHarness.reset();
});

describe('Project restore invalidation', () => {
  it('binds Project recovery to the account identity resolved by the app shell', () => {
    const webRoot = join(import.meta.dirname, '../../..');
    const projectSource = readFileSync(
      join(webRoot, 'src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx'),
      'utf8',
    );
    const shellSource = readFileSync(join(webRoot, 'src/components/app-shell-frame.tsx'), 'utf8');

    expect(projectSource).toContain('useResolvedAccountId');
    expect(projectSource).not.toContain("import { useSession } from '@/lib/auth-client'");
    expect(shellSource).toContain('<ResolvedAccountProvider userId={renderedStorageUserId}>');
  });

  it('ignores a restore write that settles after the receipt recovery state resets', async () => {
    let rejectRestore!: (reason: unknown) => void;
    const pendingRestore = new Promise<ObjectCommandResult>((_resolve, reject) => {
      rejectRestore = reject;
    });
    const executeRestore = vi.fn(() => pendingRestore);
    const reconcile = vi.fn(async () => 'ready' as const);
    const onRestored = vi.fn();
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored,
          onNotApplied: vi.fn(),
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(executeRestore).toHaveBeenCalledOnce();
    });
    act(() => {
      result.current.reset();
    });
    await act(async () => {
      rejectRestore(new Error('old response lost'));
      await expect(pendingRestore).rejects.toThrow('old response lost');
    });

    expect(reconcile).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
    expect(result.current.refreshState).toBe('idle');
  });

  it('ignores a restore write that settles after the route changes Projects', async () => {
    let resolveRestore!: (result: ObjectCommandResult) => void;
    const pendingRestore = new Promise<ObjectCommandResult>((resolve) => {
      resolveRestore = resolve;
    });
    const executeRestore = vi.fn(() => pendingRestore);
    const reconcile = vi.fn(async () => 'ready' as const);
    const onRestored = vi.fn();
    const onNotApplied = vi.fn();
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useProjectRestoreController({
          scope: { ...restoreScope, projectId },
          executeRestore,
          reconcile,
          onRestored,
          onNotApplied,
        }),
      { initialProps: { projectId: 'project-1' }, wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(executeRestore).toHaveBeenCalledOnce();
    });
    rerender({ projectId: 'project-2' });
    await act(async () => {
      resolveRestore(restoreResult(['project-1']));
      await pendingRestore;
    });

    expect(reconcile).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
    expect(onNotApplied).not.toHaveBeenCalled();
    expect(result.current.refreshState).toBe('idle');
  });

  it('ignores a restore write that settles after the account changes on the same Project', async () => {
    let resolveRestore!: (result: ObjectCommandResult) => void;
    const pendingRestore = new Promise<ObjectCommandResult>((resolve) => {
      resolveRestore = resolve;
    });
    const executeRestore = vi.fn(() => pendingRestore);
    const reconcile = vi.fn(async () => 'ready' as const);
    const onRestored = vi.fn();
    const onNotApplied = vi.fn();
    const { result, rerender } = renderHook(
      ({ accountId }: { readonly accountId: string }) =>
        useProjectRestoreController({
          scope: { ...restoreScope, accountId },
          executeRestore,
          reconcile,
          onRestored,
          onNotApplied,
        }),
      { initialProps: { accountId: 'account-1' }, wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(executeRestore).toHaveBeenCalledOnce();
    });

    rerender({ accountId: 'account-2' });
    await act(async () => {
      resolveRestore(restoreResult([restoreScope.projectId]));
      await pendingRestore;
    });

    expect(reconcile).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
    expect(onNotApplied).not.toHaveBeenCalled();
    expect(result.current.refreshState).toBe('idle');
  });

  it('preserves the queued restore when live auth moves from null to the shell account', async () => {
    outboxHarness.replaceEntries([restoreOutboxEntry('queued')]);
    const executeRestore = vi.fn(async () => Promise.reject(queuedRestoreError()));
    const reconcile = vi
      .fn<() => Promise<'cache-error' | 'ready'>>()
      .mockResolvedValueOnce('cache-error')
      .mockResolvedValueOnce('ready');
    const onRestored = vi.fn();
    let controller: ProjectRestoreController | null = null;

    function Harness({ liveAccountId }: { readonly liveAccountId: string | null }): JSX.Element {
      const accountId = useResolvedAccountId();
      controller = useProjectRestoreController({
        scope: { ...restoreScope, accountId },
        executeRestore,
        reconcile,
        onRestored,
        onNotApplied: vi.fn(),
      });
      return createElement('output', { 'data-live-account': liveAccountId ?? 'pending' });
    }

    const currentController = (): ProjectRestoreController => {
      if (controller === null) throw new Error('Restore controller did not render.');
      return controller;
    };
    const wrapper = createHookWrapper();
    const frame = (liveAccountId: string | null): JSX.Element =>
      createElement(
        wrapper,
        null,
        createElement(ResolvedAccountProvider, {
          userId: restoreScope.accountId,
          children: createElement(Harness, { liveAccountId }),
        }),
      );
    const rendered = render(frame(null));

    act(() => {
      currentController().restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(currentController().failure).toBe('queued-read');
    });

    rendered.rerender(frame(restoreScope.accountId));
    act(() => {
      outboxHarness.replaceEntries([]);
    });

    await waitFor(() => {
      expect(onRestored).toHaveBeenCalledOnce();
    });
    expect(executeRestore).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('resets a pending restore when the shell releases a different account', async () => {
    let resolveRestore!: (result: ObjectCommandResult) => void;
    const pendingRestore = new Promise<ObjectCommandResult>((resolve) => {
      resolveRestore = resolve;
    });
    const executeRestore = vi.fn(() => pendingRestore);
    const reconcile = vi.fn(async () => 'ready' as const);
    const onRestored = vi.fn();
    let controller: ProjectRestoreController | null = null;

    function Harness(): null {
      const accountId = useResolvedAccountId();
      controller = useProjectRestoreController({
        scope: { ...restoreScope, accountId },
        executeRestore,
        reconcile,
        onRestored,
        onNotApplied: vi.fn(),
      });
      return null;
    }

    const currentController = (): ProjectRestoreController => {
      if (controller === null) throw new Error('Restore controller did not render.');
      return controller;
    };
    const wrapper = createHookWrapper();
    const frame = (accountId: string): JSX.Element =>
      createElement(
        wrapper,
        null,
        createElement(ResolvedAccountProvider, {
          userId: accountId,
          children: createElement(Harness),
        }),
      );
    const rendered = render(frame('account-1'));

    act(() => {
      currentController().restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(executeRestore).toHaveBeenCalledOnce();
    });

    rendered.rerender(frame('account-2'));
    await act(async () => {
      resolveRestore(restoreResult([restoreScope.projectId]));
      await pendingRestore;
    });

    expect(reconcile).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
    expect(currentController().refreshState).toBe('idle');
  });

  it('ignores a pending reconciliation that settles after a new Project renders', async () => {
    let settleReconciliation!: (result: ProjectRestoreReadResult) => void;
    const reconciliation = {
      then(onFulfilled: (result: ProjectRestoreReadResult) => void) {
        settleReconciliation = onFulfilled;
        return { catch: () => undefined };
      },
    } as unknown as Promise<ProjectRestoreReadResult>;
    const executeRestore = vi.fn(async () => Promise.reject(new Error('response lost')));
    const reconcile = vi.fn(() => reconciliation);
    const onRestored = vi.fn();
    let controller: ProjectRestoreController | null = null;
    const currentController = (): ProjectRestoreController => {
      if (controller === null) throw new Error('Restore controller did not render.');
      return controller;
    };

    function Harness({ projectId }: { readonly projectId: string }): null {
      controller = useProjectRestoreController({
        scope: { ...restoreScope, projectId },
        executeRestore,
        reconcile,
        onRestored,
        onNotApplied: vi.fn(),
      });
      useLayoutEffect(() => {
        if (projectId === 'project-2') settleReconciliation('ready');
      }, [projectId]);
      return null;
    }

    const wrapper = createHookWrapper();
    const rendered = render(
      createElement(wrapper, null, createElement(Harness, { projectId: 'project-1' })),
    );
    act(() => {
      currentController().restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(currentController().refreshState).toBe('pending');
    });

    rendered.rerender(
      createElement(wrapper, null, createElement(Harness, { projectId: 'project-2' })),
    );

    expect(onRestored).not.toHaveBeenCalled();
    expect(currentController().refreshState).toBe('idle');
  });

  it('ignores a pending reconciliation that settles after the route organization changes', async () => {
    let settleReconciliation!: (result: ProjectRestoreReadResult) => void;
    const reconciliation = new Promise<ProjectRestoreReadResult>((resolve) => {
      settleReconciliation = resolve;
    });
    const executeRestore = vi.fn(async () => Promise.reject(new Error('response lost')));
    const reconcile = vi.fn(() => reconciliation);
    const onRestored = vi.fn();
    const { result, rerender } = renderHook(
      ({ organizationId }: { readonly organizationId: string }) =>
        useProjectRestoreController({
          scope: { ...restoreScope, organizationId },
          executeRestore,
          reconcile,
          onRestored,
          onNotApplied: vi.fn(),
        }),
      { initialProps: { organizationId: 'org-1' }, wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(result.current.refreshState).toBe('pending');
    });

    rerender({ organizationId: 'org-2' });
    await act(async () => {
      settleReconciliation('ready');
      await reconciliation;
    });

    expect(onRestored).not.toHaveBeenCalled();
    expect(result.current.refreshState).toBe('idle');
  });

  it('reconciles a queued restore to ready without generating a second command', async () => {
    outboxHarness.replaceEntries([restoreOutboxEntry('queued')]);
    const executeRestore = vi.fn(async () => Promise.reject(queuedRestoreError()));
    const reconcile = vi
      .fn<() => Promise<'not-found' | 'ready'>>()
      .mockResolvedValueOnce('not-found')
      .mockResolvedValueOnce('ready');
    const onRestored = vi.fn();
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored,
          onNotApplied: vi.fn(),
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(result.current.refreshState).toBe('error');
    });
    expect(result.current.failure).toBe('queued-read');

    act(() => {
      result.current.retryRefresh();
    });
    await waitFor(() => {
      expect(reconcile).toHaveBeenCalledTimes(2);
      expect(result.current.refreshState).toBe('idle');
    });
    expect(result.current.failure).toBeNull();
    expect(onRestored).toHaveBeenCalledOnce();
    expect(executeRestore).toHaveBeenCalledOnce();
    expect(executeRestore).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: 'restore-command' }),
    );
  });

  it('keeps queued evidence while the exact outbox entry is queued or sending', async () => {
    outboxHarness.replaceEntries([restoreOutboxEntry('queued')]);
    const executeRestore = vi.fn(async () => Promise.reject(queuedRestoreError()));
    const reconcile = vi.fn(async () => 'cache-error' as const);
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored: vi.fn(),
          onNotApplied: vi.fn(),
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(result.current.failure).toBe('queued-read');
    });

    act(() => {
      outboxHarness.replaceEntries([restoreOutboxEntry('sending')]);
    });
    expect(reconcile).toHaveBeenCalledOnce();

    act(() => {
      result.current.retryRefresh();
    });
    await waitFor(() => {
      expect(reconcile).toHaveBeenCalledTimes(2);
      expect(result.current.failure).toBe('queued-read');
    });
  });

  it('tracks the queued error entry ID and reconciles its disappearance once', async () => {
    outboxHarness.replaceEntries([
      restoreOutboxEntry('queued'),
      restoreOutboxEntry('queued', 'unrelated-entry'),
    ]);
    const executeRestore = vi.fn(async () => Promise.reject(queuedRestoreError()));
    const reconcile = vi
      .fn<() => Promise<'cache-error' | 'ready'>>()
      .mockResolvedValueOnce('cache-error')
      .mockResolvedValueOnce('ready');
    const onRestored = vi.fn();
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored,
          onNotApplied: vi.fn(),
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(result.current.failure).toBe('queued-read');
    });

    act(() => {
      outboxHarness.replaceEntries([restoreOutboxEntry('queued')]);
    });
    expect(reconcile).toHaveBeenCalledOnce();

    act(() => {
      outboxHarness.replaceEntries([]);
    });
    await waitFor(() => {
      expect(onRestored).toHaveBeenCalledOnce();
      expect(result.current.refreshState).toBe('idle');
    });

    act(() => {
      outboxHarness.replaceEntries([]);
    });
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['disappears', []],
    ['becomes blocked', [restoreOutboxEntry('blocked')]],
    ['expires', [restoreOutboxEntry('expired')]],
  ] as const)(
    'releases the restore lock when the exact queued entry %s and the Project is still missing',
    async (_transition, nextEntries) => {
      outboxHarness.replaceEntries([restoreOutboxEntry('queued')]);
      const executeRestore = vi.fn(async () => Promise.reject(queuedRestoreError()));
      const reconcile = vi
        .fn<() => Promise<'cache-error' | 'not-found'>>()
        .mockResolvedValueOnce('cache-error')
        .mockResolvedValueOnce('not-found');
      const { result } = renderHook(
        () =>
          useProjectRestoreController({
            scope: restoreScope,
            executeRestore,
            reconcile,
            onRestored: vi.fn(),
            onNotApplied: vi.fn(),
          }),
        { wrapper: createHookWrapper() },
      );

      act(() => {
        result.current.restoreMutation.mutate(restoreRequest);
      });
      await waitFor(() => {
        expect(result.current.failure).toBe('queued-read');
      });

      act(() => {
        outboxHarness.replaceEntries(nextEntries);
      });
      await waitFor(() => {
        expect(result.current.refreshState).toBe('idle');
        expect(result.current.failure).toBeNull();
        expect(result.current.restoreMutation.error).toBeNull();
      });

      act(() => {
        outboxHarness.replaceEntries(nextEntries);
      });
      expect(reconcile).toHaveBeenCalledTimes(2);
    },
  );

  it('clears a queued mutation error when the exact entry is already absent', async () => {
    const executeRestore = vi.fn(async () => Promise.reject(queuedRestoreError()));
    const reconcile = vi.fn(async () => 'not-found' as const);
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored: vi.fn(),
          onNotApplied: vi.fn(),
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(executeRestore).toHaveBeenCalledOnce();
      expect(reconcile).toHaveBeenCalledOnce();
      expect(result.current.restoreMutation.isPending).toBe(false);
      expect(result.current.restoreMutation.error).toBeNull();
    });

    expect(result.current.refreshState).toBe('idle');
    expect(result.current.failure).toBeNull();
  });

  it('reports an indeterminate read when the exact queued entry ends and reconciliation fails', async () => {
    outboxHarness.replaceEntries([restoreOutboxEntry('queued')]);
    const executeRestore = vi.fn(async () => Promise.reject(queuedRestoreError()));
    const reconcile = vi.fn(async () => 'cache-error' as const);
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored: vi.fn(),
          onNotApplied: vi.fn(),
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(result.current.failure).toBe('queued-read');
    });

    act(() => {
      outboxHarness.replaceEntries([]);
    });
    await waitFor(() => {
      expect(reconcile).toHaveBeenCalledTimes(2);
      expect(result.current.failure).toBe('indeterminate-read');
      expect(result.current.restoreMutation.error).toBeNull();
    });
  });

  it('reconciles an indeterminate restore response without sending the command twice', async () => {
    const executeRestore = vi.fn(async () => Promise.reject(new Error('response lost')));
    let resolveReconcile!: (result: 'ready') => void;
    const reconciliation = new Promise<'ready'>((resolve) => {
      resolveReconcile = resolve;
    });
    const reconcile = vi.fn(() => reconciliation);
    const onRestored = vi.fn();
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored,
          onNotApplied: vi.fn(),
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });

    await waitFor(() => {
      expect(result.current.refreshState).toBe('pending');
    });
    expect(executeRestore).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();

    act(() => {
      resolveReconcile('ready');
    });
    await waitFor(() => {
      expect(onRestored).toHaveBeenCalledOnce();
    });
    expect(result.current.refreshState).toBe('idle');
  });

  it('allows a write retry after an indeterminate response and authoritative not-found read', async () => {
    const executeRestore = vi.fn(async () => Promise.reject(new Error('response lost')));
    const reconcile = vi.fn(async () => 'not-found' as const);
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored: vi.fn(),
          onNotApplied: vi.fn(),
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(result.current.refreshState).toBe('idle');
    });

    act(() => {
      result.current.restoreMutation.mutate({ ...restoreRequest, commandId: 'restore-command-2' });
    });
    await waitFor(() => {
      expect(executeRestore).toHaveBeenCalledTimes(2);
    });
  });

  it('reconciles a confirmed no-op and clears the trash screen when the Project is ready', async () => {
    const executeRestore = vi.fn(async () => restoreResult([]));
    const reconcile = vi.fn(async () => 'ready' as const);
    const onRestored = vi.fn();
    const onNotApplied = vi.fn();
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored,
          onNotApplied,
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(onRestored).toHaveBeenCalledOnce();
    });

    expect(reconcile).toHaveBeenCalledOnce();
    expect(onNotApplied).not.toHaveBeenCalled();
    expect(result.current.refreshState).toBe('idle');
    expect(result.current.failure).toBeNull();
  });

  it('reports not applied only after a confirmed no-op reconciles to not found', async () => {
    const executeRestore = vi.fn(async () => restoreResult([]));
    const reconcile = vi.fn(async () => 'not-found' as const);
    const onRestored = vi.fn();
    const onNotApplied = vi.fn();
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored,
          onNotApplied,
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(result.current.failure).toBe('not-applied');
    });

    expect(reconcile).toHaveBeenCalledOnce();
    expect(onNotApplied).toHaveBeenCalledOnce();
    expect(onRestored).not.toHaveBeenCalled();
    expect(result.current.refreshState).toBe('idle');
  });

  it('keeps a confirmed restore read-only across repeated not-found refreshes', async () => {
    const executeRestore = vi.fn(async () => restoreResult(['project-1']));
    const reconcile = vi.fn(async () => 'not-found' as const);
    const onNotApplied = vi.fn();
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored: vi.fn(),
          onNotApplied,
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(result.current.refreshState).toBe('error');
    });

    act(() => {
      result.current.retryRefresh();
    });
    await waitFor(() => {
      expect(reconcile).toHaveBeenCalledTimes(2);
      expect(result.current.refreshState).toBe('error');
    });
    expect(executeRestore).toHaveBeenCalledOnce();
    expect(result.current.failure).toBe('confirmed-read');
    expect(onNotApplied).not.toHaveBeenCalled();
  });

  it('preserves indeterminate evidence so a retrying not-found read permits Undo again', async () => {
    const executeRestore = vi.fn(async () => Promise.reject(new Error('response lost')));
    const reconcile = vi
      .fn<() => Promise<'cache-error' | 'not-found'>>()
      .mockResolvedValueOnce('cache-error')
      .mockResolvedValueOnce('not-found');
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored: vi.fn(),
          onNotApplied: vi.fn(),
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(result.current.refreshState).toBe('error');
    });

    act(() => {
      result.current.retryRefresh();
    });
    await waitFor(() => {
      expect(result.current.refreshState).toBe('idle');
    });
    expect(executeRestore).toHaveBeenCalledOnce();
  });

  it('clears the prior command error when a new Project or receipt resets recovery', async () => {
    const executeRestore = vi.fn(async () => Promise.reject(new Error('response lost')));
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile: vi.fn(async () => 'cache-error' as const),
          onRestored: vi.fn(),
          onNotApplied: vi.fn(),
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(result.current.restoreMutation.error).not.toBeNull();
      expect(result.current.refreshState).toBe('error');
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.restoreMutation.error).toBeNull();
    expect(result.current.refreshState).toBe('idle');
    expect(result.current.failure).toBeNull();
  });

  it('clears a stale not-applied failure when the person retries the restore command', async () => {
    let resolveRetry!: (result: ObjectCommandResult) => void;
    const retry = new Promise<ObjectCommandResult>((resolve) => {
      resolveRetry = resolve;
    });
    const executeRestore = vi
      .fn<(request: ObjectCommandRequest) => Promise<ObjectCommandResult>>()
      .mockResolvedValueOnce(restoreResult([]))
      .mockReturnValueOnce(retry);
    const reconcile = vi
      .fn<() => Promise<'not-found' | 'ready'>>()
      .mockResolvedValueOnce('not-found')
      .mockResolvedValueOnce('ready');
    const { result } = renderHook(
      () =>
        useProjectRestoreController({
          scope: restoreScope,
          executeRestore,
          reconcile,
          onRestored: vi.fn(),
          onNotApplied: vi.fn(),
        }),
      { wrapper: createHookWrapper() },
    );

    act(() => {
      result.current.restoreMutation.mutate(restoreRequest);
    });
    await waitFor(() => {
      expect(result.current.failure).toBe('not-applied');
    });

    act(() => {
      result.current.restoreMutation.mutate({ ...restoreRequest, commandId: 'restore-command-2' });
    });
    await waitFor(() => {
      expect(result.current.restoreMutation.isPending).toBe(true);
    });
    expect(result.current.failure).toBeNull();

    resolveRetry(restoreResult([]));
    await waitFor(() => {
      expect(result.current.restoreMutation.isPending).toBe(false);
    });
  });

  it('replaces Undo with a read-only refresh retry after the restored page refresh fails', () => {
    const onRetryRefresh = vi.fn();
    const onUndo = vi.fn();

    render(
      createElement(ProjectRestorePrimaryAction, {
        refreshState: 'error',
        restorePending: false,
        onRetryRefresh,
        onUndo,
      }),
    );

    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));

    expect(onRetryRefresh).toHaveBeenCalledOnce();
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('removes Undo while the restored page refresh is pending', () => {
    render(
      createElement(ProjectRestorePrimaryAction, {
        refreshState: 'pending',
        restorePending: false,
        onRetryRefresh: vi.fn(),
        onUndo: vi.fn(),
      }),
    );

    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refreshing project' })).toBeDisabled();
  });

  it('fetches an inactive aggregate before it reports restored data ready', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => ({ revision: 'fresh' })),
    };
    queryClient.setQueryData(aggregateQuery.queryKey, { revision: 'stale' });

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('ready');

    expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(aggregateQuery.queryKey)).toEqual({ revision: 'fresh' });
    expect(queryClient.getQueryState(aggregateQuery.queryKey)?.isInvalidated).toBe(false);
  });

  it('invalidates the cross-workspace portfolio after a restored Project refreshes', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => ({ revision: 'fresh' })),
    };
    queryClient.setQueryData(queryKeys.portfolio(), { items: [{ id: 'project-1' }] });

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('ready');

    expect(queryClient.getQueryState(queryKeys.portfolio())?.isInvalidated).toBe(true);
  });

  it('fetches a missing aggregate before it reports restored data ready', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => ({ revision: 'fresh' })),
    };

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('ready');

    expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(aggregateQuery.queryKey)).toEqual({ revision: 'fresh' });
  });

  it('uses the invalidation refetch once when the aggregate is active', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => ({ revision: 'fresh' })),
    };
    queryClient.setQueryData(aggregateQuery.queryKey, { revision: 'stale' });
    const observer = new QueryObserver(queryClient, { ...aggregateQuery, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => undefined);

    try {
      await expect(
        refreshRestoredProject({
          queryClient,
          aggregateQuery,
          ownerOrganizationId: 'org-1',
        }),
      ).resolves.toBe('ready');

      expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
      expect(queryClient.getQueryData(aggregateQuery.queryKey)).toEqual({ revision: 'fresh' });
    } finally {
      unsubscribe();
    }
  });

  it('does not retry a failed invalidation refetch when the aggregate is active', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => Promise.reject(new Error('provider text must not escape'))),
    };
    queryClient.setQueryData(aggregateQuery.queryKey, { revision: 'stale' });
    const observer = new QueryObserver(queryClient, { ...aggregateQuery, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => undefined);

    try {
      await expect(
        refreshRestoredProject({
          queryClient,
          aggregateQuery,
          ownerOrganizationId: 'org-1',
        }),
      ).resolves.toBe('cache-error');

      expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it('reports an aggregate cache error when the authoritative fetch fails', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => Promise.reject(new Error('provider text must not escape'))),
    };
    queryClient.setQueryData(aggregateQuery.queryKey, { revision: 'stale' });

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('cache-error');

    expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
  });

  it('reports a server-confirmed missing aggregate separately from a read failure', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () =>
        Promise.reject(new ApiRequestError({ message: 'application copy', status: 404 })),
      ),
    };

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('not-found');
  });

  it.each([
    ['ready', 'ready'],
    ['not-found', 'not-found'],
  ] as const)(
    'settles %s from the exact aggregate before broad Project invalidation',
    async (aggregateOutcome, expectedResult) => {
      const queryClient = createQueryClient();
      let resolveBroadInvalidation!: () => void;
      const broadInvalidation = new Promise<void>((resolve) => {
        resolveBroadInvalidation = resolve;
      });
      let broadInvalidationSettled = false;
      void broadInvalidation.then(() => {
        broadInvalidationSettled = true;
      });
      vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(broadInvalidation);

      let resolveAggregate!: (data: { revision: string }) => void;
      let rejectAggregate!: (reason: unknown) => void;
      const aggregateRead = new Promise<{ revision: string }>((resolve, reject) => {
        resolveAggregate = resolve;
        rejectAggregate = reject;
      });
      const aggregateQuery = {
        queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
        queryFn: vi.fn(() => aggregateRead),
      };
      const reconciliation = refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      });
      let settledResult: ProjectRestoreReadResult | null = null;
      void reconciliation.then((result) => {
        settledResult = result;
      });

      await waitFor(() => {
        expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
      });
      if (aggregateOutcome === 'ready') {
        resolveAggregate({ revision: 'fresh' });
      } else {
        rejectAggregate(new ApiRequestError({ message: 'application copy', status: 404 }));
      }

      try {
        await waitFor(
          () => {
            expect(settledResult).toBe(expectedResult);
          },
          { timeout: 250 },
        );
        expect(broadInvalidationSettled).toBe(false);
      } finally {
        resolveBroadInvalidation();
        await broadInvalidation;
      }

      await expect(reconciliation).resolves.toBe(expectedResult);
    },
  );

  it('fetches the exact aggregate when broad Project invalidation rejects', async () => {
    const queryClient = createQueryClient();
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(
      new Error('internal cache failure'),
    );
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => ({ revision: 'fresh' })),
    };

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('ready');

    expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(aggregateQuery.queryKey)).toEqual({ revision: 'fresh' });
  });

  it('ignores an invalidation-layer 404 when the exact aggregate is ready', async () => {
    const queryClient = createQueryClient();
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(
      new ApiRequestError({ message: 'projection missing', status: 404 }),
    );
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => ({ revision: 'fresh' })),
    };

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('ready');

    expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(aggregateQuery.queryKey)).toEqual({ revision: 'fresh' });
  });

  it('reports not found from the exact aggregate even when broad invalidation rejects', async () => {
    const queryClient = createQueryClient();
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(
      new Error('internal cache failure'),
    );
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () =>
        Promise.reject(new ApiRequestError({ message: 'application copy', status: 404 })),
      ),
    };

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('not-found');

    expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
  });
});
