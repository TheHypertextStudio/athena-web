import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { MemberOut } from '@docket/identity-access/member-contract';
import {
  cachedPersonResults,
  mergeCachedPeople,
  mergeCachedPersonMentions,
  useCachedPersonSearch,
  filterCachedPeople,
} from '@/components/people/cached-person-search';
import { queryKeys } from '@/lib/query';
import { parseSearchPageFilters } from '@/components/search/search-url-state';

const orgId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const otherOrg = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const sam = MemberOut.parse({
  actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  organizationId: orgId,
  displayName: 'Sam Rivera',
  status: 'active',
  userId: null,
  roleId: null,
  avatar: null,
  createdAt: '2026-09-19T12:00:00.000Z',
});

describe('people discovery before search indexing', () => {
  it('reacts immediately to the shared roster cache and excludes other workspace caches', () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useCachedPersonSearch([orgId], 'Sam'), { wrapper });
    expect(view.result.current).toEqual([]);
    act(() => {
      client.setQueryData(queryKeys.members(orgId), { items: [sam] });
    });
    expect(view.result.current.map((person) => person.title)).toEqual(['Sam Rivera']);
    act(() => {
      client.setQueryData(queryKeys.members(otherOrg), {
        items: [{ ...sam, organizationId: otherOrg, displayName: 'Sam Elsewhere' }],
      });
    });
    expect(view.result.current).toHaveLength(1);
    act(() => {
      client.removeQueries({ queryKey: queryKeys.members(orgId) });
    });
    expect(view.result.current).toEqual([]);
  });
  it('deduplicates a person once indexing catches up while retaining distinct same-name people', () => {
    const people = cachedPersonResults(
      [
        sam,
        {
          ...sam,
          actorId: MemberOut.parse({ ...sam, actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAY' }).actorId,
        },
      ],
      [orgId],
      'Sam',
    );
    expect(mergeCachedPeople(people.slice(0, 1), people)).toHaveLength(2);
    const mentions = mergeCachedPersonMentions([], people);
    expect(mergeCachedPersonMentions(mentions, people)).toHaveLength(2);
    expect(mentions[0]?.ref).toEqual({
      kind: 'entity',
      entityKind: 'actor',
      entityId: sam.actorId,
    });
  });
  it('respects query text, authorization scope, and search kind filters', () => {
    expect(cachedPersonResults([sam], [otherOrg], 'Sam')).toEqual([]);
    expect(cachedPersonResults([sam], [orgId], 'Alex')).toEqual([]);
    expect(cachedPersonResults([sam], [orgId], '')).toEqual([]);
    const people = cachedPersonResults([sam], [orgId], 'sam');
    expect(
      filterCachedPeople(people, parseSearchPageFilters(new URLSearchParams('kind=task'))),
    ).toEqual([]);
    expect(
      filterCachedPeople(people, {
        ...parseSearchPageFilters(new URLSearchParams()),
        kinds: ['member'],
      }),
    ).toHaveLength(1);
  });
});
