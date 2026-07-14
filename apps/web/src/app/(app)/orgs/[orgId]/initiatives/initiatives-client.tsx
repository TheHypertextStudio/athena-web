'use client';

import type {
  EntityDisplayColorKey,
  EntityDisplayIconKey,
  EntityDisplayOut,
  InitiativeAttentionItem,
  InitiativeOverviewItem,
  InitiativeOverviewOut,
} from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ChevronLeft, ChevronRight, Plus, Target } from '@docket/ui/icons';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { CreateInitiativeDialog } from '@/components/initiatives/create-initiative';
import { formatDate } from '@/components/initiatives/format-date';
import { HEALTH_FILL_CLASS } from '@/components/initiatives/health';
import { InitiativeIconPicker } from '@/components/initiatives/initiative-icon-picker';
import { api } from '@/lib/api';
import { initiativeOverviewDef } from '@/lib/fetch-initiative-overview';
import { queryKeys, unwrap, useApiMutation, useApiQuery, usePrefetchApi } from '@/lib/query';
import { initiativeDetailDef } from '@/lib/fetch-initiative-detail';
import { userErrorMessage } from '@/lib/problem';

const STATUS_LABEL = {
  proposed: 'Proposed',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
} as const;
const HEALTH_LABEL = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
} as const;
const HEALTH_TEXT_CLASS = {
  on_track: 'text-state-completed',
  at_risk: 'text-state-canceled',
  off_track: 'text-destructive',
} as const;

const ROSTER_ROW_HEIGHT = 72;
const ROSTER_CELL_INSET = 12;
const ROSTER_INDENT_STEP = 48;
const ROSTER_ICON_TARGET = 40;

interface InitiativeRosterRow {
  item: InitiativeOverviewItem;
  continuationDepths: readonly number[];
  hasVisibleChildren: boolean;
  isLastSibling: boolean;
}

/** Add the sibling context needed to draw a hierarchy without storing presentation state. */
function decorateHierarchy(items: readonly InitiativeOverviewItem[]): InitiativeRosterRow[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const childrenByParent = new Map<string | null, InitiativeOverviewItem[]>();
  for (const item of items) {
    const siblings = childrenByParent.get(item.parentInitiativeId) ?? [];
    childrenByParent.set(item.parentInitiativeId, [...siblings, item]);
  }

  return items.map((item) => {
    const siblings = childrenByParent.get(item.parentInitiativeId) ?? [];
    const continuationDepths: number[] = [];
    let ancestor = item.parentInitiativeId ? byId.get(item.parentInitiativeId) : undefined;
    while (ancestor?.parentInitiativeId) {
      const ancestorSiblings = childrenByParent.get(ancestor.parentInitiativeId) ?? [];
      if (ancestorSiblings.at(-1)?.id !== ancestor.id) {
        continuationDepths.push(ancestor.depth - 1);
      }
      ancestor = byId.get(ancestor.parentInitiativeId);
    }

    return {
      item,
      continuationDepths,
      hasVisibleChildren: (childrenByParent.get(item.id)?.length ?? 0) > 0,
      isLastSibling: siblings.at(-1)?.id === item.id,
    };
  });
}

function HierarchyRails({
  depth,
  continuationDepths,
  hasChildren,
  hasSummary,
  isLastSibling,
}: {
  depth: number;
  continuationDepths: readonly number[];
  hasChildren: boolean;
  hasSummary: boolean;
  isLastSibling: boolean;
}): JSX.Element | null {
  if (depth === 1 && !hasChildren && continuationDepths.length === 0) return null;

  const iconTop = hasSummary ? 8 : 16;
  const targetLeft = ROSTER_CELL_INSET + (depth - 1) * ROSTER_INDENT_STEP;
  const iconCenter = targetLeft + ROSTER_ICON_TARGET / 2;
  const branchY = iconTop + ROSTER_ICON_TARGET / 2;
  const parentRailX = iconCenter - ROSTER_INDENT_STEP;
  const branchEndX = targetLeft;

  return (
    <svg
      aria-hidden
      data-testid="initiative-hierarchy-rail"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      height={ROSTER_ROW_HEIGHT}
      width="100%"
    >
      <g
        className="stroke-outline-variant"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {continuationDepths.map((railDepth) => {
          const railX =
            ROSTER_CELL_INSET + (railDepth - 1) * ROSTER_INDENT_STEP + ROSTER_ICON_TARGET / 2;
          return <line key={railDepth} x1={railX} y1="0" x2={railX} y2={ROSTER_ROW_HEIGHT} />;
        })}
        {depth > 1 ? (
          <>
            <line
              x1={parentRailX}
              y1="0"
              x2={parentRailX}
              y2={isLastSibling ? branchY - 8 : ROSTER_ROW_HEIGHT}
            />
            <path
              d={`M ${parentRailX} ${branchY - 8} Q ${parentRailX} ${branchY} ${parentRailX + 8} ${branchY} H ${branchEndX}`}
            />
          </>
        ) : null}
        {hasChildren ? (
          <line
            x1={iconCenter}
            y1={iconTop + ROSTER_ICON_TARGET}
            x2={iconCenter}
            y2={ROSTER_ROW_HEIGHT}
          />
        ) : null}
      </g>
    </svg>
  );
}

function AttentionSurface({
  item,
  orgId,
  index,
  count,
  onPrevious,
  onNext,
}: {
  item: InitiativeAttentionItem;
  orgId: string;
  index: number;
  count: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const href = `/orgs/${item.organizationId}/initiatives/${item.initiativeId}${item.action === 'update' ? '?tab=updates&compose=1' : ''}`;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className="text-on-surface-variant font-medium">Needs your attention</span>
          <Badge variant={item.severity === 'off_track' ? 'destructive' : 'secondary'}>
            {item.severity === 'stale' ? 'Update due' : HEALTH_LABEL[item.severity]}
          </Badge>
          {item.organizationId !== orgId ? (
            <Badge variant="outline">{item.organizationName}</Badge>
          ) : null}
        </div>
        <Link href={href} className="text-on-surface text-sm font-medium hover:underline">
          {item.title}
        </Link>
        {item.excerpt ? (
          <p className="text-on-surface-variant mt-1 line-clamp-2 text-sm">{item.excerpt}</p>
        ) : null}
        {item.organizationId !== orgId && item.parentInitiativeName ? (
          <p className="text-on-surface-variant mt-1 text-xs">In {item.parentInitiativeName}</p>
        ) : null}
      </div>
      <footer data-testid="initiative-attention-footer" className="w-full">
        <div
          data-testid="initiative-attention-controls"
          className="flex items-center justify-between gap-3"
        >
          <Button asChild size="sm" variant="outline" className="min-h-10 @2xl:min-h-0">
            <Link href={href}>{item.action === 'update' ? 'Post update' : 'Open'}</Link>
          </Button>
          {count > 1 ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous attention item"
                onClick={onPrevious}
              >
                <ChevronLeft aria-hidden className="size-5" />
              </Button>
              <span className="text-on-surface-variant min-w-8 text-center text-xs tabular-nums">
                {index + 1}/{count}
              </span>
              <Button variant="ghost" size="icon" aria-label="Next attention item" onClick={onNext}>
                <ChevronRight aria-hidden className="size-5" />
              </Button>
            </div>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/** Executive Initiative hierarchy overview. */
export default function InitiativesListClient(): JSX.Element {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const prefetch = usePrefetchApi();
  const initiativeNoun = useVocabulary('initiative');
  const initiativePlural = useVocabulary('initiative', { plural: true });
  const [createOpen, setCreateOpen] = useState(false);
  const [attentionIndex, setAttentionIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | keyof typeof STATUS_LABEL>('all');
  const [sort, setSort] = useState<'title' | 'target' | 'status'>('title');
  const overview = useApiQuery(initiativeOverviewDef(orgId));
  const data: InitiativeOverviewOut | undefined = overview.data;
  const overviewKey = useMemo(() => queryKeys.initiatives(orgId), [orgId]);
  const displayMutation = useApiMutation<
    EntityDisplayOut,
    { initiativeId: string; iconKey: EntityDisplayIconKey; colorKey: EntityDisplayColorKey },
    { previous?: InitiativeOverviewOut }
  >({
    mutationFn: ({ initiativeId, iconKey, colorKey }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$put({
            param: { orgId, subjectType: 'initiative', subjectId: initiativeId },
            json: { iconKey, colorKey },
          }),
        'Could not customize this initiative.',
      ),
    onMutate: async ({ initiativeId, iconKey, colorKey }) => {
      await queryClient.cancelQueries({ queryKey: overviewKey });
      const previous = queryClient.getQueryData<InitiativeOverviewOut>(overviewKey);
      queryClient.setQueryData<InitiativeOverviewOut>(overviewKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === initiativeId
                  ? {
                      ...item,
                      display: {
                        subjectType: 'initiative',
                        subjectId: initiativeId,
                        iconKey,
                        colorKey,
                        customized: true,
                      },
                    }
                  : item,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(overviewKey, context.previous);
    },
    onSuccess: (display) => {
      queryClient.setQueryData<InitiativeOverviewOut>(overviewKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === display.subjectId ? { ...item, display } : item,
              ),
            }
          : current,
      );
    },
    invalidateKeys: [overviewKey],
  });
  const attention = data?.attention ?? [];
  const currentAttention = attention[attentionIndex % Math.max(attention.length, 1)];
  const visibleItems = useMemo(() => {
    const items = data?.items ?? [];
    const byId = new Map(items.map((item) => [item.id, item]));
    const childrenByParent = new Map<string | null, typeof items>();
    for (const item of items) {
      const siblings = childrenByParent.get(item.parentInitiativeId) ?? [];
      childrenByParent.set(item.parentInitiativeId, [...siblings, item]);
    }
    const compare = (a: (typeof items)[number], b: (typeof items)[number]): number => {
      if (sort === 'target') return (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999');
      if (sort === 'status')
        return a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    };
    const ordered: typeof items = [];
    const visit = (parentId: string | null): void => {
      for (const item of [...(childrenByParent.get(parentId) ?? [])].sort(compare)) {
        ordered.push(item);
        visit(item.id);
      }
    };
    visit(null);
    const needle = search.trim().toLowerCase();
    const keep = new Set<string>();
    for (const item of ordered) {
      const matchesText =
        !needle || `${item.name} ${item.summary ?? ''}`.toLowerCase().includes(needle);
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      if (!matchesText || !matchesStatus) continue;
      let current: (typeof items)[number] | undefined = item;
      while (current) {
        keep.add(current.id);
        current = current.parentInitiativeId ? byId.get(current.parentInitiativeId) : undefined;
      }
    }
    return ordered.filter((item) => keep.has(item.id));
  }, [data?.items, search, sort, statusFilter]);
  const rosterRows = useMemo(() => decorateHierarchy(visibleItems), [visibleItems]);

  const handleCreated = useCallback(
    (created: { id: string }): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.initiatives(orgId) });
      router.push(`/orgs/${orgId}/initiatives/${created.id}`);
    },
    [orgId, queryClient, router],
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-on-surface text-page-title">{initiativePlural}</h1>
          <p className="text-on-surface-variant mt-1 text-sm">
            Strategic direction, health, and ownership at a glance.
          </p>
        </div>
        <Button
          className="min-h-10 gap-1.5"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <Plus aria-hidden className="size-4" /> New {initiativeNoun.toLowerCase()}
        </Button>
      </header>

      <CreateInitiativeDialog
        orgId={orgId}
        initiativeNoun={initiativeNoun}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      {!overview.isPending && !overview.isError ? (
        <section
          className="bg-surface-container-low flex flex-col rounded-xl p-4"
          aria-label="Needs your attention"
        >
          {currentAttention ? (
            <AttentionSurface
              item={currentAttention}
              orgId={orgId}
              index={attentionIndex % attention.length}
              count={attention.length}
              onPrevious={() => {
                setAttentionIndex((value) => (value - 1 + attention.length) % attention.length);
              }}
              onNext={() => {
                setAttentionIndex((value) => (value + 1) % attention.length);
              }}
            />
          ) : (
            <div>
              <p className="text-on-surface text-sm font-medium">Nothing needs attention</p>
              <p className="text-on-surface-variant mt-1 text-sm">
                No active initiative is at risk, off track, or overdue for an update.
              </p>
            </div>
          )}
        </section>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder={`Filter ${initiativePlural.toLowerCase()}…`}
            aria-label={`Filter ${initiativePlural.toLowerCase()}`}
            className="border-input bg-background h-10 min-w-52 flex-1 rounded-md border px-3 text-sm"
          />
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as typeof statusFilter);
            }}
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as typeof sort);
            }}
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            aria-label="Sort initiatives"
          >
            <option value="title">Sort by title</option>
            <option value="status">Sort by status</option>
            <option value="target">Sort by target</option>
          </select>
        </div>
      ) : null}

      {overview.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
      ) : overview.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {userErrorMessage(overview.error, 'Could not load initiatives.')}
        </p>
      ) : data && data.items.length > 0 ? (
        <div className="bg-surface-container-low relative rounded-xl p-2">
          <div className="overflow-x-auto overscroll-x-contain pb-1">
            <div
              role="treegrid"
              aria-label={`${initiativePlural} hierarchy`}
              aria-rowcount={rosterRows.length}
              className="min-w-[56rem] text-sm"
            >
              <div
                role="row"
                className="text-on-surface-variant grid h-8 grid-cols-[minmax(22.5rem,1fr)_5.5rem_7rem_7.5rem_6rem_7rem] items-center text-xs"
              >
                <div role="columnheader" className="pr-3 pl-16 font-medium">
                  {initiativeNoun}
                </div>
                <div role="columnheader" className="px-3 font-medium whitespace-nowrap">
                  Status
                </div>
                <div role="columnheader" className="px-3 font-medium whitespace-nowrap">
                  Health
                </div>
                <div role="columnheader" className="px-3 font-medium whitespace-nowrap">
                  Owner
                </div>
                <div role="columnheader" className="px-3 font-medium whitespace-nowrap">
                  Target
                </div>
                <div role="columnheader" className="px-3 font-medium whitespace-nowrap">
                  Last update
                </div>
              </div>
              {rosterRows.map(
                ({ item, continuationDepths, hasVisibleChildren, isLastSibling }, rowIndex) => {
                  const targetDate = formatDate(item.targetDate);
                  const lastUpdate = formatDate(item.lastUpdateAt);
                  const hasSummary = Boolean(item.summary?.trim());
                  const itemLeft = ROSTER_CELL_INSET + (item.depth - 1) * ROSTER_INDENT_STEP;
                  return (
                    <div
                      key={item.id}
                      role="row"
                      aria-level={item.depth}
                      aria-rowindex={rowIndex + 1}
                      className="hover:bg-surface-container-high grid h-[72px] grid-cols-[minmax(22.5rem,1fr)_5.5rem_7rem_7.5rem_6rem_7rem] rounded-lg transition-colors"
                      onMouseEnter={() => {
                        prefetch(initiativeDetailDef(item.organizationId, item.id));
                      }}
                    >
                      <div role="gridcell" className="relative h-full min-w-0">
                        <HierarchyRails
                          depth={item.depth}
                          continuationDepths={continuationDepths}
                          hasChildren={hasVisibleChildren}
                          hasSummary={hasSummary}
                          isLastSibling={isLastSibling}
                        />
                        <div
                          className={`relative flex h-full min-w-0 ${hasSummary ? 'items-start pt-2' : 'items-center'}`}
                          style={{ paddingLeft: `${itemLeft}px` }}
                        >
                          <InitiativeIconPicker
                            display={item.display}
                            initiativeName={item.name}
                            editable={item.organizationId === orgId}
                            pending={displayMutation.isPending}
                            onChange={(iconKey, colorKey) => {
                              displayMutation.mutate({ initiativeId: item.id, iconKey, colorKey });
                            }}
                          />
                          <div className="ml-3 min-w-0 pt-0.5">
                            <div className="flex min-w-0 items-center">
                              <Link
                                href={`/orgs/${item.organizationId}/initiatives/${item.id}`}
                                title={item.name}
                                className="text-on-surface line-clamp-1 min-w-0 text-sm leading-5 font-semibold hover:underline"
                              >
                                {item.name}
                              </Link>
                              {item.organizationId !== orgId ? (
                                <Badge className="ml-2 shrink-0" variant="outline">
                                  {item.organizationName}
                                </Badge>
                              ) : null}
                            </div>
                            {item.summary ? (
                              <p className="text-on-surface-variant mt-0.5 line-clamp-2 max-w-[44ch] text-xs leading-4">
                                {item.summary}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div role="gridcell" className="flex items-center px-3 whitespace-nowrap">
                        {STATUS_LABEL[item.status]}
                      </div>
                      <div role="gridcell" className="flex items-center px-3 whitespace-nowrap">
                        {item.health ? (
                          <span
                            className={`${HEALTH_TEXT_CLASS[item.health]} flex items-center gap-1.5 font-medium`}
                          >
                            <span
                              aria-hidden
                              className={`${HEALTH_FILL_CLASS[item.health]} size-1.5 rounded-full`}
                            />
                            {HEALTH_LABEL[item.health]}
                          </span>
                        ) : (
                          <span className="text-on-surface-variant">—</span>
                        )}
                      </div>
                      <div role="gridcell" className="flex items-center px-3 whitespace-nowrap">
                        {item.ownerName ?? <span className="text-on-surface-variant">—</span>}
                      </div>
                      <div
                        role="gridcell"
                        className="flex items-center px-3 whitespace-nowrap tabular-nums"
                      >
                        {targetDate ?? <span className="text-on-surface-variant">—</span>}
                      </div>
                      <div
                        role="gridcell"
                        className="flex items-center px-3 whitespace-nowrap tabular-nums"
                      >
                        {lastUpdate ?? <span className="text-on-surface-variant">Never</span>}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </div>
          <div
            aria-hidden
            className="from-surface-container-low/0 to-surface-container-low pointer-events-none absolute top-2 right-0 bottom-2 w-4 bg-linear-to-r @4xl:hidden"
          />
        </div>
      ) : (
        <EmptyState
          icon={Target}
          title={`No ${initiativePlural.toLowerCase()} yet`}
          body="Create a strategic theme to connect ongoing programs and bounded projects."
          cta={{
            label: `Create your first ${initiativeNoun.toLowerCase()}`,
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      )}
      {displayMutation.error ? (
        <p role="alert" className="text-destructive text-sm">
          {userErrorMessage(displayMutation.error, 'Could not customize this initiative.')}
        </p>
      ) : null}
    </main>
  );
}
