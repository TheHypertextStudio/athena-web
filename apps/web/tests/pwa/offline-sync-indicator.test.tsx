import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type JSX, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('idb-keyval', () => ({
  get: (key: string) => Promise.resolve(store.get(key)),
  set: (key: string, value: unknown) => {
    store.set(key, value);
    return Promise.resolve();
  },
  del: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
  keys: () => Promise.resolve([...store.keys()]),
}));

const { OfflineSyncIndicator, syncSentence } = await import('@/components/pwa/offline-sync');
const { drainOutbox, enqueueWrite, setOutboxUser } = await import('@/components/pwa/outbox');

function Wrapper({ children }: { readonly children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Pretend the device has no connection, the way `navigator.onLine` reports it. */
function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

beforeEach(async () => {
  Object.defineProperty(window, 'indexedDB', { value: {}, configurable: true });
  store.clear();
  setOnline(false);
  await setOutboxUser(null);
  await setOutboxUser('user-1');
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
    await enqueueWrite({
      method: 'PATCH',
      path: '/v1/orgs/o1/tasks/t1',
      body: '{"title":"Renamed"}',
      contentType: 'application/json',
    });

    render(<OfflineSyncIndicator />, { wrapper: Wrapper });

    const indicator = await screen.findByTestId('offline-sync-indicator');
    expect(indicator.textContent).toContain('Saved on this device');
    expect(indicator.textContent).toContain("will sync as soon as you're back online");
  });

  it('gives every pending change its own visible marker', async () => {
    await enqueueWrite({
      method: 'PATCH',
      path: '/v1/orgs/o1/tasks/t1',
      body: '{}',
      contentType: 'application/json',
    });
    await enqueueWrite({
      method: 'POST',
      path: '/v1/orgs/o1/tasks',
      body: '{}',
      contentType: 'application/json',
    });

    render(<OfflineSyncIndicator />, { wrapper: Wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'Show changes' }));

    const markers = await screen.findAllByTestId('pending-sync-marker');
    expect(markers).toHaveLength(2);
    expect(markers.every((marker) => marker.textContent.includes('Pending sync'))).toBe(true);
    // Each row names the change, so "did my rename go through?" is answerable.
    expect(screen.getByText('Task change')).toBeTruthy();
    expect(screen.getByText('New task')).toBeTruthy();
  });

  it('clears the markers once the changes reach the server', async () => {
    await enqueueWrite({
      method: 'PATCH',
      path: '/v1/orgs/o1/tasks/t1',
      body: '{}',
      contentType: 'application/json',
    });
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
    await enqueueWrite({
      method: 'PATCH',
      path: '/v1/orgs/o1/tasks/t1',
      body: '{}',
      contentType: 'application/json',
    });
    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 409 }));
    await drainOutbox();

    render(<OfflineSyncIndicator />, { wrapper: Wrapper });
    const indicator = await screen.findByTestId('offline-sync-indicator');
    expect(indicator.textContent).toContain('Some changes were not sent');
    await userEvent.click(screen.getByRole('button', { name: 'Show changes' }));

    // A permanent notice with no way to act on it is the failure mode this avoids.
    expect(screen.getByRole('button', { name: 'Try Task change again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard Task change' })).toBeTruthy();
    expect(screen.getByTestId('pending-sync-marker').textContent).toContain('Needs attention');
  });

  it('never leaks provider or exception text', async () => {
    await enqueueWrite({
      method: 'PATCH',
      path: '/v1/orgs/o1/tasks/t1',
      body: '{}',
      contentType: 'application/json',
    });
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
    expect(syncSentence(0, 1, false)).toBe(
      '1 change could not be sent. Try it again or discard it.',
    );
    expect(syncSentence(0, 2, true)).toBe(
      '2 changes could not be sent. Try them again or discard them.',
    );
  });

  it('reports both facts when both are true', () => {
    expect(syncSentence(2, 1, false)).toContain("will sync when you're back online");
    expect(syncSentence(2, 1, false)).toContain('1 could not be sent');
  });
});
