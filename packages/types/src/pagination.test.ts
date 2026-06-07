import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { ListQuery, pageOf } from './pagination';

describe('ListQuery', () => {
  it('applies defaults (limit 50, order desc) for an empty query', () => {
    const parsed = ListQuery.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.order).toBe('desc');
    expect(parsed.cursor).toBeUndefined();
  });

  it('coerces a string limit and accepts a cursor + order', () => {
    const parsed = ListQuery.parse({ cursor: 'abc', limit: '25', order: 'asc' });
    expect(parsed.cursor).toBe('abc');
    expect(parsed.limit).toBe(25);
    expect(parsed.order).toBe('asc');
  });

  it('rejects a limit below 1', () => {
    expect(ListQuery.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('rejects a limit above 100', () => {
    expect(ListQuery.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('rejects a non-integer limit', () => {
    expect(ListQuery.safeParse({ limit: 1.5 }).success).toBe(false);
  });

  it('rejects an unknown order', () => {
    expect(ListQuery.safeParse({ order: 'sideways' }).success).toBe(false);
  });
});

describe('pageOf', () => {
  const Page = pageOf(z.object({ id: z.string() }));

  it('parses a page with items, nextCursor, and total', () => {
    const parsed = Page.parse({
      items: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'cur',
      total: 2,
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.nextCursor).toBe('cur');
    expect(parsed.total).toBe(2);
  });

  it('parses a page with only items (optional fields absent)', () => {
    const parsed = Page.parse({ items: [] });
    expect(parsed.items).toEqual([]);
    expect(parsed.nextCursor).toBeUndefined();
    expect(parsed.total).toBeUndefined();
  });

  it('rejects a non-integer total', () => {
    expect(Page.safeParse({ items: [], total: 1.2 }).success).toBe(false);
  });

  it('rejects items that fail the inner schema', () => {
    expect(Page.safeParse({ items: [{ id: 5 }] }).success).toBe(false);
  });
});
