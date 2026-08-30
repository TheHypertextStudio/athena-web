import { task } from '@docket/db';
import { describe, expect, it } from 'vitest';

import { encodeListCursor, pageResult, seekAfter } from '../../src/lib/list-cursor';

describe('seekAfter', () => {
  it('builds a predicate from a well-formed cursor', () => {
    const cursor = encodeListCursor(new Date('2026-06-01T00:00:00.000Z'), 'row_1');
    expect(seekAfter(task.createdAt, task.id, cursor)).toBeDefined();
  });

  it('degrades a malformed cursor to the first page instead of decoding garbage', () => {
    // The internal decode guards `!ts || !id || Number.isNaN(Date.parse(ts))` — every existing
    // caller passed either `undefined` or a cursor this module had just encoded itself, so the
    // "malformed token" branch (a stale/corrupted/hand-edited cursor from a client) never ran.
    expect(seekAfter(task.createdAt, task.id, 'not-a-real-cursor')).toBeUndefined();
  });

  it('treats an absent cursor as the first page', () => {
    expect(seekAfter(task.createdAt, task.id, undefined)).toBeUndefined();
  });
});

describe('pageResult', () => {
  it('returns everything with no cursor in legacy unbounded mode', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(pageResult(rows, undefined, () => new Date())).toEqual({ items: rows });
  });
});
