/**
 * Regression tests for what a `401` from a data endpoint is allowed to do.
 *
 * @remarks
 * The bug: the global TanStack `onError` treated any {@link SessionExpiredError} — from a foreground
 * read, a mutation, or a silent background refetch, and `refetchOnWindowFocus` is on — as proof the
 * person had been signed out. It reacted with `signOutAndPurge`: Better Auth `signOut()`, then
 * `window.location.replace('/sign-in')` with no `callbackURL`.
 *
 * Because that call *destroyed* the session cookie, a `401` that was merely transient — an API cold
 * start, a read racing the daily `session.updateAge` rotation, a blip in the Next rewrite proxy —
 * converted a valid session into a genuinely dead one. The person was then honestly required to run a
 * fresh passkey ceremony, and it recurred every time the race did. The failure manufactured its own
 * evidence.
 *
 * These tests pin the replacement rule: a `401` is evidence to check against `/get-session`, and only
 * a confirmed "no session" may tear anything down. Nothing on this path may ever call `signOut()`.
 */
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { type JSX, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  probeSession,
  purgeLocalSessionState,
  signOutAndPurge,
  requireAuthentication,
  reportSessionCleanupFailure,
} = vi.hoisted(() => ({
  probeSession: vi.fn(),
  purgeLocalSessionState: vi.fn(() => Promise.resolve('cleared')),
  signOutAndPurge: vi.fn(() => Promise.resolve()),
  requireAuthentication: vi.fn(),
  reportSessionCleanupFailure: vi.fn(),
}));
const outboxMocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    captureOutboxOwner: vi.fn(),
    isCurrentOutboxOwner: vi.fn(),
    listeners,
    subscribeOutbox: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
});
const storageMocks = vi.hoisted(() => ({ canQueueWrites: vi.fn(() => true) }));

const ownerA = { userId: 'user-a', generation: 1, epoch: 'epoch-a' } as const;

vi.mock('../../src/lib/auth-client', () => ({ probeSession }));
vi.mock('../../src/lib/sign-out', () => ({ purgeLocalSessionState, signOutAndPurge }));
vi.mock('../../src/components/pwa/outbox', () => outboxMocks);
vi.mock('../../src/components/pwa/outbox-store', () => storageMocks);
vi.mock('../../src/components/authentication-interlock', () => ({
  AuthenticationInterlockProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuthenticationInterlock: () => ({ requireAuthentication, reportSessionCleanupFailure }),
}));

import { UnauthorizedWatcher } from '../../src/components/providers';
import { createQueryClient, SessionExpiredError } from '../../src/lib/query';

/** A surface whose read fails the way an expired-or-transient `401` does. */
function FailingRead(): JSX.Element {
  const q = useQuery({
    queryKey: ['unauthorized-probe'],
    queryFn: () => Promise.reject(new SessionExpiredError()),
  });
  return <span>{q.isError ? 'read failed' : 'loading'}</span>;
}

/**
 * Mount the watcher over a failing read, wiring the same handler-slot indirection `Providers` uses.
 */
function Harness(): JSX.Element {
  const handlerRef = useRef<((error: unknown) => void) | null>(null);
  const [client] = useState(() =>
    createQueryClient({
      onError: (error) => {
        handlerRef.current?.(error);
      },
    }),
  );
  return (
    <QueryClientProvider client={client}>
      <UnauthorizedWatcher handlerRef={handlerRef} />
      <FailingRead />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  probeSession.mockReset();
  purgeLocalSessionState.mockClear();
  purgeLocalSessionState.mockResolvedValue('cleared');
  signOutAndPurge.mockClear();
  requireAuthentication.mockClear();
  reportSessionCleanupFailure.mockClear();
  outboxMocks.captureOutboxOwner.mockReset();
  outboxMocks.captureOutboxOwner.mockReturnValue(ownerA);
  outboxMocks.isCurrentOutboxOwner.mockReset();
  outboxMocks.isCurrentOutboxOwner.mockReturnValue(true);
  outboxMocks.listeners.clear();
  outboxMocks.subscribeOutbox.mockReset();
  outboxMocks.subscribeOutbox.mockImplementation((listener: () => void) => {
    outboxMocks.listeners.add(listener);
    return () => {
      outboxMocks.listeners.delete(listener);
    };
  });
  storageMocks.canQueueWrites.mockReset();
  storageMocks.canQueueWrites.mockReturnValue(true);
});

afterEach(cleanup);

describe('UnauthorizedWatcher', () => {
  it('leaves a live session alone when one endpoint 401s', async () => {
    // The headline regression. `/get-session` still has a session, so the 401 was scoped or
    // transient: the read reports its own failure and nothing else happens.
    probeSession.mockResolvedValue({ hasSession: true, failed: false });

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByText('read failed')).toBeTruthy();
    });
    await waitFor(() => {
      expect(probeSession).toHaveBeenCalled();
    });

    expect(purgeLocalSessionState).not.toHaveBeenCalled();
    expect(requireAuthentication).not.toHaveBeenCalled();
  });

  it('never signs the person out in reaction to a 401', async () => {
    // `signOut()` is what made the old bug self-fulfilling: it destroyed the very session whose
    // validity was in question. No verdict may reach it from this path.
    for (const probe of [
      { hasSession: true, failed: false },
      { hasSession: false, failed: false },
      { hasSession: false, failed: true },
    ]) {
      probeSession.mockReset();
      probeSession.mockResolvedValue(probe);
      const view = render(<Harness />);
      await waitFor(() => {
        expect(probeSession).toHaveBeenCalled();
      });
      view.unmount();
    }

    expect(signOutAndPurge).not.toHaveBeenCalled();
  });

  it('changes nothing when the session authority cannot be reached', async () => {
    // Offline or a 5xx on `/get-session`. "I could not ask" is not "you are signed out"; tearing
    // state down here is what shoved a sign-in prompt at someone on a flaky connection.
    probeSession.mockResolvedValue({ hasSession: false, failed: true });

    render(<Harness />);

    await waitFor(() => {
      expect(probeSession).toHaveBeenCalled();
    });

    expect(purgeLocalSessionState).not.toHaveBeenCalled();
    expect(requireAuthentication).not.toHaveBeenCalled();
  });

  it('purges and asks for sign-in once the session is confirmed gone', async () => {
    // The genuine case still has to work — an actually-expired session must not leave the previous
    // person's persisted cache on disk.
    probeSession.mockResolvedValue({ hasSession: false, failed: false });

    render(<Harness />);

    await waitFor(() => {
      expect(purgeLocalSessionState).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(requireAuthentication).toHaveBeenCalled();
    });
  });

  it('does not ask for sign-in when durable queue revocation fails', async () => {
    probeSession.mockResolvedValue({ hasSession: false, failed: false });
    purgeLocalSessionState.mockResolvedValue('failed');

    render(<Harness />);

    await waitFor(() => {
      expect(purgeLocalSessionState).toHaveBeenCalled();
      expect(reportSessionCleanupFailure).toHaveBeenCalledOnce();
    });
    expect(requireAuthentication).not.toHaveBeenCalled();
  });

  it('discards a delayed user A verdict after the outbox generation changes', async () => {
    let resolveProbe!: (probe: { readonly hasSession: boolean; readonly failed: boolean }) => void;
    probeSession.mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );

    render(<Harness />);
    await waitFor(() => {
      expect(probeSession).toHaveBeenCalledOnce();
    });

    outboxMocks.isCurrentOutboxOwner.mockReturnValue(false);
    resolveProbe({ hasSession: false, failed: false });

    await waitFor(() => {
      expect(outboxMocks.isCurrentOutboxOwner).toHaveBeenCalledWith(ownerA);
    });
    expect(purgeLocalSessionState).not.toHaveBeenCalled();
    expect(requireAuthentication).not.toHaveBeenCalled();
  });

  it('does not apply user A cleanup after revocation waits across a generation change', async () => {
    probeSession.mockResolvedValue({ hasSession: false, failed: false });
    let resolvePurge!: (result: 'cleared' | 'superseded' | 'failed') => void;
    purgeLocalSessionState.mockReturnValue(
      new Promise((resolve) => {
        resolvePurge = resolve;
      }),
    );

    render(<Harness />);
    await waitFor(() => {
      expect(purgeLocalSessionState).toHaveBeenCalledWith(expect.anything(), ownerA);
    });

    outboxMocks.isCurrentOutboxOwner.mockReturnValue(false);
    resolvePurge('superseded');

    await waitFor(() => {
      expect(purgeLocalSessionState).toHaveResolved();
    });
    expect(requireAuthentication).not.toHaveBeenCalled();
  });

  it('confirms and cleans up an ownerless session when no durable store exists', async () => {
    outboxMocks.captureOutboxOwner.mockReturnValue(null);
    storageMocks.canQueueWrites.mockReturnValue(false);
    probeSession.mockResolvedValue({ hasSession: false, failed: false });

    render(<Harness />);

    await waitFor(() => {
      expect(probeSession).toHaveBeenCalledOnce();
      expect(purgeLocalSessionState).toHaveBeenCalledWith(expect.anything(), null);
      expect(requireAuthentication).toHaveBeenCalled();
    });
  });

  it('reprobes after an owner binds instead of applying an ownerless verdict', async () => {
    let resolveOwnerlessProbe!: (probe: {
      readonly hasSession: boolean;
      readonly failed: boolean;
    }) => void;
    outboxMocks.captureOutboxOwner.mockReturnValue(null);
    probeSession
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOwnerlessProbe = resolve;
        }),
      )
      .mockResolvedValueOnce({ hasSession: false, failed: false });

    render(<Harness />);
    await waitFor(() => {
      expect(probeSession).toHaveBeenCalledOnce();
    });

    resolveOwnerlessProbe({ hasSession: false, failed: false });
    await waitFor(() => {
      expect(outboxMocks.subscribeOutbox).toHaveBeenCalledOnce();
    });
    expect(purgeLocalSessionState).not.toHaveBeenCalled();

    outboxMocks.captureOutboxOwner.mockReturnValue(ownerA);
    for (const listener of outboxMocks.listeners) listener();

    await waitFor(() => {
      expect(probeSession).toHaveBeenCalledTimes(2);
      expect(purgeLocalSessionState).toHaveBeenCalledWith(expect.anything(), ownerA);
      expect(requireAuthentication).toHaveBeenCalled();
    });
  });

  it('recaptures immediately after subscribing so a bind in that interval is not missed', async () => {
    outboxMocks.captureOutboxOwner.mockReturnValue(null);
    outboxMocks.subscribeOutbox.mockImplementation((listener: () => void) => {
      outboxMocks.captureOutboxOwner.mockReturnValue(ownerA);
      outboxMocks.listeners.add(listener);
      return () => {
        outboxMocks.listeners.delete(listener);
      };
    });
    probeSession.mockResolvedValue({ hasSession: false, failed: false });

    render(<Harness />);

    await waitFor(() => {
      expect(probeSession).toHaveBeenCalledTimes(2);
      expect(purgeLocalSessionState).toHaveBeenCalledWith(expect.anything(), ownerA);
      expect(requireAuthentication).toHaveBeenCalled();
    });
  });

  it('cancels a pending owner wait when the watcher unmounts', async () => {
    outboxMocks.captureOutboxOwner.mockReturnValue(null);
    probeSession.mockResolvedValue({ hasSession: false, failed: false });

    const view = render(<Harness />);
    await waitFor(() => {
      expect(outboxMocks.subscribeOutbox).toHaveBeenCalledOnce();
    });

    view.unmount();
    expect(outboxMocks.listeners.size).toBe(0);
    outboxMocks.captureOutboxOwner.mockReturnValue(ownerA);
    for (const listener of outboxMocks.listeners) listener();
    await Promise.resolve();

    expect(probeSession).toHaveBeenCalledOnce();
    expect(purgeLocalSessionState).not.toHaveBeenCalled();
    expect(requireAuthentication).not.toHaveBeenCalled();
  });

  it('offers to return the person to where they were', async () => {
    // The old path hard-navigated with no `callbackURL`, so a lapsed session also cost you your
    // place. The interlock is told the current location instead.
    window.history.replaceState(null, '', '/orgs/acme/my-work?filter=today');
    probeSession.mockResolvedValue({ hasSession: false, failed: false });

    render(<Harness />);

    await waitFor(() => {
      expect(requireAuthentication).toHaveBeenCalledWith('/orgs/acme/my-work?filter=today');
    });
  });

  it('ignores ordinary failures that are not authentication problems', async () => {
    probeSession.mockResolvedValue({ hasSession: false, failed: false });

    function PlainFailure(): JSX.Element {
      const q = useQuery({
        queryKey: ['plain'],
        queryFn: () => Promise.reject(new Error('a 500, not a 401')),
        retry: false,
      });
      return <span>{q.isError ? 'plain failed' : 'loading'}</span>;
    }

    function PlainHarness(): JSX.Element {
      const handlerRef = useRef<((error: unknown) => void) | null>(null);
      const [client] = useState(() =>
        createQueryClient({
          onError: (error) => {
            handlerRef.current?.(error);
          },
        }),
      );
      return (
        <QueryClientProvider client={client}>
          <UnauthorizedWatcher handlerRef={handlerRef} />
          <PlainFailure />
        </QueryClientProvider>
      );
    }

    render(<PlainHarness />);

    await waitFor(() => {
      expect(screen.getByText('plain failed')).toBeTruthy();
    });

    expect(probeSession).not.toHaveBeenCalled();
    expect(purgeLocalSessionState).not.toHaveBeenCalled();
  });
});
