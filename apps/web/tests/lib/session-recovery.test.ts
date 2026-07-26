import { describe, expect, it, vi } from 'vitest';

import {
  createUnauthorizedConfirmer,
  resolveUnauthorizedVerdict,
  type SessionProbe,
} from '@/lib/session-recovery';

/**
 * These tests pin the rule that a data endpoint's `401` is evidence, not a verdict.
 *
 * The bug this module was written for: the global query `onError` treated any `401` as proof of
 * sign-out and reacted by calling Better Auth `signOut()` plus a hard redirect to `/sign-in`. Because
 * that *destroyed* the session cookie, a transient `401` — an API cold start, a read racing the daily
 * session-record rotation, a proxy blip — turned a perfectly valid session into a real one, and the
 * person was made to run a fresh passkey ceremony. The failure manufactured its own evidence, which
 * is why it kept recurring.
 */
describe('resolveUnauthorizedVerdict', () => {
  const base: SessionProbe = { hasSession: false, failed: false };

  it('reports the session live when the authority still has one', () => {
    // The 401 came from something else — a scoped endpoint, a cold start, a rotation race.
    expect(resolveUnauthorizedVerdict({ ...base, hasSession: true })).toBe('session-live');
  });

  it('reports the session ended only when the authority confirms no session', () => {
    expect(resolveUnauthorizedVerdict(base)).toBe('session-ended');
  });

  it('reports unconfirmed when the probe could not get an answer', () => {
    expect(resolveUnauthorizedVerdict({ ...base, failed: true })).toBe('unconfirmed');
  });

  it('never reads a failed probe as a sign-out', () => {
    // The regression that matters. Both states have `hasSession: false`; only `failed` separates
    // "you are signed out" from "I could not ask". Collapsing them is the original bug.
    const unreachable = resolveUnauthorizedVerdict({ hasSession: false, failed: true });
    const signedOut = resolveUnauthorizedVerdict({ hasSession: false, failed: false });
    expect(unreachable).not.toBe(signedOut);
    expect(unreachable).toBe('unconfirmed');
  });

  it('lets an unusable probe outrank whatever it claimed about the session', () => {
    expect(resolveUnauthorizedVerdict({ hasSession: true, failed: true })).toBe('unconfirmed');
  });
});

describe('createUnauthorizedConfirmer', () => {
  it('collapses a burst of concurrent 401s into a single probe', async () => {
    // One expired session typically fails several mounted queries at once (the shell's org list, the
    // page's read, a poll). Each reports through the global handler; they must not each interrogate
    // the session endpoint and each tear state down.
    const probe = vi.fn(async (): Promise<SessionProbe> => ({ hasSession: false, failed: false }));
    const confirm = createUnauthorizedConfirmer(probe);

    const verdicts = await Promise.all([confirm(), confirm(), confirm()]);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(verdicts).toEqual(['session-ended', 'session-ended', 'session-ended']);
  });

  it('asks again for a later 401 rather than reusing a settled verdict', async () => {
    // De-duplication, not a one-shot latch: a session that was live during the first burst can
    // legitimately have ended by the time a later request fails.
    const probe = vi
      .fn<() => Promise<SessionProbe>>()
      .mockResolvedValueOnce({ hasSession: true, failed: false })
      .mockResolvedValueOnce({ hasSession: false, failed: false });
    const confirm = createUnauthorizedConfirmer(probe);

    expect(await confirm()).toBe('session-live');
    expect(await confirm()).toBe('session-ended');
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('treats a throwing probe as unconfirmed instead of propagating', async () => {
    // A broken probe must never escalate into a teardown, and callers must not have to guard.
    const confirm = createUnauthorizedConfirmer(() => Promise.reject(new Error('offline')));

    await expect(confirm()).resolves.toBe('unconfirmed');
  });

  it('recovers after a throwing probe', async () => {
    const probe = vi
      .fn<() => Promise<SessionProbe>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ hasSession: true, failed: false });
    const confirm = createUnauthorizedConfirmer(probe);

    expect(await confirm()).toBe('unconfirmed');
    expect(await confirm()).toBe('session-live');
  });
});
