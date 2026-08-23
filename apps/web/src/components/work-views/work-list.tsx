'use client';

import { ListCell, ListRow, ListView } from '@docket/ui/components';
import { Button, Checkbox } from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import { type DragEvent, type JSX, type KeyboardEvent, useMemo, useRef, useState } from 'react';

import {
  type InitiativeDragObject,
  readInitiativeDragObject,
  writeInitiativeDragObject,
} from '@/components/initiatives/hierarchy-dnd';

import type { WorkViewDefinitionFor } from './view-state';
import { workViewDisplayFieldCatalog } from './view-state';
import {
  formatWorkViewValue,
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

const INITIATIVE_DEPTH_CLASS = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16'] as const;

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

function initiativeDepth<TTarget extends ViewTarget>(
  membership: ListMembership<TTarget>,
  rows: ReadonlyMap<string, WorkViewRowFor<TTarget>>,
): number {
  if (membership.row.target !== 'initiative') return 0;
  let parent = membership.row.parent;
  let depth = 0;
  const visited = new Set<string>();
  while (parent && depth < 4 && !visited.has(parent)) {
    visited.add(parent);
    depth += 1;
    const ancestor = rows.get(parent);
    parent = ancestor?.target === 'initiative' ? ancestor.parent : null;
  }
  return depth;
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
  const groupField = definition.arrangement.groupBy as string | null;
  const subGroupField = definition.arrangement.subGroupBy as string | null;
  const grouped = groupField !== null;
  const memberships = useMemo<readonly ListMembership<TTarget>[]>(() => {
    if (!grouped) return rows.map((row) => ({ row, path: [] }));
    return groupPages.flatMap((page) => page.rows.map((row) => ({ row, path: page.path })));
  }, [groupPages, grouped, rows]);
  const rowById = useMemo(
    () => new Map(memberships.map((membership) => [membership.row.id, membership.row])),
    [memberships],
  );
  const properties = workViewDisplayFieldCatalog(target).filter((field) =>
    definition.presentation.properties.includes(field.key),
  );

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
    <div ref={rootRef} className="relative h-full min-h-0" onKeyDownCapture={handleKeys}>
      {draggingInitiative ? (
        <div
          role="button"
          tabIndex={0}
          className="border-primary bg-primary-container text-on-primary-container text-label-large absolute inset-x-3 top-3 z-10 flex min-h-10 items-center justify-center rounded-lg border"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            dropInitiative(event, null);
          }}
        >
          Drop here to move to the top level
        </div>
      ) : null}
      <ListView<ListMembership<TTarget>>
        items={memberships}
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
        label={`${target.charAt(0).toUpperCase()}${target.slice(1)}s`}
        collapsed={collapsedGroups}
        onToggle={onToggleGroup}
        onActivateItem={(membership) => {
          onActivate(membership.row);
        }}
        renderRow={(membership, context) => {
          const row = membership.row;
          const depth = initiativeDepth(membership, rowById);
          return (
            <ListRow
              active={context.active}
              selected={selectedIds.has(row.id)}
              onActivate={context.onActivate}
              data-row-id={row.id}
              data-context-row={row.isContext ? 'true' : undefined}
              className={row.isContext ? 'text-on-surface-variant' : undefined}
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
              <ListCell className="shrink-0">
                <Checkbox
                  aria-label={`Select ${workViewRowTitle(row)}`}
                  checked={selectedIds.has(row.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onChange={() => {
                    toggle(row.id);
                  }}
                />
              </ListCell>
              <ListCell className={`min-w-40 flex-1 ${INITIATIVE_DEPTH_CLASS[depth]}`}>
                <span className="text-on-surface text-body-medium truncate">
                  {workViewRowTitle(row)}
                </span>
              </ListCell>
              {properties.map((field) => (
                <ListCell
                  key={field.key}
                  className="text-on-surface-variant hidden max-w-40 shrink-0 @2xl:flex"
                >
                  <span className="sr-only">{field.label}: </span>
                  <span className="truncate">
                    {formatWorkViewValue(workViewRowValue(row, field.key))}
                  </span>
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
