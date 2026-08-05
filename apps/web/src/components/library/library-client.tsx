'use client';

/**
 * The workspace Library: everything this workspace writes, links, and refers back to.
 *
 * @remarks
 * Docket already knew which documents a workspace runs on and showed that to nobody. Every Drive
 * file, Figma board, and web page anyone references in prose becomes an `external_resource` row,
 * deduped per workspace. This page is the first surface that reads them.
 *
 * The column that matters is **Used in**, not a reference count. A count says a document is
 * popular; the container says what it is *for*, and "Not referenced yet" says the opposite — which
 * is how orphaned documentation becomes visible instead of hiding among the ones and twos.
 */
import type { ExternalResourceType, SearchResult } from '@docket/types';
import { type Column, EntityTable, type EntityTableGroup, EmptyState } from '@docket/ui/components';
import { Library, Link as LinkIcon, type LucideIcon } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useMemo } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';

import { useActiveOrg } from '@/components/active-org';
import ResourceDetailPanel from '@/components/library/resource-detail-panel';
import { SEARCH_KIND_ICON } from '@/components/command-palette/use-hub-search';
import { RESOURCE_TYPE_ICON } from '@/components/mentions/mention-glyphs';
import { applyView } from '@/components/views/apply-view';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { ListPageLayout } from '@/components/views/page-layout';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';

import {
  buildResourceCatalog,
  LIBRARY_KINDS,
  externalUrlOf,
  providerOf,
  resourceEntityId,
  titleResolved,
} from './resource-catalog';

/** How many resources one page of the Library loads. */
const PAGE_SIZE = 100;

/** Props for {@link LibraryClient}. */
export interface LibraryClientProps {
  /** The workspace whose resources are listed. */
  readonly orgId: string;
}

/** Format an ISO timestamp the way the rest of the app's list columns do. */
function formatUpdated(iso: string): string {
  const then = new Date(iso);
  const hours = (Date.now() - then.getTime()) / 3_600_000;
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  if (hours < 48) return 'Yesterday';
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The glyph for one row: the resource's own type when it has one, else its search kind.
 *
 * @remarks
 * A spreadsheet and a design board should not share a mark. `RESOURCE_TYPE_ICON` already carries
 * that vocabulary for the mention chips, so the Library reuses it rather than starting a second
 * one that would drift.
 */
function glyphFor(row: SearchResult): LucideIcon {
  const resourceType = row.facets['resourceType'];
  if (typeof resourceType === 'string' && resourceType in RESOURCE_TYPE_ICON) {
    return RESOURCE_TYPE_ICON[resourceType as ExternalResourceType];
  }
  return SEARCH_KIND_ICON[row.kind];
}

/** The host of a resource URL, shown beside its title so the row says where it lives. */
function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Render the Library.
 *
 * @param props - The active workspace.
 * @returns the filtered, grouped resource roster.
 */
export default function LibraryClient({ orgId }: LibraryClientProps): JSX.Element {
  const { state, setFilters, setGroupBy, setSort } = useViewState();
  const { activeOrg } = useActiveOrg();
  const router = useRouter();
  const searchParams = useSearchParams();
  // The opened entry lives in the URL, so a detail view is linkable and the back button closes it.
  // `entityHref` and the command palette both already hand out `?resourceId=`.
  const openedId = searchParams.get('resourceId');

  /** Open or close the detail panel without disturbing the active filters. */
  function setOpened(resourceId: string | null): void {
    const next = new URLSearchParams(searchParams.toString());
    if (resourceId === null) next.delete('resourceId');
    else next.set('resourceId', resourceId);
    const query = next.toString();
    router.replace(query.length > 0 ? `?${query}` : '?', { scroll: false });
  }

  const resourcesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.search('org', `library:${LIBRARY_KINDS.join(',')}`, orgId),
      () =>
        api.v1.orgs[':orgId'].search.$get({
          param: { orgId },
          // No `q`: browse mode. Same endpoint, same permission filter, ordered by recency.
          query: { kinds: LIBRARY_KINDS.join(','), limit: String(PAGE_SIZE) },
        }),
      'Could not load the library.',
    ),
  );

  const rows = useMemo(() => resourcesQ.data?.items ?? [], [resourcesQ.data]);
  const catalog = useMemo(() => buildResourceCatalog(rows), [rows]);

  // Group by type and order newest-first until the reader says otherwise.
  const effective = useMemo(
    () => ({
      filters: state.filters,
      groupBy: state.groupBy ?? { field: 'type' },
      sort: state.sort.length > 0 ? state.sort : [{ field: 'updated', dir: 'desc' as const }],
    }),
    [state],
  );
  const applied = useMemo(() => applyView(rows, effective, catalog), [rows, effective, catalog]);

  const columns: readonly Column<SearchResult>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        flex: true,
        priority: 'always',
        render: (row) => {
          const Icon = glyphFor(row);
          const resolved = titleResolved(row);
          // When the title is a URL stand-in it already names the host, so repeating it is noise.
          const host = resolved ? hostOf(externalUrlOf(row)) : null;
          return (
            <span className="flex min-w-0 items-center gap-3">
              <Icon aria-hidden className="text-on-surface-variant size-4! shrink-0" />
              <span
                className={`min-w-0 truncate ${resolved ? 'font-medium' : 'text-on-surface-variant'}`}
              >
                {row.title}
              </span>
              {/* Deliberately the only thing that survives a narrow width. On a phone this page is
                  for finding a document and opening it; which initiative it serves is a question
                  asked at a desk, and answering it here would cost the title its room. */}
              {host ? (
                <span className="text-on-surface-variant hidden shrink-0 text-xs @lg/table:inline">
                  · {host}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        key: 'usedIn',
        header: 'Used in',
        minWidth: '13rem',
        // Sheds last of the three: what a resource is for outranks where it came from and when it
        // changed, both of which the provider can already tell you.
        priority: 1,
        render: (row) =>
          row.usedIn.length === 0 ? (
            <span className="text-on-surface-variant text-xs">Not referenced yet</span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="bg-surface-container-high min-w-0 truncate rounded-md px-2 py-0.5 text-xs">
                {row.usedIn[0]?.title}
              </span>
              {row.usedIn.length > 1 ? (
                <span className="text-on-surface-variant shrink-0 text-xs">
                  +{row.usedIn.length - 1}
                </span>
              ) : null}
            </span>
          ),
      },
      {
        key: 'provider',
        header: 'Source',
        width: '8rem',
        priority: 3,
        render: (row) => {
          const provider = providerOf(row);
          return (
            <span className="text-on-surface-variant truncate text-xs">
              {provider ? (catalog[3]?.resolveLabel?.(provider) ?? provider) : '—'}
            </span>
          );
        },
      },
      {
        key: 'updated',
        header: 'Updated',
        width: '6rem',
        align: 'end',
        priority: 2,
        render: (row) => (
          <span className="text-on-surface-variant text-xs">{formatUpdated(row.updatedAt)}</span>
        ),
      },
    ],
    [catalog],
  );

  const groups: readonly EntityTableGroup<SearchResult>[] = useMemo(
    () =>
      (applied.groups ?? []).map((group) => ({
        id: group.id,
        label: group.label,
        rows: group.rows,
      })),
    [applied.groups],
  );

  const filtered = state.filters.length > 0;
  // Resolved against the loaded page rather than refetched: the panel is only reachable from a row.
  const opened =
    openedId === null ? null : (rows.find((row) => resourceEntityId(row) === openedId) ?? null);

  return (
    <ListPageLayout
      title="Library"
      subtitle="Everything this workspace writes, links, and refers back to."
      toolbar={
        <FilterToolbar
          catalog={catalog}
          state={effective}
          onFiltersChange={setFilters}
          onGroupByChange={setGroupBy}
          onSortChange={setSort}
        />
      }
    >
      {resourcesQ.isPending ? (
        <div className="flex flex-col gap-1" aria-label="Loading the library">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : resourcesQ.error ? (
        <p role="alert" className="text-destructive text-sm">
          {userErrorMessage(resourcesQ.error, 'Could not load the library.')}
        </p>
      ) : applied.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={LinkIcon}
            title="Nothing matches"
            body="No document or link in this workspace matches the active filters."
          />
        ) : (
          <EmptyState
            icon={Library}
            title="Nothing referenced yet"
            body={`Link a document, a design file, or a page from anywhere in ${activeOrg?.name ?? 'this workspace'} and it appears here with the work it serves.`}
          />
        )
      ) : (
        <div className="grid min-w-0 gap-4 @2xl:grid-cols-[minmax(0,1fr)_19rem]">
          {/*
           * On a narrow container the panel takes the whole page and the list stands down: a
           * drill-down, not a squeeze. Driven by whether an entry is open, never by a device check.
           */}
          <div className={opened ? 'hidden min-w-0 @2xl:block' : 'min-w-0'}>
            <EntityTable
              columns={columns}
              groups={groups}
              getRowKey={(row) => row.id}
              onRowClick={(row) => {
                setOpened(resourceEntityId(row));
              }}
              aria-label="Documents and links"
            />
          </div>
          {opened ? (
            <ResourceDetailPanel
              orgId={orgId}
              resource={opened}
              onClose={() => {
                setOpened(null);
              }}
            />
          ) : null}
        </div>
      )}
    </ListPageLayout>
  );
}
