'use client';

import { entityNavigationSnapshotFromWorkViewRow } from '../../lib/contracts/entity-navigation';
import { EntityTable, type EntityTableProps } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import type { ViewTarget } from '@docket/work/view-contract';
import { type JSX, type MouseEvent, type ReactNode, useCallback, useMemo, useRef } from 'react';

import { useDragState } from '@/components/dnd/drag-context';
import { useDraggable } from '@/components/dnd/use-draggable';
import { useRelationDropTarget } from '@/components/dnd/use-relation-drop-target';
import { useWorkStatusResolver } from '@/components/entity-display/use-work-status';
import { useEntityTableSelection, useSelection } from '@/components/selection';
import type { ObjectRef } from '@/lib/actions';
import { objectKey, objectTargetProps } from '@/lib/actions/object';
import { buildEntityHref } from '@/lib/authenticated-route';

import {
  buildWorkListColumns,
  WORK_ROSTER_INLINE_LINK_COLUMN_KEY,
  WORK_ROSTER_ROW_HEIGHT,
} from './work-list-columns';
import {
  buildWorkListRootContinuation,
  buildWorkListRoster,
  type ListMembership,
  workListMembershipKey,
} from './work-list-groups';
import { deriveInitiativeTreePositions, type InitiativeTreePosition } from './initiative-rails';
import type { WorkViewDefinitionFor } from './view-state';
import type { WorkViewGroupPage, WorkViewGroupSummary, WorkViewRowFor } from './renderer-types';
import {
  objectForWorkViewRow,
  workViewSelectionObject,
  workViewRowInteractionPolicy,
  type WorkViewRowInteractionPolicy,
} from './work-view-object';

type WorkListRowInteractionContract<TTarget extends ViewTarget> = Parameters<
  Parameters<
    NonNullable<EntityTableProps<ListMembership<TTarget>>['renderRowInteraction']>
  >[0]['children']
>[0];

/** Props shared by each target's virtualized roster table. */
export interface WorkListProps<TTarget extends ViewTarget> {
  readonly target: TTarget;
  /** Organization whose roster owns selection and write interactions. */
  readonly organizationId: string;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly rows: readonly WorkViewRowFor<TTarget>[];
  readonly groups: readonly WorkViewGroupSummary[];
  readonly groupPages: readonly WorkViewGroupPage<TTarget>[];
  readonly canContribute: boolean;
  readonly collapsedGroups?: ReadonlySet<string>;
  readonly onActivate: (row: WorkViewRowFor<TTarget>) => void;
  readonly onLoadMore?: ((path: readonly string[]) => void) | undefined;
  readonly hasMoreRows?: boolean;
  readonly loadingMoreRows?: boolean;
  readonly rootContinuationError?: unknown;
  readonly onLoadMoreRows?: (() => void) | undefined;
  readonly onToggleGroup?: ((key: string) => void) | undefined;
}

/** Return whether the candidate sits below the ancestor in the visible Initiative tree. */
function isInitiativeDescendant(
  parentById: ReadonlyMap<string, string | null>,
  ancestorId: string,
  candidateId: string,
): boolean {
  const visited = new Set<string>();
  let current = parentById.get(candidateId) ?? null;
  while (current !== null && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}

/** Bind object identity, dragging, relation drops, and activation to one EntityTable row. */
function WorkListRowInteraction<TTarget extends ViewTarget>({
  membership,
  object,
  interaction,
  onActivate,
  children,
}: {
  readonly membership: ListMembership<TTarget>;
  readonly object: ObjectRef | null;
  readonly interaction: WorkViewRowInteractionPolicy;
  readonly onActivate: () => void;
  readonly children: (interaction: WorkListRowInteractionContract<TTarget>) => ReactNode;
}): JSX.Element {
  const suppressActivationRef = useRef(false);
  const selection = useSelection();
  const selected = object !== null && selection.isSelected(objectKey(object));
  const drag = useDraggable({
    object,
    disabled: interaction.dragDisabled,
    actionScope: interaction.actionScope,
    surfaceId: selection.surfaceId,
    objects: selected ? selection.selectedObjects : object === null ? undefined : [object],
    onDragStart: () => {
      suppressActivationRef.current = true;
    },
  });
  const drop = useRelationDropTarget({
    target: object ?? objectForWorkViewRow(membership.row),
    disabled: !interaction.writable,
  });
  const handleClick = (event: MouseEvent): void => {
    const nestedControl = (event.target as HTMLElement).closest(
      'a, button, input, textarea, select, [contenteditable="true"], [role="button"]',
    );
    if (nestedControl !== null || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (suppressActivationRef.current) {
      suppressActivationRef.current = false;
      event.preventDefault();
      return;
    }
    onActivate();
  };
  const rosterDataProps = {
    'data-row-id': membership.row.id,
    'data-context-row': membership.row.isContext ? 'true' : undefined,
    'data-drop-state': drop.dropState,
    'data-drag-state': drag['data-drag-state'],
  };
  const targetProps = object === null ? {} : objectTargetProps(object, interaction.actionScope);
  return (
    <>
      {children({
        selected,
        interactionRef: (element) => {
          drag.ref(element);
          drop.dropProps.ref(element);
        },
        rowProps: {
          ...targetProps,
          ...rosterDataProps,
          'aria-selected': selected,
          'data-selected': selected,
          onClick: handleClick,
        },
        className: cn(
          'group/roster',
          membership.row.isContext && 'text-on-surface-variant',
          drag.className,
          drop.dropProps.className,
          drop.dropState === 'accept' && 'ring-primary bg-primary/8 z-10 ring-2 ring-inset',
          drop.dropState === 'reject' && 'ring-error/60 bg-error/5 z-10 ring-1 ring-inset',
        ),
      })}
      {drop.effectLabel ? (
        <span
          className={cn(
            'text-label-small pointer-events-none absolute inset-y-1 right-3 z-20 flex items-center rounded-md px-2',
            drop.dropState === 'reject'
              ? 'bg-error-container text-on-error-container'
              : 'bg-primary-container text-on-primary-container',
          )}
          role="status"
        >
          {drop.effectLabel}
        </span>
      ) : null}
    </>
  );
}

/** Derive path-scoped rail inputs from the exact visible membership set. */
function initiativePositions<TTarget extends ViewTarget>(
  memberships: readonly ListMembership<TTarget>[],
): ReadonlyMap<string, InitiativeTreePosition> {
  const membershipKeys = new Set(memberships.map(({ key }) => key));
  return deriveInitiativeTreePositions(
    memberships.flatMap((membership) => {
      if (membership.row.target !== 'initiative') return [];
      const parentKey =
        membership.row.parent === null
          ? null
          : workListMembershipKey(membership.path, membership.row.parent);
      return [
        {
          key: membership.key,
          parentKey: parentKey !== null && membershipKeys.has(parentKey) ? parentKey : null,
        },
      ];
    }),
  );
}

/** Render one target-discriminated server roster through the shared EntityTable. */
export function WorkList<TTarget extends ViewTarget>({
  target,
  organizationId,
  definition,
  rows,
  groups,
  groupPages,
  canContribute,
  collapsedGroups,
  onActivate,
  onLoadMore,
  hasMoreRows = false,
  loadingMoreRows = false,
  rootContinuationError = null,
  onLoadMoreRows,
  onToggleGroup,
}: WorkListProps<TTarget>): JSX.Element {
  const selection = useSelection();
  const dragState = useDragState();
  const statusOf = useWorkStatusResolver(target);
  const grouped = Boolean(definition.arrangement.groupBy);
  const roster = useMemo(
    () =>
      buildWorkListRoster({
        target,
        grouped,
        rows,
        summaries: groups,
        pages: groupPages,
        onLoadMore,
      }),
    [groupPages, grouped, groups, onLoadMore, rows, target],
  );
  const rowHeight = WORK_ROSTER_ROW_HEIGHT[definition.presentation.density];
  const positions = useMemo(() => initiativePositions(roster.memberships), [roster.memberships]);
  const interactions = useMemo(
    () =>
      new Map(
        roster.memberships.map((membership) => [
          membership.key,
          workViewRowInteractionPolicy(membership.row, organizationId, canContribute),
        ]),
      ),
    [canContribute, organizationId, roster.memberships],
  );
  const selectedIds = useMemo(
    () => new Set(selection.selectedObjects.map(({ id }) => id)),
    [selection.selectedObjects],
  );
  const selectionActive = selection.count > 0;
  const initiativeParentById = useMemo(
    () =>
      new Map(
        roster.memberships.flatMap(({ row }) =>
          row.target === 'initiative' ? [[row.id, row.parent] as const] : [],
        ),
      ),
    [roster.memberships],
  );
  const toggleSelection = useCallback(
    (id: string): void => {
      const membership = roster.memberships.find(({ row }) => row.id === id);
      if (membership === undefined) return;
      const object = workViewSelectionObject(membership.row, organizationId);
      if (object !== null) selection.dispatch({ type: 'toggle', key: objectKey(object) });
    },
    [organizationId, roster.memberships, selection],
  );
  const columns = useMemo(
    () =>
      buildWorkListColumns({
        target,
        definition,
        selectedIds,
        selectionActive,
        isWritable: (membership) =>
          workViewSelectionObject(membership.row, organizationId) !== null,
        onToggleSelection: toggleSelection,
        statusOf,
        positions,
        rowHeight,
      }),
    [
      definition,
      organizationId,
      positions,
      rowHeight,
      selectedIds,
      selectionActive,
      statusOf,
      target,
      toggleSelection,
    ],
  );
  const initiativeRoot = useRelationDropTarget({
    target: {
      kind: 'initiative_root',
      id: `${organizationId}:initiative-root`,
      organizationId,
      title: 'top level',
    },
    disabled: target !== 'initiative' || !canContribute,
    priority: 'root',
  });
  const continuation = buildWorkListRootContinuation(
    target,
    hasMoreRows,
    loadingMoreRows,
    rootContinuationError,
    onLoadMoreRows,
  );
  const tableSelection = useEntityTableSelection<ListMembership<TTarget>>((membership) =>
    workViewSelectionObject(membership.row, organizationId),
  );

  return (
    <div className="relative flex h-full min-h-0 flex-1">
      {initiativeRoot.effectLabel ? (
        <span className="bg-primary-container text-on-primary-container text-label-small pointer-events-none absolute top-2 right-3 z-50 rounded-full px-2 py-1">
          {initiativeRoot.effectLabel}
        </span>
      ) : null}
      <EntityTable<ListMembership<TTarget>>
        aria-label={`${target === 'task' ? 'Task' : target === 'project' ? 'Project' : target === 'program' ? 'Program' : 'Initiative'}s`}
        columns={columns}
        {...(roster.groups === undefined ? { rows: roster.rows ?? [] } : { groups: roster.groups })}
        getRowKey={({ key }) => key}
        tone="tonal"
        gridRole={target === 'initiative' ? 'treegrid' : 'grid'}
        getRowAria={
          target === 'initiative'
            ? (membership) => {
                const position = positions.get(membership.key);
                return position
                  ? {
                      level: position.depth,
                      posInSet: position.posInSet,
                      setSize: position.setSize,
                      ...(position.hasChildren ? { expanded: true } : {}),
                    }
                  : { level: 1, posInSet: 1, setSize: 1 };
              }
            : undefined
        }
        rowHeight={rowHeight}
        virtualized
        rowHref={(membership) =>
          buildEntityHref(entityNavigationSnapshotFromWorkViewRow(membership.row))
        }
        rowLinkColumnKey={WORK_ROSTER_INLINE_LINK_COLUMN_KEY}
        onRowClick={(membership) => {
          onActivate(membership.row);
        }}
        renderRowInteraction={({ row: membership, children }) => {
          const interaction =
            interactions.get(membership.key) ??
            workViewRowInteractionPolicy(membership.row, organizationId, canContribute);
          const baseObject = interaction.object;
          const wouldCreateCycle =
            membership.row.target === 'initiative' &&
            dragState.objects.some(
              (source) =>
                source.kind === 'initiative' &&
                isInitiativeDescendant(initiativeParentById, source.id, membership.row.id),
            );
          const object =
            wouldCreateCycle && baseObject !== null
              ? { ...baseObject, meta: { ...baseObject.meta, wouldCreateCycle: true } }
              : baseObject;
          return (
            <WorkListRowInteraction
              membership={membership}
              object={object}
              interaction={interaction}
              onActivate={() => {
                onActivate(membership.row);
              }}
            >
              {children}
            </WorkListRowInteraction>
          );
        }}
        {...tableSelection}
        {...(collapsedGroups !== undefined ? { collapsed: collapsedGroups } : {})}
        {...(onToggleGroup !== undefined ? { onToggleGroup } : {})}
        {...(continuation !== undefined ? { continuation } : {})}
        containerInteraction={{ ref: initiativeRoot.dropProps.ref }}
        className={cn(
          'h-full min-h-0 flex-1',
          initiativeRoot.dropProps.className,
          initiativeRoot.dropState === 'accept' && 'ring-primary bg-primary/8 ring-2 ring-inset',
          initiativeRoot.dropState === 'reject' && 'ring-error/60 bg-error/5 ring-1 ring-inset',
        )}
      />
    </div>
  );
}
