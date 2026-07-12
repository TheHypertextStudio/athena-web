'use client';

import type { SearchDocumentKind, SearchResult } from '@docket/types';
import {
  Activity,
  Building,
  Calendar,
  CheckCircle2,
  FolderKanban,
  GanttChart,
  Layers,
  Link,
  ListView,
  MessageSquare,
  Sparkles,
  Tag,
  Target,
  type LucideIcon,
  User,
  Users,
} from '@docket/ui/icons';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { hrefForSearchResult, isExternalSearchHref } from '@/lib/search-route';

import type { PaletteItem, PaletteScope } from './types';
import { userErrorMessage } from '@/lib/problem';

/** How long to wait after the last keystroke before issuing a search (ms). */
const DEBOUNCE_MS = 180;

/** The glyph for each search-hit entity kind. */
export const SEARCH_KIND_ICON: Record<SearchDocumentKind, LucideIcon> = {
  organization: Building,
  team: Users,
  member: User,
  agent: Sparkles,
  agent_session: Sparkles,
  task: CheckCircle2,
  project: FolderKanban,
  program: Layers,
  initiative: Target,
  milestone: GanttChart,
  cycle: Calendar,
  label: Tag,
  saved_view: ListView,
  comment: MessageSquare,
  update: Activity,
  attachment: Link,
  calendar_event: Calendar,
  activity: Activity,
};

/** Human labels for semantic search kinds. */
export const SEARCH_KIND_LABEL: Record<SearchDocumentKind, string> = {
  organization: 'Workspace',
  team: 'Team',
  member: 'Member',
  agent: 'Agent',
  agent_session: 'Agent session',
  task: 'Task',
  project: 'Project',
  program: 'Program',
  initiative: 'Initiative',
  milestone: 'Milestone',
  cycle: 'Cycle',
  label: 'Label',
  saved_view: 'Saved view',
  comment: 'Comment',
  update: 'Update',
  attachment: 'Attachment',
  calendar_event: 'Calendar event',
  activity: 'Activity',
};

interface SearchResultToPaletteItemInput {
  close: () => void;
  orgName: (orgId: string) => string;
  navigate: (href: string) => void;
  navigateExternal?: (href: string) => void;
}

/** Normalize one semantic search result into a command-palette row. */
export function searchResultToPaletteItem(
  hit: SearchResult,
  input: SearchResultToPaletteItemInput,
): PaletteItem {
  const href = hrefForSearchResult(hit);
  const navigateExternal =
    input.navigateExternal ??
    ((target) => {
      window.location.assign(target);
    });
  return {
    id: `hit:${hit.id}`,
    section: 'results',
    label: hit.title,
    hint: resultHint(hit),
    icon: SEARCH_KIND_ICON[hit.kind],
    hitType: hit.kind,
    org: hit.organizationId
      ? { id: hit.organizationId, name: input.orgName(hit.organizationId) }
      : undefined,
    source: hit.source ? sourceLabel(hit.source.system) : undefined,
    run: () => {
      input.close();
      if (!href) return;
      if (isExternalSearchHref(href)) navigateExternal(href);
      else input.navigate(href);
    },
  };
}

function resultHint(hit: SearchResult): string | undefined {
  if (hit.subject?.title) return `${SEARCH_KIND_LABEL[hit.subject.kind]}: ${hit.subject.title}`;
  return hit.summary ?? hit.snippet ?? undefined;
}

function sourceLabel(source: string): string {
  if (source === 'github') return 'GitHub';
  return source
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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
 * returns org-chipped semantic hits — and normalizes each hit into a
 * selectable {@link PaletteItem} whose `run` deep-links into the originating org. The query
 * string is debounced before it enters the {@link queryKeys.hubSearch} key, so the dynamic-data
 * layer ({@link useApiQuery}) handles the request lifecycle: it is keyed (so a repeated query is
 * served from cache), deduped, and inherently race-safe (a superseded query's result lands under
 * its own key and is never shown). The query is gated on a non-empty term (`enabled`), and in the
 * `org` scope the request goes through the org route instead of filtering Hub results client-side.
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
  const rankingOrgId = activeOrgId ?? null;

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
    apiQueryOptions(
      queryKeys.search(scope, debounced, scope === 'hub' ? rankingOrgId : orgFilter),
      () =>
        orgFilter
          ? api.v1.orgs[':orgId'].search.$get({
              param: { orgId: orgFilter },
              query: { q: debounced, limit: '20', surface: 'palette' },
            })
          : api.v1.hub.search.$get({
              query: {
                q: debounced,
                limit: '20',
                surface: 'palette',
                ...(rankingOrgId ? { activeOrgId: rankingOrgId } : {}),
              },
            }),
      'Search failed.',
      { enabled: debouncedHasQuery && (scope === 'hub' || Boolean(orgFilter)) },
    ),
  );

  const toResultItem = useCallback(
    (hit: SearchResult): PaletteItem =>
      searchResultToPaletteItem(hit, {
        close,
        orgName,
        navigate: (href) => {
          router.push(href);
        },
      }),
    [close, orgName, router],
  );

  const results = useMemo<readonly PaletteItem[]>(() => {
    if (!hasQuery) return [];
    return (searchQ.data?.items ?? []).map(toResultItem);
  }, [hasQuery, searchQ.data, toResultItem]);

  // While the user is mid-burst (raw term not yet debounced) or the keyed request is in flight,
  // the result pane shows its loading skeleton; the error mirrors the search request's failure.
  const loading = hasQuery && (trimmed !== debounced || (debouncedHasQuery && searchQ.isPending));
  const error = searchQ.isError
    ? userErrorMessage(searchQ.error, 'Could not search your workspace.')
    : null;

  return { results, loading, error: hasQuery ? error : null, hasQuery };
}
