import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  purgeAllNavigationSnapshots: vi.fn(() => Promise.resolve()),
  canQueueWrites: vi.fn(() => true),
  purgeAllOutboxes: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  purgeOutboxesForOwner: vi.fn<(_owner: unknown) => Promise<boolean>>(() => Promise.resolve(true)),
  suspendOutboxesForOwner: vi.fn(),
  commitOutboxSuspension: vi.fn<(_suspension: unknown) => Promise<boolean>>(() =>
    Promise.resolve(true),
  ),
  rollbackOutboxSuspension: vi.fn<(_suspension: unknown) => Promise<boolean>>(() =>
    Promise.resolve(true),
  ),
  purgeOfflineDocuments: vi.fn(() => Promise.resolve()),
  clearOutboxOwnerForSignOut: vi.fn(),
  captureOutboxOwner: vi.fn(),
  isCurrentOutboxOwner: vi.fn(() => true),
  withOutboxSessionTransition: vi.fn(),
  restoreOutboxUserAfterFailedSignOut: vi.fn<
    (userId: string) => Promise<'restored' | 'superseded' | 'failed'>
  >(() => Promise.resolve('restored')),
  signOut: vi.fn<
    (expectedUserId: string | null) => Promise<'signed-out' | 'owner-changed' | 'failed'>
  >(() => Promise.resolve('signed-out')),
  clearSessionSnapshot: vi.fn(),
}));

const ownerA = { userId: 'user-a', generation: 1, epoch: 'epoch-a' } as const;
const suspensionA = { owner: ownerA, suspendedEpoch: 'suspended-a' } as const;
const originalLocation = window.location;
const replaceLocation = vi.fn();

/** Create a promise whose completion this test controls. */
function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

vi.mock('@/components/pwa/outbox', () => ({
  captureOutboxOwner: mocks.captureOutboxOwner,
  clearOutboxOwnerForSignOut: mocks.clearOutboxOwnerForSignOut,
  isCurrentOutboxOwner: mocks.isCurrentOutboxOwner,
  restoreOutboxUserAfterFailedSignOut: mocks.restoreOutboxUserAfterFailedSignOut,
  withOutboxSessionTransition: mocks.withOutboxSessionTransition,
}));
vi.mock('@/components/pwa/outbox-store', () => ({
  canQueueWrites: mocks.canQueueWrites,
  commitOutboxSuspension: mocks.commitOutboxSuspension,
  purgeAllOutboxes: mocks.purgeAllOutboxes,
  purgeOutboxesForOwner: mocks.purgeOutboxesForOwner,
  rollbackOutboxSuspension: mocks.rollbackOutboxSuspension,
  suspendOutboxesForOwner: mocks.suspendOutboxesForOwner,
}));
vi.mock('@/components/pwa/purge-offline-documents', () => ({
  purgeOfflineDocuments: mocks.purgeOfflineDocuments,
}));
vi.mock('@/lib/auth-client', () => ({ signOut: mocks.signOut }));
vi.mock('@/lib/navigation-snapshot-runtime', () => ({
  purgeAllNavigationSnapshots: mocks.purgeAllNavigationSnapshots,
}));
vi.mock('@/lib/session-snapshot', () => ({ clearSessionSnapshot: mocks.clearSessionSnapshot }));

const { SignOutCleanupError, purgeLocalSessionState, signOutAndPurge } =
  await import('@/lib/sign-out');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.purgeAllOutboxes.mockResolvedValue(true);
  mocks.purgeOutboxesForOwner.mockResolvedValue(true);
  mocks.suspendOutboxesForOwner.mockResolvedValue(suspensionA);
  mocks.commitOutboxSuspension.mockResolvedValue(true);
  mocks.rollbackOutboxSuspension.mockResolvedValue(true);
  mocks.captureOutboxOwner.mockReturnValue(ownerA);
  mocks.canQueueWrites.mockReturnValue(true);
  mocks.isCurrentOutboxOwner.mockReturnValue(true);
  mocks.withOutboxSessionTransition.mockImplementation(async (_owner, operation) => {
    const replacementRequested = (): boolean => false;
    return {
      status: 'completed',
      value: await operation(mocks.clearOutboxOwnerForSignOut, replacementRequested),
      replacementRequested: replacementRequested(),
    };
  });
  mocks.restoreOutboxUserAfterFailedSignOut.mockResolvedValue('restored');
  mocks.signOut.mockResolvedValue('signed-out');
  replaceLocation.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { replace: replaceLocation },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('purgeLocalSessionState', () => {
  it('revokes the durable outbox before clearing any local session state', async () => {
    let releasePurge!: () => void;
    const purgeGate = new Promise<boolean>((resolve) => {
      releasePurge = () => {
        resolve(true);
      };
    });
    mocks.purgeOutboxesForOwner.mockImplementation(() => purgeGate);
    const queryClient = { clear: vi.fn() };

    const purging = purgeLocalSessionState(queryClient as never, ownerA);
    await Promise.resolve();

    expect(mocks.purgeOutboxesForOwner).toHaveBeenCalledExactlyOnceWith(ownerA);
    expect(mocks.clearOutboxOwnerForSignOut).not.toHaveBeenCalled();
    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(mocks.clearSessionSnapshot).not.toHaveBeenCalled();

    releasePurge();
    await expect(purging).resolves.toBe('cleared');

    expect(mocks.clearOutboxOwnerForSignOut).toHaveBeenCalledOnce();
    expect(queryClient.clear).toHaveBeenCalledOnce();
    expect(mocks.clearSessionSnapshot).toHaveBeenCalledOnce();
  });

  it('reports failed revocation without clearing an owner, cache, or session snapshot', async () => {
    mocks.purgeOutboxesForOwner.mockResolvedValue(false);
    const queryClient = { clear: vi.fn() };

    await expect(purgeLocalSessionState(queryClient as never, ownerA)).resolves.toBe('failed');

    expect(mocks.clearOutboxOwnerForSignOut).not.toHaveBeenCalled();
    expect(mocks.restoreOutboxUserAfterFailedSignOut).not.toHaveBeenCalled();
    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(mocks.clearSessionSnapshot).not.toHaveBeenCalled();
    expect(mocks.purgeAllNavigationSnapshots).not.toHaveBeenCalled();
    expect(mocks.purgeOfflineDocuments).not.toHaveBeenCalled();
  });

  it('does not start cleanup for a stale captured owner', async () => {
    mocks.withOutboxSessionTransition.mockResolvedValue({ status: 'stale' });
    const queryClient = { clear: vi.fn() };

    await expect(purgeLocalSessionState(queryClient as never, ownerA)).resolves.toBe('superseded');
    expect(mocks.purgeOutboxesForOwner).not.toHaveBeenCalled();
    expect(mocks.clearOutboxOwnerForSignOut).not.toHaveBeenCalled();
    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(mocks.clearSessionSnapshot).not.toHaveBeenCalled();
    expect(mocks.purgeAllNavigationSnapshots).not.toHaveBeenCalled();
    expect(mocks.purgeOfflineDocuments).not.toHaveBeenCalled();
  });

  it('cleans up a confirmed session without an owner when no durable store exists', async () => {
    mocks.canQueueWrites.mockReturnValue(false);
    const queryClient = { clear: vi.fn() };

    await expect(purgeLocalSessionState(queryClient as never, null)).resolves.toBe('cleared');

    expect(mocks.purgeAllOutboxes).toHaveBeenCalledOnce();
    expect(mocks.purgeOutboxesForOwner).not.toHaveBeenCalled();
    expect(mocks.clearOutboxOwnerForSignOut).toHaveBeenCalledOnce();
    expect(queryClient.clear).toHaveBeenCalledOnce();
  });

  it('does not delete replacement account state when B requests ownership during A cleanup', async () => {
    mocks.withOutboxSessionTransition.mockImplementation(async (_owner, operation) => {
      const replacementRequested = (): boolean => true;
      return {
        status: 'completed',
        value: await operation(mocks.clearOutboxOwnerForSignOut, replacementRequested),
        replacementRequested: replacementRequested(),
      };
    });
    const queryClient = { clear: vi.fn() };

    await expect(purgeLocalSessionState(queryClient as never, ownerA)).resolves.toBe('superseded');

    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(mocks.clearSessionSnapshot).not.toHaveBeenCalled();
    expect(mocks.purgeAllNavigationSnapshots).not.toHaveBeenCalled();
    expect(mocks.purgeOfflineDocuments).not.toHaveBeenCalled();
  });
});

describe('signOutAndPurge', () => {
  it('invalidates the local queue only after durable revocation and before network sign-out', async () => {
    const order: string[] = [];
    mocks.clearOutboxOwnerForSignOut.mockImplementation(() => {
      order.push('invalidate');
    });
    mocks.suspendOutboxesForOwner.mockImplementation(async () => {
      order.push('suspend');
      return suspensionA;
    });
    mocks.signOut.mockImplementation(() => {
      order.push('sign-out');
      return new Promise<'signed-out'>(() => undefined);
    });
    const queryClient = { clear: vi.fn() };

    void signOutAndPurge(queryClient as never, 'user-a');

    await vi.waitFor(() => {
      expect(order).toEqual(['suspend', 'invalidate', 'sign-out']);
    });
  });

  it('persists the outbox revocation barrier before the network sign-out starts', async () => {
    let releasePurge!: () => void;
    const purgeGate = new Promise<boolean>((resolve) => {
      releasePurge = () => {
        resolve(true);
      };
    });
    mocks.suspendOutboxesForOwner.mockImplementation(async () =>
      (await purgeGate) ? suspensionA : null,
    );
    mocks.signOut.mockImplementation(() => new Promise<'signed-out'>(() => undefined));
    const queryClient = { clear: vi.fn() };

    void signOutAndPurge(queryClient as never, 'user-a');
    await Promise.resolve();

    expect(mocks.suspendOutboxesForOwner).toHaveBeenCalledExactlyOnceWith(ownerA);
    expect(mocks.clearOutboxOwnerForSignOut).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();

    releasePurge();
    await vi.waitFor(() => {
      expect(mocks.signOut).toHaveBeenCalledOnce();
    });
  });

  it('does not end the network session when durable revocation fails', async () => {
    mocks.suspendOutboxesForOwner.mockResolvedValue(null);
    const queryClient = { clear: vi.fn() };

    await expect(signOutAndPurge(queryClient as never, 'user-a')).rejects.toThrow(
      'Could not finish sign-out safely',
    );

    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.clearOutboxOwnerForSignOut).not.toHaveBeenCalled();
  });

  it('does not repeat durable revocation after explicit sign-out starts', async () => {
    const queryClient = { clear: vi.fn() };

    await signOutAndPurge(queryClient as never, 'user-a');

    expect(mocks.suspendOutboxesForOwner).toHaveBeenCalledOnce();
    expect(mocks.commitOutboxSuspension).toHaveBeenCalledExactlyOnceWith(suspensionA);
    expect(mocks.clearOutboxOwnerForSignOut).toHaveBeenCalledOnce();
    expect(queryClient.clear).toHaveBeenCalledOnce();
  });

  it('does not clear global browser state until the account-bound network sign-out succeeds', async () => {
    const network = deferred<'signed-out' | 'owner-changed' | 'failed'>();
    mocks.signOut.mockReturnValue(network.promise);
    const queryClient = { clear: vi.fn() };

    const signingOut = signOutAndPurge(queryClient as never, 'user-a');
    await vi.waitFor(() => {
      expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith('user-a');
    });

    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(mocks.purgeOfflineDocuments).not.toHaveBeenCalled();

    network.resolve('signed-out');
    await signingOut;
    expect(queryClient.clear).toHaveBeenCalledOnce();
    expect(mocks.purgeOfflineDocuments).toHaveBeenCalledOnce();
  });

  it('binds explicit sign-out revocation to the captured owner generation', async () => {
    const queryClient = { clear: vi.fn() };

    await signOutAndPurge(queryClient as never, 'user-a');

    expect(mocks.captureOutboxOwner).toHaveBeenCalledOnce();
    expect(mocks.suspendOutboxesForOwner).toHaveBeenCalledExactlyOnceWith(ownerA);
    expect(mocks.purgeAllOutboxes).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith('user-a');
    expect(mocks.commitOutboxSuspension).toHaveBeenCalledExactlyOnceWith(suspensionA);
  });

  it('refuses explicit sign-out when its captured account has not bound locally', async () => {
    mocks.captureOutboxOwner.mockReturnValue(null);
    const queryClient = { clear: vi.fn() };

    await expect(signOutAndPurge(queryClient as never, 'user-a')).rejects.toThrow(
      'Could not finish sign-out safely',
    );

    expect(mocks.purgeAllOutboxes).not.toHaveBeenCalled();
    expect(mocks.purgeOutboxesForOwner).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('refuses explicit sign-out when the rendered account and outbox owner differ', async () => {
    const queryClient = { clear: vi.fn() };

    await expect(signOutAndPurge(queryClient as never, 'user-b')).rejects.toThrow(
      'Could not finish sign-out safely',
    );

    expect(mocks.purgeAllOutboxes).not.toHaveBeenCalled();
    expect(mocks.purgeOutboxesForOwner).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('does not navigate after the server reports that the current account changed', async () => {
    mocks.signOut.mockResolvedValue('owner-changed');
    const queryClient = { clear: vi.fn() };

    await expect(signOutAndPurge(queryClient as never, 'user-a')).resolves.toBeUndefined();

    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith('user-a');
    expect(mocks.commitOutboxSuspension).toHaveBeenCalledExactlyOnceWith(suspensionA);
    expect(replaceLocation).not.toHaveBeenCalled();
    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(mocks.restoreOutboxUserAfterFailedSignOut).not.toHaveBeenCalled();
  });

  it('rebinds the same account without clearing global state when network sign-out fails', async () => {
    mocks.signOut.mockResolvedValue('failed');
    const queryClient = { clear: vi.fn() };

    await expect(signOutAndPurge(queryClient as never, 'user-a')).rejects.toThrow(
      'Could not finish sign-out safely',
    );

    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(mocks.purgeOfflineDocuments).not.toHaveBeenCalled();
    expect(mocks.rollbackOutboxSuspension).toHaveBeenCalledExactlyOnceWith(suspensionA);
    expect(mocks.restoreOutboxUserAfterFailedSignOut).toHaveBeenCalledExactlyOnceWith('user-a');
    expect(replaceLocation).not.toHaveBeenCalled();
  });

  it('does not clear or navigate when confirmed sign-out cannot commit durable cleanup', async () => {
    mocks.commitOutboxSuspension.mockResolvedValue(false);
    const queryClient = { clear: vi.fn() };

    await expect(signOutAndPurge(queryClient as never, 'user-a')).rejects.toBeInstanceOf(
      SignOutCleanupError,
    );

    expect(mocks.commitOutboxSuspension).toHaveBeenCalledTimes(3);
    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(mocks.purgeOfflineDocuments).not.toHaveBeenCalled();
    expect(mocks.restoreOutboxUserAfterFailedSignOut).not.toHaveBeenCalled();
    expect(replaceLocation).not.toHaveBeenCalled();
  });

  it('reports a cleanup failure when same-account queue restoration cannot rejoin', async () => {
    mocks.signOut.mockResolvedValue('failed');
    mocks.restoreOutboxUserAfterFailedSignOut.mockResolvedValue('failed');
    const queryClient = { clear: vi.fn() };

    await expect(signOutAndPurge(queryClient as never, 'user-a')).rejects.toBeInstanceOf(
      SignOutCleanupError,
    );

    expect(mocks.rollbackOutboxSuspension).toHaveBeenCalledExactlyOnceWith(suspensionA);
    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(replaceLocation).not.toHaveBeenCalled();
  });
});
