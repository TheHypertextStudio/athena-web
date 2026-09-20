'use client';

import type { MemberOut } from '@docket/identity-access/member-contract';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { SearchPageFilters } from '@/components/search/search-url-state';
import type { SearchResult } from '@/lib/contracts/search';
import type { MentionItem } from '@/lib/contracts/mention';
import { queryKeys } from '@/lib/query';

/** Search authorized roster cache entries while the server search index catches up. */
export function useCachedPersonSearch(
  orgIds: readonly string[],
  query: string,
): readonly SearchResult[] {
  const client = useQueryClient();
  const scopeKey = JSON.stringify([...new Set(orgIds)].sort());
  const scope = useMemo<string[]>(() => JSON.parse(scopeKey) as string[], [scopeKey]);
  const snapshot = useCallback(
    () =>
      scope
        .map((id) => {
          const state = client.getQueryState(queryKeys.members(id));
          return `${id}:${state?.dataUpdateCount ?? 0}:${state?.dataUpdatedAt ?? 0}`;
        })
        .join('|'),
    [client, scope],
  );
  const subscribe = useCallback(
    (changed: () => void) => client.getQueryCache().subscribe(changed),
    [client],
  );
  const revision = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => {
    const people = scope.flatMap(
      (orgId) => client.getQueryData<{ items: MemberOut[] }>(queryKeys.members(orgId))?.items ?? [],
    );
    return cachedPersonResults(people, scope, query);
  }, [client, scope, query, revision]);
}

/** Match only people belonging to the explicitly authorized search scope. */
export function cachedPersonResults(
  people: readonly MemberOut[],
  orgIds: readonly string[],
  query: string,
): SearchResult[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  const allowed = new Set(orgIds);
  return people
    .filter(
      (person) =>
        allowed.has(person.organizationId) &&
        person.status === 'active' &&
        person.displayName.toLocaleLowerCase().includes(term),
    )
    .map(personSearchResult);
}

function personSearchResult(person: MemberOut): SearchResult {
  const href = `/orgs/${person.organizationId}/people/${person.actorId}`;
  return {
    id: `member:${person.organizationId}:${person.actorId}`,
    organizationId: person.organizationId,
    userId: person.userId ?? null,
    kind: 'member',
    family: 'people',
    title: person.displayName,
    summary: null,
    snippet: null,
    matchedFields: ['title'],
    route: {
      type: 'entity',
      organizationId: person.organizationId,
      entityKind: 'member',
      entityId: person.actorId,
      href,
    },
    subject: null,
    source: null,
    facets: { avatar: person.avatar ?? null, status: person.status },
    actions: [],
    score: 1,
    entityId: person.actorId,
    externalUrl: null,
    usedIn: [],
    updatedAt: person.createdAt,
  };
}

/** Keep authoritative search hits and append roster people missing from the index. */
export function mergeCachedPeople(
  hits: readonly SearchResult[],
  people: readonly SearchResult[],
): SearchResult[] {
  const seen = new Set(
    hits
      .filter((hit) => hit.kind === 'member')
      .map((hit) => `${hit.organizationId}:${hit.entityId}`),
  );
  return [
    ...hits,
    ...people.filter((person) => !seen.has(`${person.organizationId}:${person.entityId}`)),
  ];
}

/** Keep persisted mention identities while exposing roster people before indexing finishes. */
export function mergeCachedPersonMentions(
  items: readonly MentionItem[],
  people: readonly SearchResult[],
): MentionItem[] {
  const seen = new Set(
    items
      .filter((item) => item.origin === 'local' && item.entityKind === 'actor')
      .map((item) => (item.ref.kind === 'entity' ? item.ref.entityId : '')),
  );
  const additions: MentionItem[] = people
    .filter((person) => !seen.has(person.entityId))
    .map((person) => ({
      origin: 'local',
      id: `entity:actor:${person.entityId}`,
      entityKind: 'actor',
      ref: { kind: 'entity', entityKind: 'actor', entityId: person.entityId },
      title: person.title,
      subtitle: null,
      href: person.route.type === 'entity' ? person.route.href : '',
      score: person.score,
    }));
  return [...items, ...additions];
}

/** Honor supported person facets without manufacturing matches for work-only filters. */
export function filterCachedPeople(
  people: readonly SearchResult[],
  filters: SearchPageFilters,
): SearchResult[] {
  if (
    [filters.ownerIds, filters.assigneeIds, filters.labelIds, filters.healths].some(
      (values) => values.length > 0,
    ) ||
    filters.fromDate ||
    filters.toDate
  )
    return [];
  if (filters.families.length && !filters.families.includes('people')) return [];
  if (filters.kinds.length && !filters.kinds.includes('member')) return [];
  if (filters.sources.length && !filters.sources.includes('docket')) return [];
  return people.filter(
    (person) =>
      (!filters.orgIds.length || filters.orgIds.includes(person.organizationId ?? '')) &&
      (!filters.ids.length || filters.ids.includes(person.id)) &&
      (!filters.statuses.length || filters.statuses.includes('active')),
  );
}

/** Merge cache people into a filtered search page using only its allowed workspace scope. */
export function useSearchPeopleOverlay(
  scope: 'org' | 'hub',
  orgId: string | undefined,
  orgs: readonly { id: string }[],
  filters: SearchPageFilters,
  indexed: readonly SearchResult[],
): readonly SearchResult[] {
  const allowed = scope === 'org' ? (orgId ? [orgId] : []) : orgs.map((org) => org.id);
  const people = useCachedPersonSearch(allowed, filters.query);
  return mergeCachedPeople(indexed, filterCachedPeople(people, filters));
}
