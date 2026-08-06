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
import { Button, Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useMemo, useRef } from 'react';

import { useRouter } from 'next/navigation';

import { useAppSearchParams } from '@/lib/app-location';

import { useActiveOrg } from '@/components/active-org';
import { relativeTime } from '@/components/project-detail/format-time';
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

import { buildResourceCatalog, LIBRARY_KINDS, titleResolved } from './resource-catalog';

/** How many resources one page of the Library loads. */
const PAGE_SIZE = 100;

/** Props for {@link LibraryClient}. */
export interface LibraryClientProps {
  /** The workspace whose resources are listed. */
  readonly orgId: string;
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
  // Not Next's `useSearchParams`: with the offline shell, the router reports the route the cached
  // document was rendered for, not the one the reader is on. See docs/engineering/specs/offline.md.
  const searchParams = useAppSearchParams();
  // The opened entry lives in the URL, so a detail view is linkable and the back button closes it.
  // `entityHref` and the command palette both already hand out `?resourceId=`.
  const openedId = searchParams.get('resourceId');
  /** Wraps the list so closing the panel can hand focus back to the grid inside it. */
  const gridRef = useRef<HTMLDivElement>(null);

  /**
   * Open or close the detail panel without disturbing the active filters.
   *
   * @remarks
   * `push` on open and `back` on close, because opening a record is navigation — the browser Back
   * button and a phone's back swipe must close the panel rather than leave the Library. Filters use
   * `replace` (see `useViewState`) because changing a filter is state, not a destination.
   */
  function setOpened(resourceId: string | null): void {
    if (resourceId === null) {
      router.back();
      // Closing removes the panel — and with it whatever held focus. Hand focus back to the grid
      // the reader came from, rather than letting it fall to `<body>`. The frame lets the list
      // finish un-hiding first; a `display: none` element cannot take focus.
      requestAnimationFrame(() => {
        gridRef.current?.querySelector<HTMLElement>('[role="grid"]')?.focus();
      });
      return;
    }
    const next = new URLSearchParams(searchParams.toString());
    next.set('resourceId', resourceId);
    router.push(`?${next.toString()}`, { scroll: false });
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
          const host = resolved ? hostOf(row.externalUrl) : null;
          return (
            <span className="flex min-w-0 items-center gap-2">
              <Icon aria-hidden className="text-on-surface-variant size-4! shrink-0" />
              <span
                className={`min-w-0 truncate ${resolved ? 'text-label-large' : 'text-on-surface-variant'}`}
              >
                {row.title}
              </span>
              {/* Deliberately the only thing that survives a narrow width. On a phone this page is
                  for finding a document and opening it; which initiative it serves is a question
                  asked at a desk, and answering it here would cost the title its room. */}
              {host ? (
                <span className="text-on-surface-variant text-label-small hidden shrink-0 @lg/table:inline">
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
        // Sheds last: what a resource is for outranks when it changed. Provider is deliberately
        // not a column — the host already sits beside the title, and duplicating it cost ~8rem to
        // say the same thing twice. It stays a Filter/Display dimension, where controls belong.
        priority: 1,
        render: (row) =>
          row.usedIn.length === 0 ? (
            <span className="text-on-surface-variant text-label-small">Not referenced yet</span>
          ) : (
            <span className="flex min-w-0 items-center gap-2">
              <span className="bg-surface-container text-label-small min-w-0 truncate rounded-md px-2 py-0.5">
                {row.usedIn[0]?.title}
              </span>
              {row.usedIn.length > 1 ? (
                <span className="text-on-surface-variant text-label-small shrink-0">
                  +{row.usedIn.length - 1}
                </span>
              ) : null}
            </span>
          ),
      },
      {
        key: 'updated',
        header: 'Updated',
        width: '6rem',
        align: 'end',
        priority: 2,
        render: (row) => (
          <span className="text-on-surface-variant text-label-small">
            {relativeTime(row.updatedAt)}
          </span>
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
  const onPage = openedId === null ? null : (rows.find((row) => row.entityId === openedId) ?? null);

  // A `?resourceId=` link — from the command palette, or a URL someone shared — can name a row
  // that sits past the loaded page. Without this the panel silently rendered nothing: no error,
  // no empty state, and a URL that looked like it had worked.
  const deepLinkQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.search('org', `library:id:${openedId ?? ''}`, orgId),
      () =>
        api.v1.orgs[':orgId'].search.$get({
          param: { orgId },
          query: { kinds: LIBRARY_KINDS.join(','), ids: openedId ?? '', limit: '1' },
        }),
      'Could not load that entry.',
      { enabled: openedId !== null && onPage === null && !resourcesQ.isPending },
    ),
  );
  const opened = onPage ?? deepLinkQ.data?.items[0] ?? null;
  // The drill-down stands the list down only while there is something to stand it down *for* —
  // including the moment a deep link is still resolving, so the panel does not pop in beside a
  // list that then vanishes.
  const panelOpen = opened !== null || deepLinkQ.isPending;

  return (
    <ListPageLayout
      title="Library"
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
        <div className="flex flex-col gap-1" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : resourcesQ.error ? (
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(resourcesQ.error, 'Could not load the library.')}
        </p>
      ) : applied.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={LinkIcon}
            title="Nothing matches"
            body="No document or link matches the active filters."
            cta={{
              label: 'Clear filters',
              onClick: () => {
                setFilters([]);
              },
            }}
          />
        ) : (
          <EmptyState
            icon={Library}
            title="Nothing referenced yet"
            body={`Link a document or page from anywhere in ${activeOrg?.name ?? 'this workspace'} and it shows up here.`}
          />
        )
      ) : (
        <div className="grid min-w-0 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
          {/*
           * On a narrow container the panel takes the whole page and the list stands down: a
           * drill-down, not a squeeze. Driven by whether an entry is open, never by a device check.
           */}
          <div ref={gridRef} className={panelOpen ? 'hidden min-w-0 @4xl:block' : 'min-w-0'}>
            <EntityTable
              columns={columns}
              groups={groups}
              getRowKey={(row) => row.id}
              selected={opened ? new Set([opened.id]) : undefined}
              onRowClick={(row) => {
                setOpened(row.entityId);
              }}
              aria-label="Library"
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
          ) : panelOpen ? (
            <aside
              aria-label="Loading entry"
              aria-busy="true"
              className="bg-surface-container-low flex min-w-0 flex-col gap-3 rounded-xl p-4"
            >
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-7 w-full" />
              ))}
            </aside>
          ) : openedId !== null ? (
            // The link named something this reader cannot see, or that no longer exists. Both
            // read the same on purpose — distinguishing them would confirm the id exists.
            <aside
              aria-label="Entry unavailable"
              className="bg-surface-container-low flex min-w-0 flex-col gap-2 rounded-xl p-4"
            >
              <p className="text-on-surface text-title-small">Not available</p>
              <p className="text-on-surface-variant text-body-medium">
                That entry is no longer here, or you do not have access to it.
              </p>
              <Button
                variant="outline"
                controlSize="lg"
                className="self-start"
                onClick={() => {
                  setOpened(null);
                }}
              >
                Back to the library
              </Button>
            </aside>
          ) : null}
        </div>
      )}
    </ListPageLayout>
  );
}
