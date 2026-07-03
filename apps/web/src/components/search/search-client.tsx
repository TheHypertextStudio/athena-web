'use client';

import type {
  SearchDocumentFamily,
  SearchDocumentKind,
  SearchResult,
  SourceSystemKind,
} from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { Activity, Search, type LucideIcon } from '@docket/ui/icons';
import { Button, Input, Row, Skeleton, Stack } from '@docket/ui/primitives';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { SEARCH_KIND_ICON, SEARCH_KIND_LABEL } from '@/components/command-palette/use-hub-search';
import { OrgChip } from '@/components/org-chip';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { hrefForSearchResult, isExternalSearchHref } from '@/lib/search-route';

import {
  type SearchPageFilters,
  parseSearchPageFilters,
  searchPageFiltersToHttpQuery,
  searchPageHref,
} from './search-url-state';

const DEBOUNCE_MS = 180;
const PAGE_SIZE = 30;
const EMPTY_ORG_IDS: readonly string[] = [];

const FAMILY_OPTIONS: readonly {
  value: SearchDocumentFamily;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: 'work', label: 'Work', icon: SEARCH_KIND_ICON.task },
  { value: 'people', label: 'People', icon: SEARCH_KIND_ICON.member },
  { value: 'content', label: 'Content', icon: SEARCH_KIND_ICON.comment },
  { value: 'activity', label: 'Activity', icon: Activity },
];

interface SearchClientProps {
  scope: 'hub' | 'org';
  orgId?: string;
}

/** Authenticated semantic search surface. */
export function SearchClient({ scope, orgId }: SearchClientProps): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();
  const urlFilters = useMemo(
    () => parseSearchPageFilters(new URLSearchParams(searchParamString)),
    [searchParamString],
  );
  const { orgs, orgName } = useActiveOrg();

  const [draft, setDraft] = useState(urlFilters.query);
  const [query, setQuery] = useState(urlFilters.query);
  const [cursor, setCursor] = useState<string | null>(null);
  const [families, setFamilies] = useState<readonly SearchDocumentFamily[]>(urlFilters.families);
  const [kinds, setKinds] = useState<readonly SearchDocumentKind[]>(urlFilters.kinds);
  const [sources, setSources] = useState<readonly SourceSystemKind[]>(urlFilters.sources);
  const [orgIds, setOrgIds] = useState<readonly string[]>(urlFilters.orgIds);
  const [ownerIds, setOwnerIds] = useState<readonly string[]>(urlFilters.ownerIds);
  const [assigneeIds, setAssigneeIds] = useState<readonly string[]>(urlFilters.assigneeIds);
  const [labelIds, setLabelIds] = useState<readonly string[]>(urlFilters.labelIds);
  const [statuses, setStatuses] = useState<readonly string[]>(urlFilters.statuses);
  const [healths, setHealths] = useState<readonly string[]>(urlFilters.healths);
  const [fromDate, setFromDate] = useState(urlFilters.fromDate);
  const [toDate, setToDate] = useState(urlFilters.toDate);
  const [accumulatedResults, setAccumulatedResults] = useState<readonly SearchResult[]>([]);

  useEffect(() => {
    setDraft(urlFilters.query);
    setQuery(urlFilters.query);
    setFamilies(urlFilters.families);
    setKinds(urlFilters.kinds);
    setSources(urlFilters.sources);
    setOrgIds(urlFilters.orgIds);
    setOwnerIds(urlFilters.ownerIds);
    setAssigneeIds(urlFilters.assigneeIds);
    setLabelIds(urlFilters.labelIds);
    setStatuses(urlFilters.statuses);
    setHealths(urlFilters.healths);
    setFromDate(urlFilters.fromDate);
    setToDate(urlFilters.toDate);
    setCursor(null);
  }, [urlFilters]);

  const effectiveOrgIds = scope === 'hub' ? orgIds : EMPTY_ORG_IDS;
  const filters = useMemo<SearchPageFilters>(
    () => ({
      query,
      families,
      kinds,
      sources,
      orgIds: effectiveOrgIds,
      ownerIds,
      assigneeIds,
      labelIds,
      statuses,
      healths,
      fromDate,
      toDate,
    }),
    [
      assigneeIds,
      effectiveOrgIds,
      families,
      fromDate,
      healths,
      kinds,
      labelIds,
      ownerIds,
      query,
      sources,
      statuses,
      toDate,
    ],
  );

  const replaceFilters = useCallback(
    (next: SearchPageFilters) => {
      const href = searchPageHref(pathname, new URLSearchParams(searchParamString), next);
      const currentHref = searchParamString ? `${pathname}?${searchParamString}` : pathname;
      if (href !== currentHref) router.replace(href, { scroll: false });
    },
    [pathname, router, searchParamString],
  );

  const commitFilters = useCallback(
    (patch: Partial<SearchPageFilters>) => {
      const next: SearchPageFilters = {
        query: draft.trim(),
        families,
        kinds,
        sources,
        orgIds: effectiveOrgIds,
        ownerIds,
        assigneeIds,
        labelIds,
        statuses,
        healths,
        fromDate,
        toDate,
        ...patch,
      };
      setDraft(next.query);
      setQuery(next.query);
      setFamilies(next.families);
      setKinds(next.kinds);
      setSources(next.sources);
      setOrgIds(next.orgIds);
      setOwnerIds(next.ownerIds);
      setAssigneeIds(next.assigneeIds);
      setLabelIds(next.labelIds);
      setStatuses(next.statuses);
      setHealths(next.healths);
      setFromDate(next.fromDate);
      setToDate(next.toDate);
      setCursor(null);
      replaceFilters(next);
    },
    [
      assigneeIds,
      draft,
      effectiveOrgIds,
      families,
      fromDate,
      healths,
      kinds,
      labelIds,
      ownerIds,
      replaceFilters,
      sources,
      statuses,
      toDate,
    ],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQuery = draft.trim();
      setQuery(nextQuery);
      setCursor(null);
      replaceFilters({ ...filters, query: nextQuery });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [draft, filters, replaceFilters]);

  const queryArgs = useMemo(
    () => searchPageFiltersToHttpQuery(filters, { limit: PAGE_SIZE, cursor }),
    [cursor, filters],
  );
  const queryKey = useMemo(() => JSON.stringify(queryArgs), [queryArgs]);
  const resultSetKey = useMemo(
    () => JSON.stringify({ scope, orgId: orgId ?? null, filters }),
    [filters, orgId, scope],
  );

  const searchQ = useApiQuery(
    apiQueryOptions(
      queryKeys.search(scope, queryKey, orgId),
      () =>
        scope === 'org' && orgId
          ? api.v1.orgs[':orgId'].search.$get({ param: { orgId }, query: queryArgs })
          : api.v1.hub.search.$get({ query: queryArgs }),
      'Search failed.',
      { enabled: query.length > 0 && (scope === 'hub' || Boolean(orgId)) },
    ),
  );

  const data = searchQ.data ?? null;
  const loadingInitial = query.length > 0 && searchQ.isPending && cursor === null;
  const loadingMore = query.length > 0 && searchQ.isPending && cursor !== null;
  const error = searchQ.isError ? searchQ.error.message : null;

  useEffect(() => {
    setAccumulatedResults([]);
  }, [resultSetKey]);

  useEffect(() => {
    if (!data) return;
    setAccumulatedResults((previous) => {
      if (!cursor) return data.items;
      const seen = new Set(previous.map((item) => item.id));
      return [...previous, ...data.items.filter((item) => !seen.has(item.id))];
    });
  }, [cursor, data]);

  const results = accumulatedResults;
  const hasFilters =
    families.length > 0 ||
    kinds.length > 0 ||
    sources.length > 0 ||
    effectiveOrgIds.length > 0 ||
    ownerIds.length > 0 ||
    assigneeIds.length > 0 ||
    labelIds.length > 0 ||
    statuses.length > 0 ||
    healths.length > 0 ||
    Boolean(fromDate || toDate);

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3">
        <Row justify="between" align="center" className="gap-3">
          <div>
            <h1 className="text-on-surface text-h1">Search</h1>
            <p className="text-on-surface-variant text-xs">
              {scope === 'org' && orgId ? 'Workspace scope' : 'All workspaces'}
            </p>
          </div>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                commitFilters({
                  families: [],
                  kinds: [],
                  sources: [],
                  orgIds: [],
                  ownerIds: [],
                  assigneeIds: [],
                  labelIds: [],
                  statuses: [],
                  healths: [],
                  fromDate: '',
                  toDate: '',
                });
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </Row>
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            commitFilters({ query: draft.trim() });
          }}
        >
          <label className="sr-only" htmlFor="workspace-search-input">
            Search
          </label>
          <div className="border-outline-variant bg-surface-container-low flex items-center gap-2 rounded-lg border px-3 py-2">
            <Search aria-hidden="true" className="text-on-surface-variant size-5 shrink-0" />
            <Input
              id="workspace-search-input"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              placeholder="Find work, people, updates, and activity"
              className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>
        </form>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 @4xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-4">
          <FilterGroup title="Family">
            <div className="grid grid-cols-2 gap-2 @4xl:grid-cols-1">
              {FAMILY_OPTIONS.map((option) => (
                <FilterButton
                  key={option.value}
                  active={families.includes(option.value)}
                  icon={option.icon}
                  label={option.label}
                  onClick={() => {
                    commitFilters({ families: toggleValue(families, option.value) });
                  }}
                />
              ))}
            </div>
          </FilterGroup>

          {scope === 'hub' && orgs.length > 1 ? (
            <FilterGroup title="Workspace">
              <Stack gap={1}>
                {orgs.map((org) => (
                  <FilterButton
                    key={org.id}
                    active={effectiveOrgIds.includes(org.id)}
                    label={org.name}
                    onClick={() => {
                      commitFilters({ orgIds: toggleValue(effectiveOrgIds, org.id) });
                    }}
                  />
                ))}
              </Stack>
            </FilterGroup>
          ) : null}

          <FacetFilter
            title="Kind"
            values={data?.facets.find((facet) => facet.field === 'kind')?.values ?? []}
            selected={kinds}
            labelFor={(value) => SEARCH_KIND_LABEL[value as SearchDocumentKind]}
            onToggle={(value) => {
              commitFilters({ kinds: toggleValue(kinds, value as SearchDocumentKind) });
            }}
          />

          <FacetFilter
            title="Source"
            values={data?.facets.find((facet) => facet.field === 'source')?.values ?? []}
            selected={sources}
            labelFor={sourceLabel}
            onToggle={(value) => {
              commitFilters({ sources: toggleValue(sources, value as SourceSystemKind) });
            }}
          />

          <FacetFilter
            title="Owner"
            values={data?.facets.find((facet) => facet.field === 'owner')?.values ?? []}
            selected={ownerIds}
            labelFor={identityFacetLabel}
            onToggle={(value) => {
              commitFilters({ ownerIds: toggleValue(ownerIds, value) });
            }}
          />

          <FacetFilter
            title="Assignee"
            values={data?.facets.find((facet) => facet.field === 'assignee')?.values ?? []}
            selected={assigneeIds}
            labelFor={identityFacetLabel}
            onToggle={(value) => {
              commitFilters({ assigneeIds: toggleValue(assigneeIds, value) });
            }}
          />

          <FacetFilter
            title="Label"
            values={data?.facets.find((facet) => facet.field === 'label')?.values ?? []}
            selected={labelIds}
            labelFor={identityFacetLabel}
            onToggle={(value) => {
              commitFilters({ labelIds: toggleValue(labelIds, value) });
            }}
          />

          <FacetFilter
            title="Status"
            values={data?.facets.find((facet) => facet.field === 'status')?.values ?? []}
            selected={statuses}
            labelFor={sourceLabel}
            onToggle={(value) => {
              commitFilters({ statuses: toggleValue(statuses, value) });
            }}
          />

          <FacetFilter
            title="Health"
            values={data?.facets.find((facet) => facet.field === 'health')?.values ?? []}
            selected={healths}
            labelFor={sourceLabel}
            onToggle={(value) => {
              commitFilters({ healths: toggleValue(healths, value) });
            }}
          />

          <FilterGroup title="Window">
            <Stack gap={2}>
              <DateInput
                label="From"
                value={fromDate}
                onChange={(value) => {
                  commitFilters({ fromDate: value });
                }}
              />
              <DateInput
                label="To"
                value={toDate}
                onChange={(value) => {
                  commitFilters({ toDate: value });
                }}
              />
            </Stack>
          </FilterGroup>
        </aside>

        <main className="min-w-0">
          {error ? (
            <div
              role="alert"
              className="border-destructive/40 bg-destructive/5 text-destructive text-body flex items-center justify-between gap-4 rounded-lg border p-4"
            >
              <span>{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void searchQ.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          ) : loadingInitial ? (
            <Stack gap={1} aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </Stack>
          ) : query.length === 0 ? (
            <EmptyState icon={Search} title="Search" body="Results appear as you type." />
          ) : results.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No results"
              body="Try another term or clear filters."
            />
          ) : (
            <Stack gap={3}>
              <Stack as="ul" gap={1} className="min-w-0">
                {results.map((result) => (
                  <li key={result.id}>
                    <SearchResultRow result={result} orgName={orgName} />
                  </li>
                ))}
              </Stack>
              {data?.nextCursor ? (
                <Button
                  variant="outline"
                  className="self-start"
                  disabled={loadingMore}
                  onClick={() => {
                    setCursor(data.nextCursor ?? null);
                  }}
                >
                  {loadingMore ? 'Loading' : 'More'}
                </Button>
              ) : null}
            </Stack>
          )}
        </main>
      </div>
    </div>
  );
}

function SearchResultRow({
  result,
  orgName,
}: {
  result: SearchResult;
  orgName: (orgId: string) => string;
}): JSX.Element {
  const href = hrefForSearchResult(result);
  const Icon = SEARCH_KIND_ICON[result.kind];
  const content = (
    <div className="border-outline-variant hover:bg-surface-container-low focus-visible:ring-ring flex min-w-0 gap-3 rounded-lg border px-3 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none">
      <Icon aria-hidden="true" className="text-on-surface-variant mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <Row gap={2} className="min-w-0 flex-wrap">
          <span className="text-on-surface truncate text-sm font-medium">{result.title}</span>
          <span className="text-on-surface-variant border-outline-variant shrink-0 rounded border px-1.5 py-0.5 text-xs">
            {SEARCH_KIND_LABEL[result.kind]}
          </span>
          {result.organizationId ? (
            <OrgChip orgId={result.organizationId} name={orgName(result.organizationId)} />
          ) : null}
        </Row>
        {(result.snippet ?? result.summary) ? (
          <p className="text-on-surface-variant mt-1 line-clamp-2 text-xs">
            {result.snippet ?? result.summary}
          </p>
        ) : null}
        <Row gap={2} className="mt-2 flex-wrap">
          {result.source ? (
            <span className="text-on-surface-variant text-xs">
              {sourceLabel(result.source.system)}
            </span>
          ) : null}
          {result.matchedFields.map((field) => (
            <span
              key={field}
              className="bg-surface-container text-on-surface-variant rounded px-1.5 py-0.5 text-[11px]"
            >
              {field}
            </span>
          ))}
        </Row>
      </div>
    </div>
  );

  if (!href) return content;
  if (isExternalSearchHref(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block">
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className="block">
      {content}
    </Link>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="min-w-0">
      <h2 className="text-on-surface-variant mb-2 text-xs font-semibold tracking-normal uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function FilterButton({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon?: LucideIcon;
  label: string;
  count?: number;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? 'bg-primary-container text-on-primary-container flex h-9 min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs font-medium'
          : 'bg-surface-container-low text-on-surface hover:bg-surface-container flex h-9 min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs font-medium'
      }
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="shrink-0 tabular-nums">{count}</span> : null}
    </button>
  );
}

function FacetFilter({
  title,
  values,
  selected,
  labelFor,
  onToggle,
}: {
  title: string;
  values: readonly { value: string; count: number; label?: string }[];
  selected: readonly string[];
  labelFor: (value: string) => string;
  onToggle: (value: string) => void;
}): JSX.Element | null {
  if (values.length === 0 && selected.length === 0) return null;
  const merged = [
    ...values,
    ...selected
      .filter((value) => !values.some((facet) => facet.value === value))
      .map((value) => ({ value, count: 0 })),
  ];
  return (
    <FilterGroup title={title}>
      <Stack gap={1}>
        {merged.map((value) => (
          <FilterButton
            key={value.value}
            active={selected.includes(value.value)}
            label={labelFor(value.value)}
            count={value.count}
            onClick={() => {
              onToggle(value.value);
            }}
          />
        ))}
      </Stack>
    </FilterGroup>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="text-on-surface-variant grid gap-1 text-xs">
      <span>{label}</span>
      <Input
        type="date"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="bg-surface-container-low text-xs"
      />
    </label>
  );
}

function toggleValue<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function sourceLabel(source: string): string {
  return source
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function identityFacetLabel(value: string): string {
  return value;
}
