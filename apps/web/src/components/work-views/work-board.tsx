'use client';

import { Ellipsis, Plus } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { entityNavigationSnapshotFromWorkViewRow } from '../../lib/contracts/entity-navigation';
import type { ViewTarget } from '@docket/work/view-contract';
import { useDragDropMonitor, useDragOperation, useDroppable } from '@dnd-kit/react';
import { type JSX, type ReactNode, useCallback, useMemo, useRef } from 'react';

import { isObjectDragData } from '@/components/dnd/object-drag-data';
import { useRelationDropTarget } from '@/components/dnd/use-relation-drop-target';
import { ObjectSurface } from '@/components/objects/object-surface';
import { useSelection } from '@/components/selection';

import DocketLink from '@/components/docket-link';
import { buildEntityHref } from '@/lib/authenticated-route';
import { objectKey } from '@/lib/actions/object';

import type { WorkViewDefinitionFor } from './view-state';
import { workViewDisplayFieldCatalog, workViewFieldCatalog } from './view-state';
import {
  formatWorkViewValue,
  type WorkViewGroupPage,
  type WorkViewGroupSummary,
  type WorkViewRowFor,
  workViewGroupPathKey,
  workViewRowDisplayValue,
  workViewRowTitle,
} from './renderer-types';
import { objectForWorkViewRow, type WorkViewRowInteractionPolicy } from './work-view-object';

import { CARD_CHECKBOX_REVEAL_CLASS } from './card-styles';

const MAX_MOUNTED_CARDS_PER_CELL = 100;

/** Property-changing move emitted by a mutable board group. */
export interface WorkBoardDrop<TTarget extends ViewTarget> {
  readonly item: WorkViewRowFor<TTarget>;
  readonly sourcePath: readonly string[];
  readonly destinationPath: readonly string[];
  readonly beforeId: string | null;
  readonly afterId: string | null;
}

/** Props for the shared target-safe board renderer. */
export interface WorkBoardProps<TTarget extends ViewTarget> {
  readonly target: TTarget;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  /** Server-owned total for the root result set, which excludes context rows by contract. */
  readonly totalCount: number;
  readonly rows?: readonly WorkViewRowFor<TTarget>[];
  readonly groups: readonly WorkViewGroupSummary[];
  readonly groupPages: readonly WorkViewGroupPage<TTarget>[];
  readonly hiddenColumns: ReadonlySet<string>;
  readonly canContribute: boolean;
  /** Resolve route-owned write and object capabilities for each rendered row. */
  readonly rowInteraction: (row: WorkViewRowFor<TTarget>) => WorkViewRowInteractionPolicy;
  readonly onCreate: (path: readonly string[]) => void;
  readonly onActivate: (row: WorkViewRowFor<TTarget>) => void;
  readonly onDrop: (drop: WorkBoardDrop<TTarget>) => void;
  readonly onLoadMore: (path: readonly string[]) => void;
  readonly hasMoreRows?: boolean;
  readonly loadingMoreRows?: boolean;
  readonly onLoadMoreRows?: (() => void) | undefined;
  readonly onHideColumn?: ((key: string) => void) | undefined;
  readonly onShowAllColumns?: (() => void) | undefined;
}

interface BoardCellData {
  readonly kind: 'work-board-cell';
  readonly path: readonly string[];
  readonly effectLabel: string;
}

function isBoardCellData(value: unknown): value is BoardCellData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'work-board-cell'
  );
}

function boardMembershipKey(path: readonly string[], rowId: string): string {
  return `${workViewGroupPathKey(path)}:${rowId}`;
}

function legacyBoardSourcePath(surfaceId: string | null): readonly string[] | null {
  if (!surfaceId?.startsWith('work-board:')) return null;
  try {
    const value: unknown = JSON.parse(surfaceId.slice('work-board:'.length));
    return Array.isArray(value)
      ? value.filter((part): part is string => typeof part === 'string')
      : null;
  } catch {
    return null;
  }
}

function WorkBoardCell({
  path,
  label,
  mutable,
  canAcceptSource,
  children,
}: {
  readonly path: readonly string[];
  readonly label: string;
  readonly mutable: boolean;
  readonly canAcceptSource: (data: unknown) => boolean;
  readonly children: ReactNode;
}): JSX.Element {
  const operation = useDragOperation();
  const canAccept = mutable && canAcceptSource(operation.source?.data);
  const acceptsSource = useCallback(
    (source: { readonly data: unknown }): boolean => mutable && canAcceptSource(source.data),
    [canAcceptSource, mutable],
  );
  const drop = useDroppable<BoardCellData>({
    id: `work-board-cell:${workViewGroupPathKey(path)}`,
    type: 'work-board-cell',
    accept: acceptsSource,
    collisionPriority: 2,
    data: {
      kind: 'work-board-cell',
      path,
      effectLabel: `Move to ${label}`,
    },
    // The pointer source exists only after activation, so mutable cells must already be registered.
    disabled: !mutable,
  });
  const accepting = drop.isDropTarget && canAccept;
  return (
    <section
      ref={drop.ref}
      data-testid={`board-cell-${path.join('-')}`}
      data-drop-state={accepting ? 'accept' : 'idle'}
      className={cn(
        'min-h-20 rounded-lg',
        accepting && 'ring-primary bg-primary/8 ring-2 ring-inset',
      )}
    >
      {accepting ? (
        <div className="border-primary bg-primary-container text-on-primary-container text-label-medium mb-2 flex min-h-12 w-full items-center justify-center rounded-lg border border-dashed px-3">
          Move to {label}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function WorkBoardCard<TTarget extends ViewTarget>({
  row,
  sourcePath,
  selected,
  selectable,
  selectionActive,
  interaction,
  onToggle,
  onActivate,
  onDragStart,
  children,
}: {
  readonly row: WorkViewRowFor<TTarget>;
  readonly sourcePath: readonly string[];
  readonly selected: boolean;
  readonly selectable: boolean;
  readonly selectionActive: boolean;
  readonly interaction: WorkViewRowInteractionPolicy;
  readonly onToggle: () => void;
  readonly onActivate: () => void;
  readonly onDragStart: (path: readonly string[]) => void;
  readonly children: ReactNode;
}): JSX.Element {
  const selection = useSelection();
  const relation = useRelationDropTarget({
    target: objectForWorkViewRow(row),
    disabled: !interaction.writable,
  });
  const card = (
    <article
      ref={relation.dropProps.ref}
      role="article"
      aria-label={workViewRowTitle(row)}
      data-drop-state={relation.dropState}
      data-selecting={selectionActive || selected}
      className={cn(
        'group/card border-outline-variant bg-surface text-on-surface hover:bg-surface-container-high relative rounded-lg border p-3',
        relation.dropProps.className,
        relation.dropState === 'accept' && 'ring-primary bg-primary/8 ring-2',
        relation.dropState === 'reject' && 'ring-error/60 bg-error/5 ring-1',
      )}
    >
      <div className="flex items-start gap-2">
        {selectable ? (
          <span className={CARD_CHECKBOX_REVEAL_CLASS}>
            <Checkbox
              aria-label={`Select ${workViewRowTitle(row)}`}
              checked={selected}
              onChange={onToggle}
            />
          </span>
        ) : null}
        <DocketLink
          href={buildEntityHref(entityNavigationSnapshotFromWorkViewRow(row))}
          className="focus-visible:ring-primary text-body-medium min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2"
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onActivate();
          }}
        >
          {workViewRowTitle(row)}
        </DocketLink>
      </div>
      {children}
      {relation.effectLabel ? (
        <span className="bg-primary-container text-on-primary-container text-label-small mt-2 block rounded-md px-2 py-1">
          {relation.effectLabel}
        </span>
      ) : null}
    </article>
  );
  if (interaction.object === null) return card;
  return (
    <ObjectSurface
      object={interaction.object}
      dragDisabled={interaction.dragDisabled}
      actionScope={interaction.actionScope}
      surfaceId={selection.surfaceId}
      objects={selected ? selection.selectedObjects : [interaction.object]}
      onActivate={onActivate}
      onDragStart={() => {
        onDragStart(sourcePath);
      }}
    >
      {card}
    </ObjectSurface>
  );
}

/** Render columns and optional swimlanes from independently paginated server groups. */
export function WorkBoard<TTarget extends ViewTarget>({
  target,
  definition,
  totalCount,
  rows: rootRows = [],
  groups,
  groupPages,
  hiddenColumns,
  canContribute,
  rowInteraction,
  onCreate,
  onActivate,
  onDrop,
  onLoadMore,
  hasMoreRows = false,
  loadingMoreRows = false,
  onLoadMoreRows,
  onHideColumn,
  onShowAllColumns,
}: WorkBoardProps<TTarget>): JSX.Element {
  const selection = useSelection();
  const activeSourcePathRef = useRef<readonly string[] | null>(null);
  const ungrouped = (definition.arrangement.groupBy as string | null) === null;
  const columns = ungrouped
    ? [
        {
          path: [] as readonly string[],
          key: '__all__',
          label: `All ${target}s`,
          count: totalCount,
        },
      ]
    : groups.filter((group) => group.path.length === 1 && !hiddenColumns.has(group.key));
  const laneGroups = groups.filter((group) => group.path.length === 2);
  const laneKeys = [
    ...new Set(
      laneGroups.map((group) => group.path[1]).filter((key): key is string => key !== undefined),
    ),
  ];
  const lanes = laneKeys.length === 0 ? [null] : laneKeys;
  const memberships = useMemo(() => {
    const entries: [
      string,
      {
        readonly row: WorkViewRowFor<TTarget>;
        readonly path: readonly string[];
        readonly interaction: WorkViewRowInteractionPolicy;
      },
    ][] = [];
    if (ungrouped) {
      for (const row of rootRows.filter((candidate) => !candidate.isContext)) {
        entries.push([
          boardMembershipKey([], row.id),
          { row, path: [], interaction: rowInteraction(row) },
        ]);
      }
    }
    for (const page of groupPages) {
      for (const row of page.rows.filter((candidate) => !candidate.isContext)) {
        entries.push([
          boardMembershipKey(page.path, row.id),
          { row, path: page.path, interaction: rowInteraction(row) },
        ]);
      }
    }
    return new Map(entries);
  }, [groupPages, rootRows, rowInteraction, ungrouped]);
  const selectionKeys = useMemo(
    () => new Set(selection.items.map((item) => objectKey(item))),
    [selection.items],
  );
  const selectionActive = selection.count > 0;
  const groupField = definition.arrangement.groupBy as string | null;
  const mutable =
    canContribute &&
    groupField !== null &&
    workViewFieldCatalog(target).find((field) => field.key === groupField)?.mutableGroup === true;
  const properties = workViewDisplayFieldCatalog(target).filter((field) =>
    definition.presentation.properties.includes(field.key),
  );

  const toggle = (id: string): void => {
    const membership = [...memberships.values()].find(({ row }) => row.id === id);
    if (membership?.interaction.object === null || membership === undefined) return;
    const key = objectKey(membership.interaction.object);
    if (selectionKeys.has(key)) selection.dispatch({ type: 'toggle', key });
  };

  const canAcceptBoardSource = useCallback(
    (data: unknown): boolean => {
      if (!mutable || !isObjectDragData(data)) return false;
      if (data.actionScope !== 'all') return false;
      const sourcePath = activeSourcePathRef.current ?? legacyBoardSourcePath(data.sourceSurfaceId);
      if (sourcePath === null) return false;
      return (
        memberships.get(boardMembershipKey(sourcePath, data.object.id))?.interaction.writable ===
        true
      );
    },
    [memberships, mutable],
  );

  useDragDropMonitor({
    onDragEnd: (event) => {
      const source = event.operation.source?.data;
      const destination = event.operation.target?.data;
      const sourcePath = isObjectDragData(source)
        ? (activeSourcePathRef.current ?? legacyBoardSourcePath(source.sourceSurfaceId))
        : null;
      activeSourcePathRef.current = null;
      if (
        !mutable ||
        !isObjectDragData(source) ||
        !isBoardCellData(destination) ||
        source.actionScope !== 'all' ||
        sourcePath === null
      )
        return;
      const membership = memberships.get(boardMembershipKey(sourcePath, source.object.id));
      if (membership?.interaction.writable !== true) return;
      onDrop({
        item: membership.row,
        sourcePath: membership.path,
        destinationPath: destination.path,
        beforeId: null,
        afterId: null,
      });
    },
  });

  return (
    <div
      role="region"
      aria-label={`${target.charAt(0).toUpperCase()}${target.slice(1)} board`}
      className="relative h-full min-h-0 overflow-auto"
    >
      {hiddenColumns.size > 0 && onShowAllColumns ? (
        <Button
          type="button"
          variant="secondary"
          controlSize="sm"
          className="sticky top-2 left-2 z-10 mb-2"
          onClick={onShowAllColumns}
        >
          Show {hiddenColumns.size} hidden {hiddenColumns.size === 1 ? 'column' : 'columns'}
        </Button>
      ) : null}
      <div className="flex min-w-max items-stretch gap-3 pb-3">
        {columns.map((column) => (
          <section
            key={column.key}
            role="region"
            aria-label={`${column.label} column`}
            className="bg-surface-container-low flex min-h-0 w-72 flex-col rounded-xl"
          >
            <header className="border-outline-variant flex h-10 shrink-0 items-center gap-2 border-b px-3">
              <h2 className="text-on-surface text-label-large min-w-0 flex-1 truncate">
                {column.label}
              </h2>
              <span className="text-on-surface-variant text-label-small tabular-nums">
                {column.count}
              </span>
              {mutable ? (
                <Button
                  type="button"
                  variant="ghost"
                  iconOnly
                  controlSize="sm"
                  aria-label={`Create in ${column.label}`}
                  onClick={() => {
                    onCreate(column.path);
                  }}
                >
                  <Plus aria-hidden />
                </Button>
              ) : null}
              {!ungrouped && onHideColumn ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      controlSize="sm"
                      aria-label={`More ${column.label} column actions`}
                    >
                      <Ellipsis aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        onHideColumn(column.key);
                      }}
                    >
                      Hide column
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
              {lanes.map((laneKey) => {
                const path = laneKey === null ? column.path : [column.key, laneKey];
                const page = ungrouped
                  ? { path, rows: rootRows, nextCursor: null, loading: loadingMoreRows }
                  : groupPages.find(
                      (candidate) =>
                        workViewGroupPathKey(candidate.path) === workViewGroupPathKey(path),
                    );
                const lane =
                  laneKey === null
                    ? null
                    : laneGroups.find(
                        (candidate) =>
                          workViewGroupPathKey(candidate.path) === workViewGroupPathKey(path),
                      );
                const mountedRows = ungrouped
                  ? (page?.rows ?? []).filter((row) => !row.isContext)
                  : (page?.rows ?? [])
                      .filter((row) => !row.isContext)
                      .slice(-MAX_MOUNTED_CARDS_PER_CELL);
                return (
                  <WorkBoardCell
                    key={workViewGroupPathKey(path)}
                    path={path}
                    label={lane?.label ?? column.label}
                    mutable={mutable}
                    canAcceptSource={canAcceptBoardSource}
                  >
                    {lane ? (
                      <h3 className="text-on-surface-variant text-label-medium mb-2 flex items-center justify-between px-1">
                        <span>{lane.label}</span>
                        <span className="tabular-nums">{lane.count}</span>
                      </h3>
                    ) : null}
                    <div className="flex flex-col gap-2">
                      {mountedRows.map((row) => {
                        const sourcePath = page?.path ?? path;
                        const interaction =
                          memberships.get(boardMembershipKey(sourcePath, row.id))?.interaction ??
                          rowInteraction(row);
                        const key =
                          interaction.object === null ? null : objectKey(interaction.object);
                        const selectable = key !== null && selectionKeys.has(key);
                        return (
                          <WorkBoardCard
                            key={row.id}
                            row={row}
                            sourcePath={sourcePath}
                            selected={key !== null && selection.isSelected(key)}
                            selectable={selectable}
                            selectionActive={selectionActive}
                            interaction={interaction}
                            onToggle={() => {
                              toggle(row.id);
                            }}
                            onActivate={() => {
                              onActivate(row);
                            }}
                            onDragStart={(dragPath) => {
                              activeSourcePathRef.current = dragPath;
                            }}
                          >
                            {properties.length > 0 ? (
                              <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                {properties.map((field) => (
                                  <div
                                    key={field.key}
                                    className="text-on-surface-variant text-label-small flex min-w-0 gap-1"
                                  >
                                    <dt className="sr-only">{field.label}</dt>
                                    <dd className="max-w-36 truncate">
                                      {formatWorkViewValue(
                                        workViewRowDisplayValue(row, field.key),
                                        field.kind,
                                      )}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            ) : null}
                          </WorkBoardCard>
                        );
                      })}
                    </div>
                    {ungrouped && hasMoreRows && onLoadMoreRows ? (
                      <Button
                        type="button"
                        variant="ghost"
                        controlSize="sm"
                        className="mt-2 w-full"
                        disabled={loadingMoreRows}
                        onClick={onLoadMoreRows}
                      >
                        {loadingMoreRows ? 'Loading more' : `Load more ${target}s`}
                      </Button>
                    ) : page?.nextCursor ? (
                      <Button
                        type="button"
                        variant="ghost"
                        controlSize="sm"
                        className="mt-2 w-full"
                        onClick={() => {
                          onLoadMore(path);
                        }}
                      >
                        Load more {lane?.label ?? column.label} in {column.label}
                      </Button>
                    ) : null}
                  </WorkBoardCell>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
