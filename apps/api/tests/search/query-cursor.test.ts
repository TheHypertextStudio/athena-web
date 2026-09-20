import { describe, expect, it } from 'vitest';

import {
  decodeBrowseCursor,
  encodeBrowseCursor,
  fingerprintSearchQuery,
} from '../../src/search/query-cursor';

describe('search query cursors', () => {
  it('binds a cursor to the normalized query fingerprint', () => {
    const fingerprint = fingerprintSearchQuery({ query: 'roadmap', kinds: ['task'] });
    const cursor = encodeBrowseCursor('row-position', fingerprint);
    expect(decodeBrowseCursor(cursor, fingerprint)).toEqual({ position: 'row-position' });
    expect(() => decodeBrowseCursor(cursor, fingerprintSearchQuery({ query: 'other' }))).toThrow();
  });

  it('rejects malformed public cursors', () => {
    expect(() => decodeBrowseCursor('not-a-search-cursor', 'sha256:test')).toThrow();
  });
});
