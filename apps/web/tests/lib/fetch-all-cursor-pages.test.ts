import { describe, expect, it } from 'vitest';

import type { api as ApiClient } from '../../src/lib/api';
import { fetchAllCursorPages } from '../../src/lib/fetch-all-cursor-pages';
import { fetchAllProjects } from '../../src/lib/org-collection-pages';

interface Row {
  readonly id: number;
}

function success(items: readonly Row[], nextCursor?: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ items, ...(nextCursor ? { nextCursor } : {}) }),
  };
}

describe('fetchAllCursorPages', () => {
  it('consumes every page and omits nextCursor from the exhausted aggregate', async () => {
    const cursors: (string | undefined)[] = [];
    const pages = new Map<string | undefined, ReturnType<typeof success>>([
      [
        undefined,
        success(
          Array.from({ length: 100 }, (_, id) => ({ id })),
          'page-2',
        ),
      ],
      [
        'page-2',
        success(
          Array.from({ length: 100 }, (_, index) => ({ id: index + 100 })),
          'page-3',
        ),
      ],
      ['page-3', success(Array.from({ length: 5 }, (_, index) => ({ id: index + 200 })))],
    ]);

    const response = await fetchAllCursorPages(async (cursor) => {
      cursors.push(cursor);
      const page = pages.get(cursor);
      if (!page) throw new Error('Unexpected cursor');
      return page;
    });

    expect(cursors).toEqual([undefined, 'page-2', 'page-3']);
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({
      items: Array.from({ length: 205 }, (_, id) => ({ id })),
    });
  });

  it('returns a later failed response instead of exposing a partial corpus', async () => {
    const failure = {
      ok: false,
      status: 503,
      json: async () => ({ code: 'unavailable' }),
    };
    const response = await fetchAllCursorPages(async (cursor) =>
      cursor ? failure : success([{ id: 1 }], 'page-2'),
    );

    expect(response).toBe(failure);
  });

  it('rejects a server cursor cycle instead of requesting forever', async () => {
    await expect(
      fetchAllCursorPages(async () => success([{ id: 1 }], 'same-cursor')),
    ).rejects.toThrow('repeated cursor');
  });
});

describe('complete organization collections', () => {
  it('requests the maximum legal page and forwards each opaque cursor', async () => {
    const queries: unknown[] = [];
    const client = {
      v1: {
        orgs: {
          ':orgId': {
            projects: {
              $get: ({ query }: { query: unknown }) => {
                queries.push(query);
                return Promise.resolve(
                  queries.length === 1
                    ? success([{ id: 1 }], 'project-page-2')
                    : success([{ id: 2 }]),
                );
              },
            },
          },
        },
      },
    } as unknown as typeof ApiClient;

    const response = await fetchAllProjects(client, 'org_1');

    expect(queries).toEqual([{ limit: '100' }, { limit: '100', cursor: 'project-page-2' }]);
    expect(await response.json()).toEqual({ items: [{ id: 1 }, { id: 2 }] });
  });
});
