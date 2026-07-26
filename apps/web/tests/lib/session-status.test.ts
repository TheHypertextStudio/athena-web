import { describe, expect, it } from 'vitest';

import { resolveSessionStatus } from '@/lib/session-status';

/**
 * The whole point of this module is that "signed out" and "could not ask" are different answers.
 * These tests pin that distinction, because collapsing it is what makes an installed PWA demand a
 * sign-in from someone who is merely offline.
 */
describe('resolveSessionStatus', () => {
  const base = { hasSession: false, isPending: false, hasError: false, pendingTimedOut: false };

  it('reports pending while the query is in flight', () => {
    expect(resolveSessionStatus({ ...base, isPending: true })).toBe('pending');
  });

  it('reports authenticated once a session resolves', () => {
    expect(resolveSessionStatus({ ...base, hasSession: true })).toBe('authenticated');
  });

  it('reports signed-out when the server answered with no session', () => {
    // Better Auth answers 200 with a null body when there is no session, so this settles with
    // no session AND no error. This is the only state permitted to open the sign-in interlock.
    expect(resolveSessionStatus(base)).toBe('signed-out');
  });

  it('reports unreachable when the query failed rather than answering', () => {
    expect(resolveSessionStatus({ ...base, hasError: true })).toBe('unreachable');
  });

  it('does not mistake an unreachable server for a signed-out user', () => {
    // The regression this module exists to prevent: both states have no session, and only the
    // error flag separates them.
    const offline = resolveSessionStatus({ ...base, hasError: true });
    const signedOut = resolveSessionStatus({ ...base, hasError: false });
    expect(offline).not.toBe(signedOut);
    expect(offline).toBe('unreachable');
  });

  it('treats a pend that outlives its budget as unreachable', () => {
    // Captive portal: the request hangs instead of failing, so isPending never flips.
    expect(resolveSessionStatus({ ...base, isPending: true, pendingTimedOut: true })).toBe(
      'unreachable',
    );
  });

  it('keeps a live session authenticated when a background refetch errors', () => {
    // Better Auth preserves the previous value on a network failure and only nulls data on a 401.
    // Someone signed in must not be interrupted because a refresh landed as the connection dropped.
    expect(resolveSessionStatus({ ...base, hasSession: true, hasError: true })).toBe(
      'authenticated',
    );
  });

  it('prefers a resolved session over a still-pending refetch', () => {
    expect(resolveSessionStatus({ ...base, hasSession: true, isPending: true })).toBe(
      'authenticated',
    );
  });
});
