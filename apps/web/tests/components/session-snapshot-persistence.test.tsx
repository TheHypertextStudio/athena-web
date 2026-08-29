import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  waitForOutboxSessionTransition: vi.fn<() => Promise<void>>(),
  writeSessionSnapshot: vi.fn(),
}));

vi.mock('@/components/pwa/outbox', () => ({
  waitForOutboxSessionTransition: mocks.waitForOutboxSessionTransition,
}));
vi.mock('@/lib/session-snapshot', () => ({
  writeSessionSnapshot: mocks.writeSessionSnapshot,
}));

import { SessionSnapshotPersistence } from '@/components/session-snapshot-persistence';

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SessionSnapshotPersistence', () => {
  it('writes replacement identity only after previous-account cleanup finishes', async () => {
    const gate = deferred();
    mocks.waitForOutboxSessionTransition.mockReturnValue(gate.promise);

    render(
      <SessionSnapshotPersistence
        identity={{ userId: 'user-b', name: 'B', email: 'b@example.com', image: null }}
      />,
    );
    await Promise.resolve();
    expect(mocks.writeSessionSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(mocks.writeSessionSnapshot).toHaveBeenCalledWith(
      { userId: 'user-b', name: 'B', email: 'b@example.com', image: null },
      expect.any(Number),
    );
  });

  it('drops an authenticated identity that became stale while it waited', async () => {
    const gate = deferred();
    mocks.waitForOutboxSessionTransition.mockReturnValue(gate.promise);
    const view = render(
      <SessionSnapshotPersistence
        identity={{ userId: 'user-a', name: 'A', email: 'a@example.com', image: null }}
      />,
    );

    view.rerender(<SessionSnapshotPersistence identity={null} />);
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(mocks.writeSessionSnapshot).not.toHaveBeenCalled();
  });
});
