import { task } from '@docket/db';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/error';

import {
  decodeIdCursor,
  decodeTupleCursor,
  encodeIdCursor,
  encodeListCursor,
  pageResult,
  pageResultById,
  pageResultByKey,
  seekAfter,
  seekAfterId,
} from '../../src/lib/list-cursor';

describe('seekAfter', () => {
  it('builds a predicate from a well-formed cursor', () => {
    const cursor = encodeListCursor(new Date('2026-06-01T00:00:00.000Z'), 'row_1');
    expect(seekAfter(task.createdAt, task.id, cursor)).toBeDefined();
  });

  it('rejects a malformed cursor instead of silently restarting the collection', () => {
    expect(() => seekAfter(task.createdAt, task.id, 'not-a-real-cursor')).toThrow(ValidationError);
  });

  it('treats an absent cursor as the first page', () => {
    expect(seekAfter(task.createdAt, task.id, undefined)).toBeUndefined();
  });
});

describe('pageResult', () => {
  it('omits nextCursor when the bounded result is exhausted', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(pageResult(rows, 50, () => new Date())).toEqual({ items: rows });
  });

  it('uses the last returned row as the boundary when an over-fetched row exists', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = pageResult(rows, 2, () => new Date('2026-09-01T00:00:00.000Z'));
    expect(page.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(page.nextCursor).toEqual(expect.any(String));
  });
});

describe('id-only cursor pagination', () => {
  it('builds ascending and descending seek predicates', () => {
    const cursor = encodeIdCursor('row_1');
    expect(seekAfterId(task.id, cursor, 'asc')).toBeDefined();
    expect(seekAfterId(task.id, cursor, 'desc')).toBeDefined();
  });

  it('rejects malformed id cursors instead of silently restarting the collection', () => {
    expect(() => seekAfterId(task.id, 'not-an-id-cursor', 'asc')).toThrow(ValidationError);
  });

  it('omits nextCursor at exhaustion and encodes the last returned id otherwise', () => {
    expect(pageResultById([{ id: 'a' }], 50)).toEqual({ items: [{ id: 'a' }] });
    expect(pageResultById([{ id: 'a' }, { id: 'b' }], 1)).toEqual({
      items: [{ id: 'a' }],
      nextCursor: encodeIdCursor('a'),
    });
  });

  it('encodes the final returned key for an in-memory roster page', () => {
    const rows = [
      { teamId: 'b', actorId: 'a' },
      { teamId: 'a', actorId: 'b' },
      { teamId: 'a', actorId: 'a' },
    ];
    const first = pageResultByKey(rows, 2, (row) => `${row.teamId}:${row.actorId}`);
    expect(first.items).toEqual([
      { teamId: 'b', actorId: 'a' },
      { teamId: 'a', actorId: 'b' },
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));
  });
});

describe('retained malformed cursor regressions', () => {
  it.each(['{not json', '{"id":"row_1"}', '[]'])(
    'rejects a structurally invalid composite cursor: %s',
    (value) => {
      const cursor = `tuple1:${Buffer.from(value).toString('base64url')}`;
      expect(() => decodeTupleCursor(cursor)).toThrow(ValidationError);
    },
  );
  it.each(['2026-06-01T00:00:00.000Z|', 'yesterday|row_1'])(
    'rejects a timestamp cursor without a valid position: %s',
    (value) => {
      expect(() =>
        seekAfter(task.createdAt, task.id, Buffer.from(value).toString('base64url')),
      ).toThrow(ValidationError);
    },
  );
  it('rejects an empty ID under a valid cursor prefix', () => {
    expect(() => decodeIdCursor('id1:')).toThrow(ValidationError);
  });
});
