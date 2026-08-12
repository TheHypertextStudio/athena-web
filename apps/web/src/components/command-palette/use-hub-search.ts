'use client';

import type { SearchDocumentKind, SearchOut, SearchResult } from '@docket/types';
import {
  Activity,
  Building,
  Calendar,
  CheckCircle2,
  FileText,
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
import { useCallback, useMemo } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { hrefForSearchResult, isExternalSearchHref } from '@/lib/search-route';
import { useRemoteSearch } from '@/lib/use-remote-search';

import type { PaletteItem, PaletteScope } from './types';

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
  // A generic glyph only when nothing better is known: a Library row prefers the per-provider
  // glyph in `mention-glyphs.ts`, keyed off the resource's `provider` facet.
  external_resource: FileText,
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
  external_resource: 'Resource',
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
  /**
   * Whether the palette is on screen.
   *
   * @remarks
   * The palette is mounted by the app shell on every page and only returns null *after* its hooks
   * run, so without this the empty-query browse fires on every page load and again on every window
   * refocus. Recents are worth fetching when someone opens the palette, not when they open the app.
   */
  open: boolean;
}

/**
 * Debounced cross-org entity search for the command palette.
 *
 * @remarks
 * Reads `api.v1.hub.search` — which fans out across every org the caller belongs to and
 * returns org-chipped semantic hits — and normalizes each hit into a
 * selectable {@link PaletteItem} whose `run` deep-links into the originating org. The query
 * string is debounced before it enters the {@link queryKeys.search} key, so the dynamic-data layer
 * handles the request lifecycle: it is keyed (so a repeated query is served from cache), deduped,
 * and inherently race-safe (a superseded query's result lands under its own key and is never
 * shown). The request is deliberately **not** gated on a non-empty term — an empty box browses
 * recents, which is the palette's most common opening move. In the `org` scope the request goes
 * through the org route instead of filtering Hub results client-side.
 *
 * @param input - The query, scope, and the palette `close` callback.
 * @returns the reactive {@link HubSearchState}.
 */
export function useHubSearch({ query, scope, close, open }: HubSearchInput): HubSearchState {
  const router = useRouter();
  const { activeOrgId, orgName } = useActiveOrg();

  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;
  const orgFilter = scope === 'org' ? activeOrgId : null;
  const rankingOrgId = activeOrgId ?? null;

  const searchQ = useRemoteSearch<SearchOut>({
    query,
    debounceMs: DEBOUNCE_MS,
    // No `minChars`: an empty term is a real request here, not an absence of one.
    enabled: open && (scope === 'hub' || Boolean(orgFilter)),
    key: (term) => queryKeys.search(scope, term, scope === 'hub' ? rankingOrgId : orgFilter),
    fetch: (term) =>
      orgFilter
        ? api.v1.orgs[':orgId'].search.$get({
            param: { orgId: orgFilter },
            // Omitting `q` asks the same endpoint to browse: recently-touched rows instead of
            // matches. An open palette with an empty box is a jumping-off point, and offering
            // nothing there wastes the most common keystroke in the app.
            query: {
              ...(term.length > 0 ? { q: term } : {}),
              limit: '20',
              surface: 'palette',
            },
          })
        : api.v1.hub.search.$get({
            query: {
              ...(term.length > 0 ? { q: term } : {}),
              limit: '20',
              surface: 'palette',
              ...(rankingOrgId ? { activeOrgId: rankingOrgId } : {}),
            },
          }),
    fallbackMessage: 'Could not search your workspace.',
  });

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

  const results = useMemo<readonly PaletteItem[]>(
    () => (searchQ.data?.items ?? []).map(toResultItem),
    [searchQ.data, toResultItem],
  );

  // Neither signal is gated on there being a query: with an empty box the same request is still
  // in flight, fetching recents, and a silent failure there would read as "you have nothing".
  return { results, loading: searchQ.pending, error: searchQ.error, hasQuery };
}
