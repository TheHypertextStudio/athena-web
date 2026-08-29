import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type JSX, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeLockManager } from './fake-lock-manager';

/**
 * What a person is told while changes are waiting.
 *
 * @remarks
 * The requirement these assertions encode is a promise about wording, so the wording is asserted:
 * the indicator must say the change is held on the device and will sync when the connection
 * returns, and each pending change must carry its own visible marker that goes away once it lands.
 * A count alone is not enough — "3 changes pending" cannot answer "did *my* rename go through?".
 *
 * The copy is also checked for what it must never contain. Nothing derived from an exception, a
 * provider, or a response body may reach this surface, and a queue of failed requests is precisely
 * where a raw `TypeError: Failed to fetch` would otherwise end up.
 */

const store = new Map<string, unknown>();

const authMocks = vi.hoisted(() => ({
  probeSession: vi.fn(),
  purgeLocalSessionState: vi.fn((_queryClient: QueryClient, _owner: unknown) =>
    Promise.resolve('cleared'),
  ),
  requireAuthentication: vi.fn(),
  reportSessionCleanupFailure: vi.fn(),
}));

vi.mock('@/components/authentication-interlock', () => ({
  useOptionalAuthenticationInterlock: () => ({
    requireAuthentication: authMocks.requireAuthentication,
    reportSessionCleanupFailure: authMocks.reportSessionCleanupFailure,
  }),
}));
vi.mock('@/lib/auth-client', () => ({ probeSession: authMocks.probeSession }));
vi.mock('@/lib/sign-out', () => ({ purgeLocalSessionState: authMocks.purgeLocalSessionState }));

vi.mock('idb-keyval', () => ({
  get: (key: string) => Promise.resolve(structuredClone(store.get(key))),
  set: (key: string, value: unknown) => {
    store.set(key, structuredClone(value));
    return Promise.resolve();
  },
  del: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
  keys: () => Promise.resolve([...store.keys()]),
}));

const { OfflineSyncIndicator, OfflineSyncRuntime, syncSentence } =
  await import('@/components/pwa/offline-sync');
const { drainOutbox, enqueueWrite, outboxSnapshot, outboxUserId, setOutboxUser } =
  await import('@/components/pwa/outbox');

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function Wrapper({ children }: { readonly children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Pretend the device has no connection, the way `navigator.onLine` reports it. */
function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

function objectCommand(commandId: string, fields: Readonly<Record<string, unknown>> = {}) {
  return {
    method: 'POST' as const,
    path: '/v1/orgs/o1/object-commands',
    body: JSON.stringify({ commandId, ...fields }),
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': commandId,
    },
  };
}

beforeEach(async () => {
  Object.defineProperty(window, 'indexedDB', { value: {}, configurable: true });
  Object.defineProperty(navigator, 'locks', {
    value: new FakeLockManager(),
    configurable: true,
  });
  store.clear();
  authMocks.probeSession.mockReset();
  authMocks.probeSession.mockResolvedValue({ hasSession: true, failed: false });
  authMocks.purgeLocalSessionState.mockClear();
  authMocks.purgeLocalSessionState.mockResolvedValue('cleared');
  authMocks.reportSessionCleanupFailure.mockClear();
  authMocks.requireAuthentication.mockClear();
  setOnline(false);
  await setOutboxUser(null);
  await setOutboxUser('user-1');
});

describe('OfflineSyncRuntime', () => {
  it('refreshes queries after an accepted replay on the first account load', async () => {
    await setOutboxUser(null);
    store.clear();
    store.set('docket:outbox:user-first-load', [
      {
        id: 'first-load-task-change',
        userId: 'user-first-load',
        method: 'POST',
        path: '/v1/orgs/o1/object-commands',
        body: JSON.stringify({
          commandId: 'first-load-task-change',
          title: 'Loaded from storage',
        }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'first-load-task-change',
        },
        label: 'Object change',
        createdAt: Date.now(),
        attempts: 0,
        status: 'queued',
      },
    ]);
    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidated = vi.spyOn(client, 'invalidateQueries');

    const view = render(
      <QueryClientProvider client={client}>
        <OfflineSyncRuntime userId="user-first-load" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(outboxSnapshot()).toHaveLength(1);
    });
    await drainOutbox();

    await waitFor(() => {
      expect(outboxSnapshot()).toEqual([]);
      expect(invalidated).toHaveBeenCalledOnce();
    });
    view.unmount();
  });

  it('repairs global server state after an accepted queued restore without fabricating appliedIds', async () => {
    const body = JSON.stringify({
      commandId: 'restore-project-1',
      direction: 'undo',
      receipt: {
        commandId: 'trash-project-1',
        objectKind: 'project',
        action: 'trash',
        entries: [],
      },
    });
    await enqueueWrite({
      method: 'POST',
      path: '/v1/orgs/o1/object-commands',
      body,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'restore-project-1',
      },
    });
    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidated = vi.spyOn(client, 'invalidateQueries');

    const view = render(
      <QueryClientProvider client={client}>
        <OfflineSyncRuntime userId="user-1" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(invalidated).toHaveBeenCalled();
      expect(outboxSnapshot()).toEqual([]);
    });
    view.unmount();
  });

  it('confirms a replay 401 and keeps a live session bound to its visible queue', async () => {
    await enqueueWrite(objectCommand('transient-replay-401'));
    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const view = render(
      <QueryClientProvider client={client}>
        <OfflineSyncRuntime userId="user-1" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(authMocks.probeSession).toHaveBeenCalledOnce();
    });
    expect(outboxUserId()).toBe('user-1');
    expect(outboxSnapshot()).toHaveLength(1);
    expect(authMocks.purgeLocalSessionState).not.toHaveBeenCalled();
    view.unmount();
  });

  it('purges local session state only after the session authority confirms replay ended it', async () => {
    authMocks.probeSession.mockResolvedValue({ hasSession: false, failed: false });
    await enqueueWrite(objectCommand('ended-session-replay-401'));
    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const view = render(
      <QueryClientProvider client={client}>
        <OfflineSyncRuntime userId="user-1" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(authMocks.purgeLocalSessionState).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(authMocks.requireAuthentication).toHaveBeenCalledOnce();
    });
    expect(authMocks.probeSession).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('does not clear cache or require authentication when durable revocation fails', async () => {
    authMocks.probeSession.mockResolvedValue({ hasSession: false, failed: false });
    authMocks.purgeLocalSessionState.mockResolvedValue('failed');
    await enqueueWrite(objectCommand('failed-session-revocation'));
    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cleared = vi.spyOn(client, 'clear');

    const view = render(
      <QueryClientProvider client={client}>
        <OfflineSyncRuntime userId="user-1" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(authMocks.purgeLocalSessionState).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ userId: 'user-1' }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(cleared).not.toHaveBeenCalled();
    expect(authMocks.requireAuthentication).not.toHaveBeenCalled();
    expect(authMocks.reportSessionCleanupFailure).toHaveBeenCalledOnce();
    expect(outboxUserId()).toBe('user-1');
    view.unmount();
  });

  it('cancels a delayed session-ended verdict when account ownership changes', async () => {
    const sessionProbe = deferred<{ readonly hasSession: boolean; readonly failed: boolean }>();
    authMocks.probeSession.mockReturnValue(sessionProbe.promise);
    await enqueueWrite(objectCommand('delayed-user-a-verdict'));
    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['user-2'], 'kept');
    const cleared = vi.spyOn(client, 'clear');

    const view = render(
      <QueryClientProvider client={client}>
        <OfflineSyncRuntime userId="user-1" />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(authMocks.probeSession).toHaveBeenCalledOnce();
    });

    setOnline(false);
    view.rerender(
      <QueryClientProvider client={client}>
        <OfflineSyncRuntime userId="user-2" />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(outboxUserId()).toBe('user-2');
    });
    await enqueueWrite(objectCommand('user-b-pending'));
    await act(async () => {
      sessionProbe.resolve({ hasSession: false, failed: false });
      await sessionProbe.promise;
    });

    expect(authMocks.purgeLocalSessionState).not.toHaveBeenCalled();
    expect(authMocks.requireAuthentication).not.toHaveBeenCalled();
    expect(cleared).not.toHaveBeenCalled();
    expect(client.getQueryData(['user-2'])).toBe('kept');
    expect(outboxUserId()).toBe('user-2');
    expect(outboxSnapshot()).toEqual([
      expect.objectContaining({ id: expect.any(String), userId: 'user-2' }),
    ]);
    view.unmount();
  });

  it('does not apply user A cleanup after revocation waits across a switch to user B', async () => {
    authMocks.probeSession.mockResolvedValue({ hasSession: false, failed: false });
    const revocation = deferred<'cleared' | 'superseded' | 'failed'>();
    authMocks.purgeLocalSessionState.mockReturnValue(revocation.promise);
    await enqueueWrite(objectCommand('revoking-user-a'));
    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['user-2'], 'kept');
    const cleared = vi.spyOn(client, 'clear');

    const view = render(
      <QueryClientProvider client={client}>
        <OfflineSyncRuntime userId="user-1" />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(authMocks.purgeLocalSessionState).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    setOnline(false);
    view.rerender(
      <QueryClientProvider client={client}>
        <OfflineSyncRuntime userId="user-2" />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(outboxUserId()).toBe('user-2');
    });
    await enqueueWrite(objectCommand('user-b-during-revocation'));
    revocation.resolve('superseded');
    await act(async () => {
      await revocation.promise;
    });

    expect(cleared).not.toHaveBeenCalled();
    expect(client.getQueryData(['user-2'])).toBe('kept');
    expect(outboxUserId()).toBe('user-2');
    expect(outboxSnapshot()).toEqual([
      expect.objectContaining({ userId: 'user-2', body: expect.stringContaining('user-b') }),
    ]);
    expect(authMocks.requireAuthentication).not.toHaveBeenCalled();
    view.unmount();
  });
});

afterEach(async () => {
  await setOutboxUser(null);
  setOnline(true);
  vi.restoreAllMocks();
});

describe('OfflineSyncIndicator', () => {
  it('renders nothing when there is nothing to say', () => {
    render(<OfflineSyncIndicator />, { wrapper: Wrapper });
    expect(screen.queryByTestId('offline-sync-indicator')).toBeNull();
  });

  it('states that changes are held here and will sync on reconnect', async () => {
    await enqueueWrite(objectCommand('rename-task', { title: 'Renamed' }));

    render(<OfflineSyncIndicator />, { wrapper: Wrapper });

    const indicator = await screen.findByTestId('offline-sync-indicator');
    expect(indicator.textContent).toContain('Saved on this device');
    expect(indicator.textContent).toContain("will sync as soon as you're back online");
  });

  it('gives every pending change its own visible marker', async () => {
    await enqueueWrite(objectCommand('indicator-task-rename', { title: 'Renamed' }));
    await enqueueWrite(objectCommand('indicator-task-create', { title: 'Created' }));

    render(<OfflineSyncIndicator />, { wrapper: Wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'Show changes' }));

    const markers = await screen.findAllByTestId('pending-sync-marker');
    expect(markers).toHaveLength(2);
    expect(markers.every((marker) => marker.textContent.includes('Pending sync'))).toBe(true);
    expect(screen.getAllByText('Object change')).toHaveLength(2);
  });

  it('clears the markers once the changes reach the server', async () => {
    await enqueueWrite(objectCommand('clear-marker'));
    render(<OfflineSyncIndicator />, { wrapper: Wrapper });
    await screen.findByTestId('offline-sync-indicator');

    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await drainOutbox();

    await waitFor(() => {
      expect(screen.queryByTestId('offline-sync-indicator')).toBeNull();
    });
  });

  it('offers a way out for a change the server refused', async () => {
    await enqueueWrite(objectCommand('refused-change'));
    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 409 }));
    await drainOutbox();

    render(<OfflineSyncIndicator />, { wrapper: Wrapper });
    const indicator = await screen.findByTestId('offline-sync-indicator');
    expect(indicator.textContent).toContain('Some changes were not sent');
    await userEvent.click(screen.getByRole('button', { name: 'Show changes' }));

    // A permanent notice with no way to act on it is the failure mode this avoids.
    expect(screen.getByRole('button', { name: 'Try Object change again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard Object change' })).toBeTruthy();
    expect(screen.getByTestId('pending-sync-marker').textContent).toContain('Needs attention');
  });

  it('does not offer to retry an expired idempotency key', async () => {
    store.set('docket:outbox:user-1', [
      {
        id: 'expired-command',
        userId: 'user-1',
        method: 'POST',
        path: '/v1/orgs/o1/object-commands',
        body: JSON.stringify({ commandId: 'expired-command' }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'expired-command',
        },
        label: 'Object change',
        createdAt: Date.now() - 24 * 60 * 60 * 1000 - 1,
        attempts: 1,
        status: 'blocked',
      },
    ]);
    await setOutboxUser(null);
    await setOutboxUser('user-1');
    expect(outboxSnapshot()[0]?.status).toBe('expired');

    render(<OfflineSyncIndicator />, { wrapper: Wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'Show changes' }));

    expect(screen.queryByRole('button', { name: 'Try Object change again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Discard Object change' })).toBeTruthy();
    expect(screen.getByTestId('offline-sync-indicator').textContent).not.toContain('Try it again');
  });

  it('disables manual retry until a blocked entry reaches the server deadline', async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    store.set('docket:outbox:user-1', [
      {
        id: 'paced-command',
        userId: 'user-1',
        method: 'POST',
        path: '/v1/orgs/o1/object-commands',
        body: JSON.stringify({ commandId: 'paced-command' }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'paced-command',
        },
        label: 'Object change',
        createdAt: now,
        notBeforeAt: now + 60_000,
        attempts: 5,
        status: 'blocked',
      },
    ]);
    await setOutboxUser(null);
    await setOutboxUser('user-1', now);

    render(<OfflineSyncIndicator />, { wrapper: Wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'Show changes' }));

    expect(screen.getByRole('button', { name: 'Try Object change again' })).toBeDisabled();
  });

  it('never leaks provider or exception text', async () => {
    await enqueueWrite(objectCommand('private-error'));
    render(<OfflineSyncIndicator />, { wrapper: Wrapper });
    const indicator = await screen.findByTestId('offline-sync-indicator');
    await userEvent.click(screen.getByRole('button', { name: 'Show changes' }));

    const text = indicator.textContent;
    for (const forbidden of ['TypeError', 'Failed to fetch', 'fetch', 'undefined', '/v1/']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('syncSentence', () => {
  it('promises a sync only while one is actually coming', () => {
    expect(syncSentence(1, 0, false)).toBe(
      "1 change is waiting here and will sync as soon as you're back online.",
    );
    expect(syncSentence(3, 0, true)).toBe('3 changes are syncing now.');
  });

  it('never promises a sync for a change that has stopped trying', () => {
    expect(syncSentence(0, 1, false)).toBe('1 change could not be sent. Review or discard it.');
    expect(syncSentence(0, 2, true)).toBe('2 changes could not be sent. Review or discard them.');
  });

  it('reports both facts when both are true', () => {
    expect(syncSentence(2, 1, false)).toContain("will sync when you're back online");
    expect(syncSentence(2, 1, false)).toContain('1 could not be sent');
  });
});
