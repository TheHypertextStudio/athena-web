'use client';

import type {
  EntityDisplayColorKey,
  EntityDisplayIconKey,
  EntityDisplayOut,
  InitiativeAttentionItem,
  InitiativeOut,
  InitiativeOverviewItem,
  InitiativeOverviewOut,
} from '@docket/types';
import { InitiativeId } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ChevronLeft, ChevronRight, Plus, Target } from '@docket/ui/icons';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAppParams } from '@/lib/app-location';
import { type JSX, useCallback, useMemo, useRef, useState } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import { formatDate } from '@/components/initiatives/format-date';
import { HEALTH_FILL_CLASS } from '@/components/initiatives/health';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import {
  type InitiativeDragObject,
  selfOrDescendantPredicate,
} from '@/components/initiatives/hierarchy-dnd';
import {
  initiativeDragObjectFromRef,
  resolveInitiativeHierarchyMutation,
} from '@/components/initiatives/initiative-hierarchy-mutations';
import {
  buildInitiativeCatalog,
  formatInitiativeTarget,
  HEALTH_LABEL,
} from '@/components/initiatives/initiative-catalog';
import { useWorkStatusResolver } from '@/components/entity-display/use-work-status';
import { WorkStatusIcon } from '@/components/entity-display/work-status';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { filterRows, sortRows } from '@/components/views/apply-view';
import { ObjectSurface } from '@/components/objects/object-surface';
import { readObjectPayload } from '@/components/dnd/drag-payload';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { ListPageLayout } from '@/components/views/page-layout';
import { ROSTER_DATA_CELL_CLASS, ROSTER_HEADER_CELL_CLASS } from '@/components/views/roster-grid';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { initiativeOverviewDef } from '@/lib/fetch-initiative-overview';
import {
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiListQuery,
  useApiMutation,
  useApiQuery,
  usePrefetchApi,
} from '@/lib/query';
import { initiativeDetailDef } from '@/lib/fetch-initiative-detail';
import { userErrorMessage } from '@/lib/problem';
import { useOrgCapability } from '@/lib/use-org-capability';

const HEALTH_TEXT_CLASS = {
  on_track: 'text-state-completed',
  at_risk: 'text-state-canceled',
  off_track: 'text-error',
} as const;

const ROSTER_ROW_HEIGHT = 56;
const ROSTER_CELL_INSET = 16;
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
          <Button asChild size="sm" variant="outline" className="min-h-10 @2xl:min-h-8">
            <Link href={href}>{item.action === 'update' ? 'Post update' : 'Open'}</Link>
          </Button>
          {count > 1 ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-10 @2xl:size-8"
                aria-label="Previous attention item"
                onClick={onPrevious}
              >
                <ChevronLeft aria-hidden className="size-4" />
              </Button>
              <span className="text-on-surface-variant min-w-8 text-center text-xs tabular-nums">
                {index + 1}/{count}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 @2xl:size-8"
                aria-label="Next attention item"
                onClick={onNext}
              >
                <ChevronRight aria-hidden className="size-4" />
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
  const { orgId } = useAppParams<{ orgId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const prefetch = usePrefetchApi();
  const { openCreate } = useCreateObject();
  const initiativeNoun = useVocabulary('initiative');
  const initiativePlural = useVocabulary('initiative', { plural: true });
  const [attentionIndex, setAttentionIndex] = useState(0);
  const { state, setFilters, setGroupBy, setSort } = useViewState();
  const statuses = useStatusRegistry();
  const statusOf = useWorkStatusResolver('initiative');
  const overview = useApiQuery(initiativeOverviewDef(orgId, api));
  const data: InitiativeOverviewOut | undefined = overview.data;
  const catalog = useMemo(
    () =>
      buildInitiativeCatalog({
        initiatives: data?.items ?? [],
        statuses: statuses.statusesFor('initiative'),
      }),
    [data?.items, statuses],
  );
  // The initiative currently being dragged, and the row it is hovering as a drop (nest) target.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Set while a drag is in flight so the click some browsers synthesize after a drop does not
  // trigger row navigation; cleared on the next tick after the drag ends.
  const dragOccurredRef = useRef(false);
  const overviewKey = useMemo(() => queryKeys.initiatives(orgId), [orgId]);

  // Members + roles resolve whether the caller can rename an initiative inline. An Initiative PATCH
  // requires `contribute` server-side, so the affordance is gated on that same capability (the
  // server still enforces it regardless); cross-workspace reference rows stay read-only.
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      'Could not load roles.',
    ),
  );
  const members = useMemo(() => membersQ.data?.items ?? [], [membersQ.data]);
  const roles = useMemo(() => rolesQ.data?.items ?? [], [rolesQ.data]);
  const canContribute = useOrgCapability(members, roles, 'contribute');

  const renameInitiative = useApiMutation<InitiativeOut, { id: string; name: string }>({
    mutationFn: ({ id, name }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].$patch({
            param: { orgId, id },
            json: { name },
          }),
        `Could not rename this ${initiativeNoun.toLowerCase()}.`,
      ),
    invalidateKeys: [overviewKey],
  });
  const displayMutation = useApiMutation<
    EntityDisplayOut,
    {
      initiativeId: string;
      iconKey: EntityDisplayIconKey;
      colorKey: EntityDisplayColorKey;
      customColor: string | null;
    },
    { previous?: InitiativeOverviewOut | undefined }
  >({
    mutationFn: ({ initiativeId, iconKey, colorKey, customColor }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$put({
            param: { orgId, subjectType: 'initiative', subjectId: initiativeId },
            json: { iconKey, colorKey, customColor },
          }),
        'Could not customize this initiative.',
      ),
    onMutate: async ({ initiativeId, iconKey, colorKey, customColor }) => {
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
                        customColor,
                        // Carried through: the picker changes icon and color only, so an
                        // optimistic write must not blank an uploaded cover.
                        coverImage: item.display.coverImage,
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
    invalidateKeys: [overviewKey, queryKeys.entityDisplays(orgId, 'initiative')],
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
    // Pre-order traversal, siblings ordered by the shared engine's active sort term (an empty
    // `state.sort` — "Default order" — leaves the API's own alphabetical-per-level order intact).
    const ordered: typeof items = [];
    const visit = (parentId: string | null): void => {
      const siblings = sortRows(childrenByParent.get(parentId) ?? [], state.sort, catalog);
      for (const item of siblings) {
        ordered.push(item);
        visit(item.id);
      }
    };
    visit(null);
    // A row matches when the shared engine's active filters (AND-composed) accept it; a matching
    // descendant keeps its whole ancestor chain visible even when an ancestor itself does not
    // match, so filtering never severs a result from its place in the tree.
    const matching = new Set(filterRows(ordered, state.filters, catalog).map((item) => item.id));
    const keep = new Set<string>();
    for (const item of ordered) {
      if (!matching.has(item.id)) continue;
      let current: (typeof items)[number] | undefined = item;
      while (current) {
        keep.add(current.id);
        current = current.parentInitiativeId ? byId.get(current.parentInitiativeId) : undefined;
      }
    }
    return ordered.filter((item) => keep.has(item.id));
  }, [data?.items, state.filters, state.sort, catalog]);
  const rosterRows = useMemo(() => decorateHierarchy(visibleItems), [visibleItems]);

  // Reparenting reads the whole context tree (not just the filtered rows) so a cycle check and the
  // "already the child of" no-op stay correct even while a filter hides part of the hierarchy.
  const isSelfOrDescendant = useMemo(() => {
    const parentById = new Map<string, string | null>(
      (data?.items ?? []).map((entry) => [entry.id, entry.parentInitiativeId]),
    );
    return selfOrDescendantPredicate(parentById);
  }, [data]);

  // Optimistically move a row to a new parent (or to the root) in the overview cache so the tree
  // re-nests the instant a drag lands, instead of waiting for the hierarchy write to round-trip.
  // Returns the pre-move snapshot so a failed write can roll the tree back.
  const writeParent = useCallback(
    (childId: string, parentId: string | null): InitiativeOverviewOut | undefined => {
      const previous = queryClient.getQueryData<InitiativeOverviewOut>(overviewKey);
      queryClient.setQueryData<InitiativeOverviewOut>(overviewKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === childId
                  ? {
                      ...item,
                      parentInitiativeId: parentId === null ? null : InitiativeId.parse(parentId),
                      // Detaching clears the edge; a move keeps its existing link, and a fresh
                      // nest leaves parentLinkId null until the refetch backfills the real id.
                      parentLinkId: parentId === null ? null : item.parentLinkId,
                    }
                  : item,
              ),
            }
          : current,
      );
      return previous;
    },
    [queryClient, overviewKey],
  );

  const createLink = useApiMutation<
    unknown,
    { parentInitiativeId: string; childInitiativeId: string },
    { previous?: InitiativeOverviewOut | undefined }
  >({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives['hierarchy-links'].$post({
            param: { orgId },
            json: {
              parentInitiativeId: InitiativeId.parse(vars.parentInitiativeId),
              childInitiativeId: InitiativeId.parse(vars.childInitiativeId),
            },
          }),
        `Could not nest that ${initiativeNoun.toLowerCase()}.`,
      ),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: overviewKey });
      return { previous: writeParent(vars.childInitiativeId, vars.parentInitiativeId) };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(overviewKey, context.previous);
    },
    invalidateKeys: [overviewKey],
  });
  const moveLink = useApiMutation<
    unknown,
    { linkId: string; parentInitiativeId: string; childInitiativeId: string },
    { previous?: InitiativeOverviewOut | undefined }
  >({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives['hierarchy-links'][':linkId'].$patch({
            param: { orgId, linkId: vars.linkId },
            json: { parentInitiativeId: InitiativeId.parse(vars.parentInitiativeId) },
          }),
        `Could not move that ${initiativeNoun.toLowerCase()}.`,
      ),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: overviewKey });
      return { previous: writeParent(vars.childInitiativeId, vars.parentInitiativeId) };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(overviewKey, context.previous);
    },
    invalidateKeys: [overviewKey],
  });
  const detachLink = useApiMutation<
    unknown,
    { linkId: string; childInitiativeId: string },
    { previous?: InitiativeOverviewOut | undefined }
  >({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives['hierarchy-links'][':linkId'].$delete({
            param: { orgId, linkId: vars.linkId },
          }),
        `Could not move that ${initiativeNoun.toLowerCase()} to the top level.`,
      ),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: overviewKey });
      return { previous: writeParent(vars.childInitiativeId, null) };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(overviewKey, context.previous);
    },
    invalidateKeys: [overviewKey],
  });
  const reparentError =
    (createLink.error ?? moveLink.error ?? detachLink.error)
      ? userErrorMessage(
          createLink.error ?? moveLink.error ?? detachLink.error,
          'Could not move that initiative.',
        )
      : null;

  const handleReparent = useCallback(
    (dragged: InitiativeDragObject, targetId: string | null): void => {
      const plan = resolveInitiativeHierarchyMutation({
        dragged,
        targetId,
        isSelfOrDescendant,
      });
      if (plan.kind === 'create') {
        createLink.mutate({
          parentInitiativeId: plan.parentInitiativeId,
          childInitiativeId: plan.childInitiativeId,
        });
      } else if (plan.kind === 'move') {
        moveLink.mutate({
          linkId: plan.linkId,
          parentInitiativeId: plan.parentInitiativeId,
          childInitiativeId: plan.childInitiativeId,
        });
      } else if (plan.kind === 'detach') {
        detachLink.mutate({ linkId: plan.linkId, childInitiativeId: plan.childInitiativeId });
      }
    },
    [createLink, moveLink, detachLink, isSelfOrDescendant],
  );

  const openInitiativeComposer = (): void => {
    openCreate({
      kind: 'initiative',
      initialWorkspaceId: orgId,
      sameWorkspaceCompletion: 'open',
    });
  };

  return (
    <ListPageLayout
      title={initiativePlural}
      subtitle="Strategic direction, health, and ownership at a glance."
      actions={
        <Button className="min-h-10 gap-1.5" onClick={openInitiativeComposer}>
          <Plus aria-hidden className="size-4" /> New {initiativeNoun.toLowerCase()}
        </Button>
      }
    >
      {!overview.isPending && !overview.isError ? (
        <section
          className="bg-surface-container-low mb-2 flex flex-col rounded-xl p-4"
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
        // The same Filter + Display bar every entity roster renders (see filter-toolbar.tsx).
        // Grouping is deliberately absent here: this roster is a tree, and flattening it into
        // grouped buckets would discard the hierarchy — see initiative-catalog.ts.
        <FilterToolbar
          catalog={catalog}
          state={state}
          onFiltersChange={setFilters}
          onGroupByChange={setGroupBy}
          onSortChange={setSort}
        />
      ) : null}

      {/* placeholder: the initiative rows — how many the workspace has and each one's name,
          status, lead, target date and rolled-up progress. Only the rows are covered: the page
          heading, the "New initiative" action and the sort control above render immediately from
          static copy. */}
      {overview.isPending ? (
        // The same recessed container the loaded roster sits in. Without it the rows appeared to
        // gain a surface around them the moment they arrived, which is a layout change dressed up
        // as a load.
        <div className="bg-surface-container-low relative rounded-xl p-2">
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        </div>
      ) : overview.isError ? (
        <p role="alert" className="text-error text-sm">
          {userErrorMessage(overview.error, 'Could not load initiatives.')}
        </p>
      ) : data && data.items.length > 0 ? (
        <div className="bg-surface-container-low relative rounded-xl p-2">
          <div className="overflow-x-auto overscroll-x-contain pb-1">
            <div
              role="treegrid"
              aria-label={`${initiativePlural} hierarchy`}
              aria-rowcount={rosterRows.length}
              className="min-w-[76rem] text-sm"
            >
              <div
                role="row"
                className="text-on-surface-variant grid h-8 grid-cols-[minmax(24rem,1fr)_8rem_8rem_12rem_11rem_9rem] items-center text-xs"
              >
                <div role="columnheader" className={`${ROSTER_HEADER_CELL_CLASS} pl-16`}>
                  {initiativeNoun}
                </div>
                <div role="columnheader" className={ROSTER_HEADER_CELL_CLASS}>
                  Status
                </div>
                <div role="columnheader" className={ROSTER_HEADER_CELL_CLASS}>
                  Health
                </div>
                <div role="columnheader" className={ROSTER_HEADER_CELL_CLASS}>
                  Owner
                </div>
                <div role="columnheader" className={ROSTER_HEADER_CELL_CLASS}>
                  Target
                </div>
                <div role="columnheader" className={ROSTER_HEADER_CELL_CLASS}>
                  Last update
                </div>
              </div>
              {draggingId !== null ? (
                <div
                  className={`text-on-surface-variant mb-1 flex h-9 items-center justify-center rounded-lg border border-dashed text-xs transition-colors ${dropTargetId === '__root__' ? 'border-primary text-primary bg-surface-container-high' : 'border-outline-variant'}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    if (dropTargetId !== '__root__') setDropTargetId('__root__');
                  }}
                  onDragLeave={() => {
                    setDropTargetId((current) => (current === '__root__' ? null : current));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const object = readObjectPayload(event.dataTransfer);
                    const dragged =
                      object?.kind === 'initiative' ? initiativeDragObjectFromRef(object) : null;
                    setDraggingId(null);
                    setDropTargetId(null);
                    if (dragged) handleReparent(dragged, null);
                  }}
                >
                  Drop here to move to the top level
                </div>
              ) : null}
              {rosterRows.map(
                ({ item, continuationDepths, hasVisibleChildren, isLastSibling }, rowIndex) => {
                  const targetDate = formatInitiativeTarget(item);
                  const lastUpdate = formatDate(item.lastUpdateAt);
                  const hasSummary = Boolean(item.summary?.trim());
                  const itemLeft = ROSTER_CELL_INSET + (item.depth - 1) * ROSTER_INDENT_STEP;
                  // Only workspace-owned rows can be dragged or nested under here; cross-workspace
                  // references are read-only in this context. A row is a valid drop target while a
                  // different, non-descendant initiative is being dragged.
                  const canReparent = item.organizationId === orgId;
                  const isValidDropTarget =
                    canReparent &&
                    draggingId !== null &&
                    draggingId !== item.id &&
                    !isSelfOrDescendant(draggingId, item.id);
                  const object = {
                    kind: 'initiative' as const,
                    id: item.id,
                    organizationId: item.organizationId,
                    title: item.name,
                    meta: {
                      parentInitiativeId: item.parentInitiativeId,
                      parentLinkId: item.parentLinkId,
                    },
                  };
                  return (
                    <ObjectSurface
                      key={item.id}
                      object={object}
                      dragDisabled={!canReparent}
                      surfaceId="initiatives-hierarchy"
                      onDragStart={() => {
                        dragOccurredRef.current = true;
                        setDraggingId(item.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDropTargetId(null);
                        window.setTimeout(() => {
                          dragOccurredRef.current = false;
                        }, 0);
                      }}
                    >
                      <div
                        role="row"
                        aria-level={item.depth}
                        aria-rowindex={rowIndex + 1}
                        className={`grid h-14 grid-cols-[minmax(24rem,1fr)_8rem_8rem_12rem_11rem_9rem] rounded-lg transition-colors ${draggingId === item.id ? 'opacity-50' : 'hover:bg-surface-container-high'} ${dropTargetId === item.id ? 'ring-primary bg-surface-container-high ring-2 ring-inset' : ''}`}
                        onMouseEnter={() => {
                          prefetch(initiativeDetailDef(item.organizationId, item.id));
                        }}
                        onClick={(event) => {
                          if (dragOccurredRef.current) return;
                          if ((event.target as HTMLElement).closest('a, button')) return;
                          router.push(`/orgs/${item.organizationId}/initiatives/${item.id}`);
                        }}
                        onDragOver={(event) => {
                          if (!isValidDropTarget) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          if (dropTargetId !== item.id) setDropTargetId(item.id);
                        }}
                        onDragLeave={() => {
                          setDropTargetId((current) => (current === item.id ? null : current));
                        }}
                        onDrop={(event) => {
                          if (!isValidDropTarget) return;
                          event.preventDefault();
                          const dropped = readObjectPayload(event.dataTransfer);
                          const dragged =
                            dropped?.kind === 'initiative'
                              ? initiativeDragObjectFromRef(dropped)
                              : null;
                          setDraggingId(null);
                          setDropTargetId(null);
                          if (dragged) handleReparent(dragged, item.id);
                        }}
                      >
                        <div
                          role="gridcell"
                          className="relative h-full min-w-0 overflow-hidden pr-4"
                        >
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
                            <EntityIconPicker
                              display={item.display}
                              entityName={item.name}
                              editable={item.organizationId === orgId}
                              pending={displayMutation.isPending}
                              onChange={(iconKey, colorKey, customColor) => {
                                displayMutation.mutate({
                                  initiativeId: item.id,
                                  iconKey,
                                  colorKey,
                                  customColor,
                                });
                              }}
                            />
                            <div className="ml-3 min-w-0 pt-0.5">
                              <div className="flex min-w-0 items-center">
                                {canReparent && canContribute ? (
                                  <EditableTitle
                                    value={item.name}
                                    onSave={(name) => {
                                      renameInitiative.mutate({ id: item.id, name });
                                    }}
                                    canEdit
                                    activate="doubleClick"
                                    onActivate={() => {
                                      router.push(
                                        `/orgs/${item.organizationId}/initiatives/${item.id}`,
                                      );
                                    }}
                                    ariaLabel="Initiative name"
                                    className="text-on-surface line-clamp-1 min-w-0 text-sm leading-5 font-semibold"
                                  />
                                ) : (
                                  <Link
                                    href={`/orgs/${item.organizationId}/initiatives/${item.id}`}
                                    title={item.name}
                                    // The row owns dragging; keep the anchor from starting a link-drag.
                                    draggable={false}
                                    className="text-on-surface line-clamp-1 min-w-0 text-sm leading-5 font-semibold hover:underline"
                                  >
                                    {item.name}
                                  </Link>
                                )}
                                {item.organizationId !== orgId ? (
                                  <Badge className="ml-2 shrink-0" variant="outline">
                                    {item.organizationName}
                                  </Badge>
                                ) : null}
                              </div>
                              {item.summary ? (
                                <p className="text-on-surface-variant mt-0.5 line-clamp-1 max-w-[44ch] text-xs leading-4">
                                  {item.summary}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div
                          role="gridcell"
                          className={`${ROSTER_DATA_CELL_CLASS} gap-2 whitespace-nowrap`}
                        >
                          <WorkStatusIcon
                            name={statusOf(item.status).name}
                            category={statusOf(item.status).category}
                          />
                          {statusOf(item.status).name}
                        </div>
                        <div
                          role="gridcell"
                          className={`${ROSTER_DATA_CELL_CLASS} whitespace-nowrap`}
                        >
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
                        <div role="gridcell" className={ROSTER_DATA_CELL_CLASS}>
                          {item.ownerName ? (
                            <span className="truncate">{item.ownerName}</span>
                          ) : (
                            <span className="text-on-surface-variant">—</span>
                          )}
                        </div>
                        <div
                          role="gridcell"
                          className={`${ROSTER_DATA_CELL_CLASS} whitespace-nowrap tabular-nums`}
                        >
                          {targetDate ?? <span className="text-on-surface-variant">—</span>}
                        </div>
                        <div
                          role="gridcell"
                          className={`${ROSTER_DATA_CELL_CLASS} whitespace-nowrap tabular-nums`}
                        >
                          {lastUpdate ?? <span className="text-on-surface-variant">Never</span>}
                        </div>
                      </div>
                    </ObjectSurface>
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
            onClick: openInitiativeComposer,
          }}
        />
      )}
      {displayMutation.error ? (
        <p role="alert" className="text-error text-sm">
          {userErrorMessage(displayMutation.error, 'Could not customize this initiative.')}
        </p>
      ) : null}
      {reparentError ? (
        <p role="alert" className="text-error text-sm">
          {reparentError}
        </p>
      ) : null}
    </ListPageLayout>
  );
}
