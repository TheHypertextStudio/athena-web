import { describe, expect, it, vi } from 'vitest';

import { initiativeHierarchyCandidatesDef } from '@/lib/fetch-initiative-hierarchy-candidates';

const ORG = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('initiativeHierarchyCandidatesDef', () => {
  it('keys and requests one normalized hierarchy candidate search', async () => {
    const get = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const client = {
      v1: {
        orgs: {
          ':orgId': {
            initiatives: {
              'hierarchy-candidates': { $get: get },
            },
          },
        },
      },
    };

    const definition = initiativeHierarchyCandidatesDef(
      ORG,
      'child',
      client as never,
      '  foreign  ',
    );
    expect(definition.queryKey).toEqual([
      'org',
      ORG,
      'initiatives',
      'hierarchy-candidates',
      'child',
      'foreign',
    ]);

    await definition.queryFn?.({} as never);

    expect(get).toHaveBeenCalledWith({
      param: { orgId: ORG },
      query: { mode: 'child', query: 'foreign' },
    });
  });

  it('does not send an empty search term', async () => {
    const get = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const client = {
      v1: {
        orgs: {
          ':orgId': {
            initiatives: {
              'hierarchy-candidates': { $get: get },
            },
          },
        },
      },
    };

    const definition = initiativeHierarchyCandidatesDef(ORG, 'parent', client as never);
    await definition.queryFn?.({} as never);

    expect(get).toHaveBeenCalledWith({
      param: { orgId: ORG },
      query: { mode: 'parent' },
    });
  });
});
