import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setNavigationSnapshotUser: vi.fn(),
  waitForOutboxSessionTransition: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/components/pwa/outbox', () => ({
  waitForOutboxSessionTransition: mocks.waitForOutboxSessionTransition,
}));
vi.mock('@/lib/navigation-snapshot-runtime', () => ({
  setNavigationSnapshotUser: mocks.setNavigationSnapshotUser,
}));

import { NavigationSnapshotPersistence } from '@/components/navigation-snapshot-persistence';

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

describe('NavigationSnapshotPersistence', () => {
  it('binds a replacement account only after previous-account cleanup releases it', async () => {
    const gate = deferred();
    mocks.waitForOutboxSessionTransition.mockReturnValue(gate.promise);

    render(<NavigationSnapshotPersistence userId="user-b" />);
    await Promise.resolve();
    expect(mocks.setNavigationSnapshotUser).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(mocks.setNavigationSnapshotUser).toHaveBeenCalledExactlyOnceWith('user-b');
  });

  it('cancels a stale binding without clearing the newer account on cleanup', async () => {
    const staleGate = deferred();
    mocks.waitForOutboxSessionTransition
      .mockReturnValueOnce(staleGate.promise)
      .mockResolvedValueOnce();
    const view = render(<NavigationSnapshotPersistence userId="user-a" />);

    view.rerender(<NavigationSnapshotPersistence userId="user-b" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.setNavigationSnapshotUser).toHaveBeenCalledExactlyOnceWith('user-b');

    await act(async () => {
      staleGate.resolve();
      await staleGate.promise;
    });
    expect(mocks.setNavigationSnapshotUser).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(mocks.setNavigationSnapshotUser).not.toHaveBeenCalledWith(null);
  });
});
