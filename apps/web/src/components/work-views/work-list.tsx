'use client';

import { defaultEntityDisplay, type Health, type WorkViewActor } from '@docket/types';
import { ActorAvatar, IdentityGlyph, ListCell, ListRow, ListView } from '@docket/ui/components';
import { Calendar, Layers } from '@docket/ui/icons';
import { Button, Checkbox } from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import { type DragEvent, type JSX, type KeyboardEvent, useMemo, useRef, useState } from 'react';

import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { useWorkStatusResolver } from '@/components/entity-display/use-work-status';
import { WorkStatusIcon } from '@/components/entity-display/work-status';
import { formatDate } from '@/components/initiatives/format-date';
import { HEALTH_FILL_CLASS } from '@/components/initiatives/health';
import {
  type InitiativeDragObject,
  readInitiativeDragObject,
  writeInitiativeDragObject,
} from '@/components/initiatives/hierarchy-dnd';
import { PriorityGlyph } from '@/components/task-detail/PriorityGlyph';

import type { WorkViewDefinitionFor } from './view-state';
import { workViewDisplayFieldCatalog } from './view-state';
import {
  type WorkViewGroupPage,
  type WorkViewGroupSummary,
  type WorkViewRowFor,
  workViewGroupPathKey,
  workViewRowTitle,
  workViewRowValue,
} from './renderer-types';

interface ListMembership<TTarget extends ViewTarget> {
  readonly row: WorkViewRowFor<TTarget>;
  readonly path: readonly string[];
}

interface InitiativeTreePosition {
  readonly depth: number;
  readonly continuationDepths: readonly number[];
  readonly hasChildren: boolean;
  readonly isLastSibling: boolean;
}

interface RosterField {
  readonly key: string;
  readonly kind: string;
}

/** Props shared by each target's virtualized roster list. */
export interface WorkListProps<TTarget extends ViewTarget> {
  readonly target: TTarget;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly rows: readonly WorkViewRowFor<TTarget>[];
  readonly groups: readonly WorkViewGroupSummary[];
  readonly groupPages: readonly WorkViewGroupPage<TTarget>[];
  readonly selectedIds: ReadonlySet<string>;
  readonly collapsedGroups?: ReadonlySet<string>;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
  readonly onActivate: (row: WorkViewRowFor<TTarget>) => void;
  readonly onLoadMore?: ((path: readonly string[]) => void) | undefined;
  readonly hasMoreRows?: boolean;
  readonly loadingMoreRows?: boolean;
  readonly onLoadMoreRows?: (() => void) | undefined;
  readonly onToggleGroup?: ((key: string) => void) | undefined;
  readonly onInitiativeReparent?:
    | ((dragged: InitiativeDragObject, targetId: string | null) => void)
    | undefined;
}

const TARGET_LABEL = {
  task: 'Task',
  project: 'Project',
  program: 'Program',
  initiative: 'Initiative',
} as const;

const HEALTH_LABEL: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

const HEALTH_TEXT_CLASS: Record<Health, string> = {
  on_track: 'text-state-completed',
  at_risk: 'text-state-canceled',
  off_track: 'text-error',
};

const FIELD_WIDTH: Record<string, string> = {
  status: 'w-32',
  priority: 'w-20',
  health: 'w-32',
  assignee: 'w-44',
  lead: 'w-44',
  owner: 'w-44',
  startDate: 'w-28',
  dueDate: 'w-28',
  targetDate: 'w-28',
  latestUpdate: 'w-28',
  progress: 'w-28',
  estimate: 'w-24',
  estimateMinutes: 'w-24',
  taskCount: 'w-24',
  projectCount: 'w-24',
  activeProjectCount: 'w-28',
  dependencyCount: 'w-28',
};

function groupLabel(groups: readonly WorkViewGroupSummary[], path: readonly string[]): string {
  return (
    groups.find(
      (group) =>
        group.path.length === path.length &&
        group.path.every((part, index) => part === path[index]),
    )?.label ??
    path.at(-1) ??
    'No value'
  );
}

function orderInitiativeMemberships<TTarget extends ViewTarget>(
  memberships: readonly ListMembership<TTarget>[],
): readonly ListMembership<TTarget>[] {
  if (!memberships.some(({ row }) => row.target === 'initiative')) return memberships;
  const byId = new Map(memberships.map((membership) => [membership.row.id, membership]));
  const children = new Map<string | null, ListMembership<TTarget>[]>();
  for (const membership of memberships) {
    const parent =
      membership.row.target === 'initiative' &&
      membership.row.parent !== null &&
      byId.has(membership.row.parent)
        ? membership.row.parent
        : null;
    children.set(parent, [...(children.get(parent) ?? []), membership]);
  }
  const ordered: ListMembership<TTarget>[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null): void => {
    for (const membership of children.get(parent) ?? []) {
      if (seen.has(membership.row.id)) continue;
      seen.add(membership.row.id);
      ordered.push(membership);
      visit(membership.row.id);
    }
  };
  visit(null);
  for (const membership of memberships) {
    if (!seen.has(membership.row.id)) ordered.push(membership);
  }
  return ordered;
}

function initiativePositions<TTarget extends ViewTarget>(
  memberships: readonly ListMembership<TTarget>[],
): ReadonlyMap<string, InitiativeTreePosition> {
  const rows = new Map(memberships.map(({ row }) => [row.id, row]));
  const children = new Map<string | null, WorkViewRowFor<TTarget>[]>();
  for (const { row } of memberships) {
    if (row.target !== 'initiative') continue;
    const parent = row.parent && rows.has(row.parent) ? row.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), row]);
  }
  const result = new Map<string, InitiativeTreePosition>();
  for (const { row } of memberships) {
    if (row.target !== 'initiative') continue;
    const ancestors: WorkViewRowFor<TTarget>[] = [];
    let parent = row.parent ? rows.get(row.parent) : undefined;
    const visited = new Set<string>();
    while (parent?.target === 'initiative' && !visited.has(parent.id)) {
      visited.add(parent.id);
      ancestors.unshift(parent);
      parent = parent.parent ? rows.get(parent.parent) : undefined;
    }
    const continuationDepths = ancestors.flatMap((ancestor, index) => {
      if (ancestor.target !== 'initiative') return [];
      const parentId = ancestor.parent && rows.has(ancestor.parent) ? ancestor.parent : null;
      const siblings = children.get(parentId) ?? [];
      return siblings.at(-1)?.id === ancestor.id ? [] : [index + 1];
    });
    const parentId = row.parent && rows.has(row.parent) ? row.parent : null;
    const siblings = children.get(parentId) ?? [];
    result.set(row.id, {
      depth: ancestors.length + 1,
      continuationDepths,
      hasChildren: (children.get(row.id)?.length ?? 0) > 0,
      isLastSibling: siblings.at(-1)?.id === row.id,
    });
  }
  return result;
}

function HierarchyRails({
  position,
  hasSummary,
}: {
  position: InitiativeTreePosition;
  hasSummary: boolean;
}): JSX.Element | null {
  const { depth, continuationDepths, hasChildren, isLastSibling } = position;
  if (depth === 1 && !hasChildren && continuationDepths.length === 0) return null;
  const iconTop = hasSummary ? 8 : 16;
  const targetLeft = 12 + (depth - 1) * 44;
  const iconCenter = targetLeft + 16;
  const branchY = iconTop + 16;
  const parentRailX = iconCenter - 44;
  return (
    <svg
      aria-hidden
      data-testid="initiative-hierarchy-rail"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      height="56"
      width="100%"
    >
      <g
        className="stroke-outline-variant"
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {continuationDepths.map((railDepth) => {
          const railX = 12 + (railDepth - 1) * 44 + 16;
          return <line key={railDepth} x1={railX} y1="0" x2={railX} y2="56" />;
        })}
        {depth > 1 ? (
          <>
            <line x1={parentRailX} y1="0" x2={parentRailX} y2={isLastSibling ? branchY - 7 : 56} />
            <path
              d={`M ${String(parentRailX)} ${String(branchY - 7)} Q ${String(parentRailX)} ${String(branchY)} ${String(parentRailX + 7)} ${String(branchY)} H ${String(targetLeft)}`}
            />
          </>
        ) : null}
        {hasChildren ? <line x1={iconCenter} y1={iconTop + 32} x2={iconCenter} y2="56" /> : null}
      </g>
    </svg>
  );
}

function rowSummary(row: WorkViewRowFor<ViewTarget>): string | null {
  switch (row.target) {
    case 'task':
      return row.description;
    case 'project':
    case 'program':
    case 'initiative':
      return row.summary;
  }
}

function rowActor(row: WorkViewRowFor<ViewTarget>, field: string): WorkViewActor | null {
  if (row.target === 'task' && field === 'assignee') return row.assigneeActor;
  if (row.target === 'project' && field === 'lead') return row.leadActor;
  if (row.target === 'program' && field === 'owner') return row.ownerActor;
  if (row.target === 'initiative' && field === 'owner') return row.ownerActor;
  return null;
}

function Identity({
  row,
  statusOf,
}: {
  row: WorkViewRowFor<ViewTarget>;
  statusOf: ReturnType<typeof useWorkStatusResolver>;
}): JSX.Element {
  if (row.target === 'project' || row.target === 'initiative') {
    const display = row.display ?? defaultEntityDisplay(row.target, row.id);
    return (
      <EntityIconGlyph
        iconKey={display.iconKey}
        colorKey={display.colorKey}
        customColor={display.customColor}
        size={32}
      />
    );
  }
  if (row.target === 'program') {
    return (
      <IdentityGlyph size={32}>
        <Layers className="size-4" />
      </IdentityGlyph>
    );
  }
  const status = statusOf(row.status);
  return (
    <IdentityGlyph size={32}>
      <WorkStatusIcon name={status.name} category={status.category} />
    </IdentityGlyph>
  );
}

function SelectionIdentity({
  row,
  selected,
  selectionActive,
  statusOf,
  onToggle,
}: {
  row: WorkViewRowFor<ViewTarget>;
  selected: boolean;
  selectionActive: boolean;
  statusOf: ReturnType<typeof useWorkStatusResolver>;
  onToggle: () => void;
}): JSX.Element {
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center">
      <span
        className={`absolute inset-0 flex items-center justify-center transition-opacity ${
          selected || selectionActive
            ? 'opacity-100'
            : 'opacity-0 group-focus-within/roster:opacity-100 group-hover/roster:opacity-100'
        }`}
      >
        <Checkbox
          aria-label={`Select ${workViewRowTitle(row)}`}
          checked={selected}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onChange={onToggle}
        />
      </span>
      <span
        aria-hidden={selected || selectionActive}
        className={`transition-opacity ${selected || selectionActive ? 'opacity-0' : 'opacity-100 group-focus-within/roster:opacity-0 group-hover/roster:opacity-0'}`}
      >
        <Identity row={row} statusOf={statusOf} />
      </span>
    </span>
  );
}

function PropertyValue({
  row,
  field,
  statusOf,
}: {
  row: WorkViewRowFor<ViewTarget>;
  field: RosterField;
  statusOf: ReturnType<typeof useWorkStatusResolver>;
}): JSX.Element {
  const value = workViewRowValue(row, field.key);
  const actor = rowActor(row, field.key);
  if (field.key === 'status' && typeof value === 'string') {
    const status = statusOf(value);
    return (
      <span className="flex min-w-0 items-center gap-2">
        <WorkStatusIcon name={status.name} category={status.category} />
        <span className="truncate">{status.name}</span>
      </span>
    );
  }
  if (field.key === 'priority' && typeof value === 'string') {
    return <PriorityGlyph priority={value as 'urgent' | 'high' | 'medium' | 'low' | 'none'} />;
  }
  if (field.key === 'health' && (value === null || typeof value === 'string')) {
    if (value === null) return <span>—</span>;
    const health = value as Health;
    return (
      <span className={`${HEALTH_TEXT_CLASS[health]} text-label-medium flex items-center gap-2`}>
        <span className={`${HEALTH_FILL_CLASS[health]} size-1.5 rounded-full`} />
        {HEALTH_LABEL[health]}
      </span>
    );
  }
  if (actor) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <ActorAvatar
          kind={actor.kind}
          name={actor.displayName}
          avatarUrl={actor.avatar}
          size={20}
        />
        <span className="truncate">{actor.displayName}</span>
      </span>
    );
  }
  if (field.kind === 'date' || field.key === 'latestUpdate') {
    const formatted = typeof value === 'string' ? formatDate(value) : null;
    return formatted ? (
      <span className="flex items-center gap-2 whitespace-nowrap tabular-nums">
        <Calendar className="size-3.5" />
        {formatted}
      </span>
    ) : (
      <span>—</span>
    );
  }
  if (field.key === 'progress' && typeof value === 'number') {
    const percent = Math.round(value * 100);
    return (
      <span className="flex w-full items-center gap-2 tabular-nums">
        <span className="bg-surface-container-highest h-1.5 min-w-10 flex-1 overflow-hidden rounded-full">
          <span
            className="bg-primary block h-full rounded-full"
            style={{ width: `${String(percent)}%` }}
          />
        </span>
        {percent}%
      </span>
    );
  }
  if (Array.isArray(value)) return <span className="tabular-nums">{value.length || '—'}</span>;
  if (typeof value === 'number') return <span className="tabular-nums">{value}</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : '—'}</span>;
  if (field.kind === 'relation-one' || field.kind === 'relation-many') return <span>—</span>;
  if (typeof value === 'string' && value.length < 40)
    return <span>{value.replaceAll('_', ' ')}</span>;
  return <span>—</span>;
}

/** Render one target-discriminated server roster through the shared virtual list. */
export function WorkList<TTarget extends ViewTarget>({
  target,
  definition,
  rows,
  groups,
  groupPages,
  selectedIds,
  collapsedGroups,
  onSelectionChange,
  onActivate,
  onLoadMore,
  hasMoreRows = false,
  loadingMoreRows = false,
  onLoadMoreRows,
  onToggleGroup,
  onInitiativeReparent,
}: WorkListProps<TTarget>): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [draggingInitiative, setDraggingInitiative] = useState(false);
  const statusOf = useWorkStatusResolver(target);
  const groupField = definition.arrangement.groupBy as string | null;
  const subGroupField = definition.arrangement.subGroupBy as string | null;
  const grouped = groupField !== null;
  const memberships = useMemo<readonly ListMembership<TTarget>[]>(() => {
    const source = grouped
      ? groupPages.flatMap((page) =>
          orderInitiativeMemberships(page.rows.map((row) => ({ row, path: page.path }))),
        )
      : rows.map((row) => ({ row, path: [] }));
    return grouped ? source : orderInitiativeMemberships(source);
  }, [groupPages, grouped, rows]);
  const treePositions = useMemo(() => initiativePositions(memberships), [memberships]);
  const properties = workViewDisplayFieldCatalog(target).filter((field) =>
    definition.presentation.properties.includes(field.key),
  );
  const selectionActive = selectedIds.size > 0;

  const toggle = (id: string): void => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() !== 'x') return;
    event.preventDefault();
    if (event.shiftKey) {
      onSelectionChange(new Set(memberships.map((membership) => membership.row.id)));
      return;
    }
    const active = rootRef.current?.querySelector<HTMLElement>('[data-active][data-row-id]');
    const id = active?.dataset['rowId'];
    if (id) toggle(id);
  };
  const dropInitiative = (event: DragEvent<HTMLElement>, targetId: string | null): void => {
    if (!onInitiativeReparent) return;
    event.preventDefault();
    const dragged = readInitiativeDragObject(event.dataTransfer);
    setDraggingInitiative(false);
    if (dragged) onInitiativeReparent(dragged, targetId);
  };

  return (
    <div
      ref={rootRef}
      className="bg-surface-container-low @container/table relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl p-2"
      onKeyDownCapture={handleKeys}
    >
      <div
        role="row"
        className="text-on-surface-variant text-label-small flex h-8 shrink-0 items-center gap-2 px-3"
      >
        <span role="columnheader" className="min-w-72 flex-1 pl-10">
          {TARGET_LABEL[target]}
        </span>
        {properties.map((field) => (
          <span
            role="columnheader"
            key={field.key}
            className={`hidden shrink-0 items-center px-2 @2xl:flex ${FIELD_WIDTH[field.key] ?? 'w-32'}`}
          >
            {field.label}
          </span>
        ))}
      </div>
      {draggingInitiative ? (
        <div
          role="button"
          tabIndex={0}
          className="border-primary bg-primary-container text-on-primary-container text-label-large absolute inset-x-3 top-10 z-10 flex min-h-10 items-center justify-center rounded-lg border"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            dropInitiative(event, null);
          }}
        >
          Move to top level
        </div>
      ) : null}
      <ListView<ListMembership<TTarget>>
        items={memberships}
        rowHeight={56}
        className="min-h-0 flex-1"
        groupBy={
          grouped
            ? (membership) => ({
                id: membership.path[0] ?? '__empty__',
                label: groupLabel(groups, membership.path.slice(0, 1)),
              })
            : null
        }
        subGroupBy={
          subGroupField === null
            ? undefined
            : (membership) => ({
                id: membership.path[1] ?? '__empty__',
                label: groupLabel(groups, membership.path.slice(0, 2)),
              })
        }
        getItemKey={(membership) => `${workViewGroupPathKey(membership.path)}:${membership.row.id}`}
        label={`${TARGET_LABEL[target]}s`}
        collapsed={collapsedGroups}
        onToggle={onToggleGroup}
        onActivateItem={(membership) => {
          onActivate(membership.row);
        }}
        renderRow={(membership, context) => {
          const row = membership.row;
          const selected = selectedIds.has(row.id);
          const summary = rowSummary(row);
          const position = row.target === 'initiative' ? treePositions.get(row.id) : undefined;
          return (
            <ListRow
              {...context.rowProps}
              active={context.active}
              selected={selected}
              onActivate={context.onActivate}
              data-row-id={row.id}
              data-context-row={row.isContext ? 'true' : undefined}
              aria-level={position?.depth}
              className={`group/roster relative min-h-14 gap-2 rounded-lg border-b-0 px-3 py-0 ${row.isContext ? 'text-on-surface-variant' : ''}`}
              draggable={row.target === 'initiative' && onInitiativeReparent !== undefined}
              onDragStart={(event) => {
                if (row.target !== 'initiative' || !onInitiativeReparent) return;
                writeInitiativeDragObject(event.dataTransfer, {
                  id: row.id,
                  parentInitiativeId: row.parent,
                  parentLinkId: row.parentLinkId,
                });
                setDraggingInitiative(true);
              }}
              onDragEnd={() => {
                setDraggingInitiative(false);
              }}
              onDragOver={(event) => {
                if (row.target !== 'initiative' || !onInitiativeReparent) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                if (row.target !== 'initiative') return;
                dropInitiative(event, row.id);
              }}
            >
              {position ? (
                <HierarchyRails position={position} hasSummary={Boolean(summary)} />
              ) : null}
              <ListCell className="relative min-w-72 flex-1 gap-3">
                <span
                  className="relative flex min-w-0 items-center gap-3"
                  style={
                    position ? { paddingLeft: `${String((position.depth - 1) * 44)}px` } : undefined
                  }
                >
                  <SelectionIdentity
                    row={row}
                    selected={selected}
                    selectionActive={selectionActive}
                    statusOf={statusOf}
                    onToggle={() => {
                      toggle(row.id);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="text-on-surface text-body-medium block truncate">
                      {workViewRowTitle(row)}
                    </span>
                    {summary ? (
                      <span className="text-on-surface-variant text-body-small block max-w-[52ch] truncate">
                        {summary}
                      </span>
                    ) : null}
                  </span>
                </span>
              </ListCell>
              {properties.map((field) => (
                <ListCell
                  key={field.key}
                  className={`text-on-surface-variant text-body-small hidden shrink-0 px-2 @2xl:flex ${FIELD_WIDTH[field.key] ?? 'w-32'}`}
                >
                  <span className="sr-only">{field.label}: </span>
                  <PropertyValue
                    row={row as WorkViewRowFor<ViewTarget>}
                    field={field}
                    statusOf={statusOf}
                  />
                </ListCell>
              ))}
            </ListRow>
          );
        }}
      />
      {onLoadMore
        ? groupPages
            .filter((page) => page.nextCursor !== null && !page.loading)
            .map((page) => (
              <button
                key={workViewGroupPathKey(page.path)}
                type="button"
                className="sr-only"
                onClick={() => {
                  onLoadMore(page.path);
                }}
              >
                Load more {groupLabel(groups, page.path)}
              </button>
            ))
        : null}
      {hasMoreRows && onLoadMoreRows ? (
        <Button
          type="button"
          variant="secondary"
          controlSize="sm"
          className="absolute bottom-3 left-1/2 -translate-x-1/2"
          disabled={loadingMoreRows}
          onClick={onLoadMoreRows}
        >
          {loadingMoreRows ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
