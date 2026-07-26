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

const { probeSession, purgeLocalSessionState, signOutAndPurge, requireAuthentication } = vi.hoisted(
  () => ({
    probeSession: vi.fn(),
    purgeLocalSessionState: vi.fn(() => Promise.resolve()),
    signOutAndPurge: vi.fn(() => Promise.resolve()),
    requireAuthentication: vi.fn(),
  }),
);

vi.mock('../../src/lib/auth-client', () => ({ probeSession }));
vi.mock('../../src/lib/sign-out', () => ({ purgeLocalSessionState, signOutAndPurge }));
vi.mock('../../src/components/authentication-interlock', () => ({
  AuthenticationInterlockProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuthenticationInterlock: () => ({ requireAuthentication }),
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
  signOutAndPurge.mockClear();
  requireAuthentication.mockClear();
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
