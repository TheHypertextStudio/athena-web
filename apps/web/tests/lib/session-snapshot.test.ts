import { beforeEach, describe, expect, it } from 'vitest';

import {
  SNAPSHOT_MAX_AGE_MS,
  clearSessionSnapshot,
  readSessionSnapshot,
  writeSessionSnapshot,
} from '@/lib/session-snapshot';

const IDENTITY = {
  userId: 'usr_123',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  image: null,
};

const NOW = 1_800_000_000_000;

describe('session snapshot', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips the stored identity', () => {
    writeSessionSnapshot(IDENTITY, NOW);
    expect(readSessionSnapshot(NOW)).toEqual({ ...IDENTITY, savedAt: NOW });
  });

  it('returns null when nothing has been stored', () => {
    expect(readSessionSnapshot(NOW)).toBeNull();
  });

  it('expires a snapshot past its maximum age', () => {
    writeSessionSnapshot(IDENTITY, NOW);
    expect(readSessionSnapshot(NOW + SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
  });

  it('still returns a snapshot at exactly the age boundary', () => {
    writeSessionSnapshot(IDENTITY, NOW);
    expect(readSessionSnapshot(NOW + SNAPSHOT_MAX_AGE_MS)).not.toBeNull();
  });

  it('forgets the identity when cleared', () => {
    // Sign-out and session expiry both clear before redirecting, so "signed out, then offline"
    // can never render a shell.
    writeSessionSnapshot(IDENTITY, NOW);
    clearSessionSnapshot();
    expect(readSessionSnapshot(NOW)).toBeNull();
  });

  it('rejects a malformed stored value rather than trusting it', () => {
    window.localStorage.setItem('docket:session-snapshot', '{"userId":42}');
    expect(readSessionSnapshot(NOW)).toBeNull();
  });

  it('rejects a value that is not JSON at all', () => {
    window.localStorage.setItem('docket:session-snapshot', 'not json');
    expect(readSessionSnapshot(NOW)).toBeNull();
  });

  it('rejects an entry with an empty user id', () => {
    // The user id is the cache-partition key; an empty one would collide across accounts.
    window.localStorage.setItem(
      'docket:session-snapshot',
      JSON.stringify({ ...IDENTITY, userId: '', savedAt: NOW }),
    );
    expect(readSessionSnapshot(NOW)).toBeNull();
  });

  it('never stores a session token', () => {
    // The snapshot is display identity only. Better Auth's cookie is HttpOnly and must stay the
    // sole proof of authentication — nothing here may be replayable.
    writeSessionSnapshot(IDENTITY, NOW);
    const raw = window.localStorage.getItem('docket:session-snapshot') ?? '';
    expect(raw).not.toMatch(/token|session_token|bearer/i);
  });
});
