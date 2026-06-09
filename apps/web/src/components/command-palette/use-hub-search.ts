'use client';

import { CheckCircle2, FolderKanban, type LucideIcon, Layers } from '@docket/ui/icons';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import { queryKeys, useApiQuery } from '@/lib/query';

import type { PaletteItem, PaletteScope } from './types';

/** How long to wait after the last keystroke before issuing a search (ms). */
const DEBOUNCE_MS = 180;

/** The glyph for each search-hit entity kind. */
const HIT_ICON: Record<PaletteItem['hitType'] & string, LucideIcon> = {
  task: CheckCircle2,
  project: FolderKanban,
  program: Layers,
};

/** Build the canonical deep-link for a search hit (mirrors the Today plan-row routing). */
function hitHref(
  organizationId: string,
  type: NonNullable<PaletteItem['hitType']>,
  id: string,
): string {
  switch (type) {
    case 'task':
      return `/orgs/${organizationId}/my-work`;
    case 'project':
      return `/orgs/${organizationId}/projects/${id}`;
    case 'program':
      return `/orgs/${organizationId}/programs/${id}`;
  }
}

/** The reactive state of a cross-org search request. */
export interface HubSearchState {
  /** The org-chipped search-result commands for the current query. */
  results: readonly PaletteItem[];
  /** Whether a search request is in flight (drives the result-pane skeleton). */
  loading: boolean;
  /** A human-readable search error to surface (role=alert), or `null`. */
  error: string | null;
  /** Whether the query is non-empty (i.e. results should be shown at all). */
  hasQuery: boolean;
}

/** Inputs for {@link useHubSearch}. */
interface HubSearchInput {
  /** The raw query string. */
  query: string;
  /** The active scope; `org` narrows results to the bound org client-side. */
  scope: PaletteScope;
  /** Close the palette; result selection calls this before navigating. */
  close: () => void;
}

/**
 * Debounced cross-org entity search for the command palette.
 *
 * @remarks
 * Reads `api.v1.hub.search` — which fans out across every org the caller belongs to and
 * returns org-chipped, typed hits (tasks/projects/programs) — and normalizes each hit into a
 * selectable {@link PaletteItem} whose `run` deep-links into the originating org. The query
 * string is debounced before it enters the {@link queryKeys.hubSearch} key, so the dynamic-data
 * layer ({@link useApiQuery}) handles the request lifecycle: it is keyed (so a repeated query is
 * served from cache), deduped, and inherently race-safe (a superseded query's result lands under
 * its own key and is never shown). The query is gated on a non-empty term (`enabled`), and in the
 * `org` scope the results are narrowed to the bound org client-side so the palette honors the
 * Hub-global vs org-local toggle without a second endpoint.
 *
 * @param input - The query, scope, and the palette `close` callback.
 * @returns the reactive {@link HubSearchState}.
 */
export function useHubSearch({ query, scope, close }: HubSearchInput): HubSearchState {
  const router = useRouter();
  const { activeOrgId, orgName } = useActiveOrg();

  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;
  const orgFilter = scope === 'org' ? activeOrgId : null;

  // Debounce the term before it enters the query key, so a keystroke burst issues one request for
  // the settled term rather than one per character.
  const [debounced, setDebounced] = useState(trimmed);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(trimmed);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [trimmed]);

  const debouncedHasQuery = debounced.length > 0;

  const searchQ = useApiQuery(
    queryKeys.hubSearch(debounced),
    () => api.v1.hub.search.$get({ query: { q: debounced, limit: '20' } }),
    'Search failed.',
    { enabled: debouncedHasQuery },
  );

  const toResultItem = useCallback(
    (hit: {
      organizationId: string;
      type: NonNullable<PaletteItem['hitType']>;
      id: string;
      title: string;
    }): PaletteItem => ({
      id: `hit:${hit.type}:${hit.id}`,
      section: 'results',
      label: hit.title,
      icon: HIT_ICON[hit.type],
      hitType: hit.type,
      org: { id: hit.organizationId, name: orgName(hit.organizationId) },
      run: () => {
        close();
        router.push(hitHref(hit.organizationId, hit.type, hit.id));
      },
    }),
    [orgName, close, router],
  );

  const results = useMemo<readonly PaletteItem[]>(() => {
    if (!hasQuery) return [];
    const hits = searchQ.data?.results ?? [];
    const scoped = orgFilter ? hits.filter((h) => h.organizationId === orgFilter) : hits;
    return scoped.map(toResultItem);
  }, [hasQuery, orgFilter, searchQ.data, toResultItem]);

  // While the user is mid-burst (raw term not yet debounced) or the keyed request is in flight,
  // the result pane shows its loading skeleton; the error mirrors the search request's failure.
  const loading = hasQuery && (trimmed !== debounced || (debouncedHasQuery && searchQ.isPending));
  const error = searchQ.isError ? searchQ.error.message : null;

  return { results, loading, error: hasQuery ? error : null, hasQuery };
}
