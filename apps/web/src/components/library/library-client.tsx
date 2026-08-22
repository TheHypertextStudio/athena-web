'use client';

/** The workspace Library: full-corpus resource search and work-context browsing. */
import type {
  ExternalResourceType,
  SearchDocumentKind,
  SearchOut,
  SearchResult,
} from '@docket/types';
import { type Column, EntityTable, type EntityTableGroup, EmptyState } from '@docket/ui/components';
import { Info, Library, Link as LinkIcon, RefreshCw, type LucideIcon } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useActiveOrg } from '@/components/active-org';
import { SEARCH_KIND_ICON } from '@/components/command-palette/use-hub-search';
import { InPageSearchField } from '@/components/in-page-search/in-page-search-field';
import { useInPageSearchTarget } from '@/components/in-page-search/in-page-search-provider';
import ResourceDetailPanel from '@/components/library/resource-detail-panel';
import { RESOURCE_TYPE_ICON } from '@/components/mentions/mention-glyphs';
import { relativeTime } from '@/components/project-detail/format-time';
import { applyView, EMPTY_GROUP_ID } from '@/components/views/apply-view';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { ListPageLayout } from '@/components/views/page-layout';
import { type UseViewStateDefaults, useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { useAppSearchParams } from '@/lib/app-location';
import { userErrorMessage } from '@/lib/problem';
import {
  apiInfiniteQueryOptions,
  apiQueryOptions,
  queryKeys,
  useApiListQuery,
  useInfiniteApiListQuery,
} from '@/lib/query';
import { useDebouncedValue } from '@/lib/use-debounced-value';

import { buildLibrarySearchQuery, libraryQueryKeyPart, mergeLibraryPages } from './library-data';
import { primaryResourceAction } from './resource-actions';
import {
  buildResourceCatalog,
  LIBRARY_KINDS,
  sourceLabel,
  sourceOf,
  titleResolved,
} from './resource-catalog';

const SEARCH_DEBOUNCE_MS = 180;
const LIBRARY_VIEW_DEFAULTS: UseViewStateDefaults = { groupBy: { field: 'usedIn' } };
const resourceRowKey = (row: SearchResult): string => row.id;

/** Props for {@link LibraryClient}. */
export interface LibraryClientProps {
  /** The workspace whose resources are listed. */
  readonly orgId: string;
}

/** Pick the most specific glyph already used by resource mentions and search. */
function glyphFor(row: SearchResult): LucideIcon {
  const resourceType = row.facets['resourceType'];
  if (typeof resourceType === 'string' && resourceType in RESOURCE_TYPE_ICON) {
    return RESOURCE_TYPE_ICON[resourceType as ExternalResourceType];
  }
  return SEARCH_KIND_ICON[row.kind];
}

/** Return the visible host name for an external URL. */
function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Return an icon for a work-context group hint. */
function contextIcon(hint: string | undefined): LucideIcon | null {
  if (!hint || !(hint in SEARCH_KIND_ICON)) return null;
  return SEARCH_KIND_ICON[hint as SearchDocumentKind];
}

/** Render the Library. */
export default function LibraryClient({ orgId }: LibraryClientProps): JSX.Element {
  const { state, setFilters, setGroupBy, setSort, setSearchParam, pushSearchParams } =
    useViewState(LIBRARY_VIEW_DEFAULTS);
  const { activeOrg } = useActiveOrg();
  const router = useRouter();
  const searchParams = useAppSearchParams();
  const urlQuery = searchParams.get('q')?.trim() ?? '';
  const openedId = searchParams.get('resourceId');
  const [draft, setDraft] = useState(urlQuery);
  const query = useDebouncedValue(draft.trim(), SEARCH_DEBOUNCE_MS);
  const searchActive = query.length > 0;
  const gridRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLElement | null>(null);
  const scrollPositions = useRef({ browse: 0, search: 0 });
  const restoredMode = useRef<'browse' | 'search' | null>(null);
  const pendingUrlQuery = useRef<string | null>(null);
  const { restoreFocus } = useInPageSearchTarget({
    id: 'library',
    rootRef: gridRef,
    inputRef: searchInputRef,
  });

  useEffect(() => {
    if (urlQuery === pendingUrlQuery.current) {
      pendingUrlQuery.current = null;
      return;
    }
    setDraft(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (urlQuery === query) return;
    // Ignore the matching location update. The user may have typed more text while the router
    // applied this debounced value, and copying it back into the input would erase those keys.
    pendingUrlQuery.current = query;
    setSearchParam('q', query || null);
  }, [query, setSearchParam, urlQuery]);

  const setOpened = useCallback(
    (resourceId: string | null): void => {
      if (resourceId === null) {
        router.back();
        requestAnimationFrame(() => {
          gridRef.current?.querySelector<HTMLElement>('[role="grid"]')?.focus();
        });
        return;
      }
      pushSearchParams({ q: draft.trim() || null, resourceId });
    },
    [draft, pushSearchParams, router],
  );

  const resourcesDef = useMemo(
    () =>
      apiInfiniteQueryOptions<SearchOut>(
        queryKeys.search('org', libraryQueryKeyPart(query), orgId),
        (cursor, signal) =>
          api.v1.orgs[':orgId'].search.$get(
            {
              param: { orgId },
              query: buildLibrarySearchQuery(query, cursor),
            },
            { init: { signal } },
          ),
        (lastPage) => lastPage.nextCursor,
        query ? 'Could not search the library.' : 'Could not load the library.',
      ),
    [orgId, query],
  );
  const resourcesQ = useInfiniteApiListQuery(resourcesDef);
  const rows = useMemo(() => mergeLibraryPages(resourcesQ.data?.pages ?? []), [resourcesQ.data]);
  const catalog = useMemo(() => buildResourceCatalog(rows), [rows]);
  const resolvedSearchMode = useRef(searchActive);
  if (!resourcesQ.isPlaceholderData) resolvedSearchMode.current = searchActive;
  const displayedSearchActive = resourcesQ.isPlaceholderData
    ? resolvedSearchMode.current
    : searchActive;
  const presentationState = useMemo(
    () => (displayedSearchActive ? { filters: state.filters, groupBy: null, sort: [] } : state),
    [displayedSearchActive, state],
  );
  const applied = useMemo(
    () => applyView(rows, presentationState, catalog),
    [catalog, presentationState, rows],
  );

  const loadNextPage = useCallback(() => {
    if (
      !resourcesQ.isPlaceholderData &&
      resourcesQ.hasNextPage &&
      !resourcesQ.isFetchingNextPage &&
      !resourcesQ.isFetchNextPageError
    ) {
      void resourcesQ.fetchNextPage();
    }
  }, [resourcesQ]);

  const filtered = state.filters.length > 0;
  useEffect(() => {
    if (applied.rows.length === 0 && (rows.length === 0 || filtered)) loadNextPage();
  }, [applied.rows.length, filtered, loadNextPage, rows.length]);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const mode = displayedSearchActive ? 'search' : 'browse';
    if (restoredMode.current === mode) return;
    restoredMode.current = mode;
    table.scrollTop = scrollPositions.current[mode];
  }, [applied.rows.length, displayedSearchActive, resourcesQ.isPending]);

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
          const host = resolved ? hostOf(row.externalUrl) : null;
          return (
            <span className="flex min-w-0 items-center gap-2">
              <Icon aria-hidden className="text-on-surface-variant size-4! shrink-0" />
              <span
                className={`min-w-0 truncate ${resolved ? 'text-label-large' : 'text-on-surface-variant'}`}
              >
                {row.title}
              </span>
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
        key: 'source',
        header: 'Source',
        width: '9rem',
        priority: 1,
        render: (row) => {
          const source = sourceOf(row);
          return (
            <span className="text-on-surface-variant text-label-small truncate">
              {source ? sourceLabel(source) : 'Docket'}
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
          <span className="text-on-surface-variant text-label-small">
            {relativeTime(row.updatedAt)}
          </span>
        ),
      },
      {
        key: 'info',
        header: <span className="sr-only">Context</span>,
        width: '3rem',
        align: 'end',
        priority: 'always',
        render: (row) => (
          <Button
            type="button"
            variant="ghost"
            iconOnly
            controlSize="lg"
            aria-label={`Show context for ${row.title}`}
            onClick={(event) => {
              event.stopPropagation();
              setOpened(row.entityId);
            }}
          >
            <Info aria-hidden className="size-4" />
          </Button>
        ),
      },
    ],
    [setOpened],
  );

  const groups: readonly EntityTableGroup<SearchResult>[] = useMemo(
    () =>
      (applied.groups ?? []).map((group) => {
        const Icon = group.id === EMPTY_GROUP_ID ? null : contextIcon(group.hint);
        return {
          id: group.id,
          label: group.label,
          rows: group.rows,
          ...(Icon
            ? {
                decoration: (
                  <Icon aria-hidden className="text-on-surface-variant size-4! shrink-0" />
                ),
              }
            : {}),
        };
      }),
    [applied.groups],
  );

  const onPage = openedId === null ? null : (rows.find((row) => row.entityId === openedId) ?? null);
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
  const panelOpen = openedId !== null && (opened !== null || deepLinkQ.isPending);
  const initialError = resourcesQ.isError && rows.length === 0 && !resourcesQ.isFetchNextPageError;
  const refillingSparsePage =
    applied.rows.length === 0 &&
    (rows.length === 0 || filtered) &&
    (resourcesQ.hasNextPage || resourcesQ.isFetchingNextPage || resourcesQ.isFetchNextPageError);

  const endAdornment =
    resourcesQ.isFetchingNextPage ||
    (refillingSparsePage && resourcesQ.hasNextPage && !resourcesQ.isFetchNextPageError) ? (
      <div
        role="status"
        className="text-on-surface-variant text-body-small flex min-h-12 items-center justify-center gap-2"
      >
        <RefreshCw aria-hidden className="size-4 animate-spin" />
        Loading more resources
      </div>
    ) : resourcesQ.isFetchNextPageError ? (
      <div
        role="alert"
        className="text-error text-body-small flex min-h-14 items-center justify-between gap-3 px-3"
      >
        <span>Could not load more resources.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void resourcesQ.fetchNextPage();
          }}
        >
          Retry
        </Button>
      </div>
    ) : undefined;

  return (
    <ListPageLayout
      title="Library"
      fill
      toolbar={
        <div className="flex min-w-0 flex-col gap-3">
          <InPageSearchField
            inputRef={searchInputRef}
            value={draft}
            onValueChange={setDraft}
            onEscapeEmpty={restoreFocus}
            label="Search the Library"
            placeholder="Search documents, links, and files"
            resultCount={applied.rows.length}
            pending={draft.trim() !== query || resourcesQ.isFetching}
          />
          <FilterToolbar
            catalog={catalog}
            state={state}
            onFiltersChange={setFilters}
            onGroupByChange={setGroupBy}
            onSortChange={setSort}
          />
        </div>
      }
    >
      {resourcesQ.isPending ? (
        <div className="flex flex-col gap-1" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : initialError ? (
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(resourcesQ.error, 'Could not load the library.')}
        </p>
      ) : applied.rows.length === 0 &&
        !refillingSparsePage &&
        !displayedSearchActive &&
        !filtered ? (
        <EmptyState
          icon={Library}
          title="Nothing referenced yet"
          body={`Link a document or add a file anywhere in ${activeOrg?.name ?? 'this workspace'} and it shows up here.`}
        />
      ) : (
        <div className="grid min-h-0 min-w-0 flex-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div
            ref={gridRef}
            className={`${panelOpen ? 'hidden @4xl:block' : ''} relative min-h-0 min-w-0`}
          >
            <EntityTable
              columns={columns}
              {...(displayedSearchActive ? { rows: applied.rows } : { groups })}
              getRowKey={resourceRowKey}
              rowHref={(row) => primaryResourceAction(row)?.href}
              rowLinkColumnKey="name"
              renderRowLink={(linkProps) => {
                const {
                  children,
                  href,
                  className,
                  onClick,
                  onMouseEnter,
                  onFocus,
                  tabIndex,
                  'aria-current': ariaCurrent,
                  draggable,
                  onDragStart,
                  onDragEnd,
                } = linkProps;
                if (href.startsWith('/v1/')) {
                  return (
                    <a
                      href={href}
                      className={className}
                      onClick={onClick}
                      tabIndex={tabIndex}
                      aria-current={ariaCurrent}
                      download
                    >
                      {children}
                    </a>
                  );
                }
                if (/^https?:\/\//.test(href)) {
                  return (
                    <a
                      href={href}
                      className={className}
                      onClick={onClick}
                      tabIndex={tabIndex}
                      aria-current={ariaCurrent}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {children}
                    </a>
                  );
                }
                return (
                  <Link
                    href={href}
                    className={className}
                    onClick={onClick}
                    tabIndex={tabIndex}
                    aria-current={ariaCurrent}
                    {...(onMouseEnter ? { onMouseEnter } : {})}
                    {...(onFocus ? { onFocus } : {})}
                    {...(draggable === undefined ? {} : { draggable })}
                    {...(onDragStart ? { onDragStart } : {})}
                    {...(onDragEnd ? { onDragEnd } : {})}
                  >
                    {children}
                  </Link>
                );
              }}
              containerInteraction={{
                ref: (element) => {
                  tableRef.current = element;
                },
                onScroll: (event) => {
                  const mode = displayedSearchActive ? 'search' : 'browse';
                  scrollPositions.current[mode] = event.currentTarget.scrollTop;
                },
              }}
              {...(opened ? { selected: new Set([opened.id]) } : {})}
              virtualized
              onEndReached={loadNextPage}
              endAdornment={endAdornment}
              className={`h-full ${applied.rows.length === 0 && !refillingSparsePage ? 'invisible' : ''}`}
              aria-label={displayedSearchActive ? 'Library search results' : 'Library resources'}
            />
            {applied.rows.length === 0 && !refillingSparsePage ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <EmptyState
                  icon={LinkIcon}
                  title="Nothing matches"
                  body="No document, link, or file matches this search and the active filters."
                  {...(filtered
                    ? {
                        cta: {
                          label: 'Clear filters',
                          onClick: () => {
                            setFilters([]);
                          },
                        },
                      }
                    : {})}
                />
              </div>
            ) : null}
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
