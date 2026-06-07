'use client';

import { CheckCircle2, FolderKanban, type LucideIcon, Layers } from '@docket/ui/icons';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

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
 * selectable {@link PaletteItem} whose `run` deep-links into the originating org. The request
 * is debounced and race-safe (a stale response is discarded once a newer query supersedes
 * it), and in the `org` scope the results are narrowed to the bound org client-side so the
 * palette honors the Hub-global vs org-local toggle without a second endpoint.
 *
 * @param input - The query, scope, and the palette `close` callback.
 * @returns the reactive {@link HubSearchState}.
 */
export function useHubSearch({ query, scope, close }: HubSearchInput): HubSearchState {
  const router = useRouter();
  const { activeOrgId, orgName } = useActiveOrg();
  const [results, setResults] = useState<readonly PaletteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;
  const orgFilter = scope === 'org' ? activeOrgId : null;

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

  useEffect(() => {
    if (!hasQuery) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const id = (requestId.current += 1);
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.v1.hub.search.$get({ query: { q: trimmed, limit: '20' } });
          if (id !== requestId.current) return; // superseded by a newer query
          if (!res.ok) {
            setError(await readProblem(res, 'Search failed.'));
            setResults([]);
            return;
          }
          const { results: hits } = await res.json();
          const scoped = orgFilter ? hits.filter((h) => h.organizationId === orgFilter) : hits;
          setResults(scoped.map(toResultItem));
        } catch (caught) {
          if (id !== requestId.current) return;
          setError(readError(caught, 'Something went wrong searching.'));
          setResults([]);
        } finally {
          if (id === requestId.current) setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [trimmed, hasQuery, orgFilter, toResultItem]);

  return { results, loading, error, hasQuery };
}
