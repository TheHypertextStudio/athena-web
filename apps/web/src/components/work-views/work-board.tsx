'use client';

import { Ellipsis, Plus } from '@docket/ui/icons';
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import { type DragEvent, type JSX, useMemo } from 'react';

import type { WorkViewDefinitionFor } from './view-state';
import { workViewDisplayFieldCatalog, workViewFieldCatalog } from './view-state';
import {
  formatWorkViewValue,
  type WorkViewGroupPage,
  type WorkViewGroupSummary,
  type WorkViewRowFor,
  workViewGroupPathKey,
  workViewRowTitle,
  workViewRowValue,
} from './renderer-types';

const BOARD_DRAG_TYPE = 'application/x-docket-work-view-row';
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
  readonly groups: readonly WorkViewGroupSummary[];
  readonly groupPages: readonly WorkViewGroupPage<TTarget>[];
  readonly hiddenColumns: ReadonlySet<string>;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
  readonly onCreate: (path: readonly string[]) => void;
  readonly onActivate: (row: WorkViewRowFor<TTarget>) => void;
  readonly onDrop: (drop: WorkBoardDrop<TTarget>) => void;
  readonly onLoadMore: (path: readonly string[]) => void;
  readonly onHideColumn?: ((key: string) => void) | undefined;
  readonly onShowAllColumns?: (() => void) | undefined;
}

interface DragPayload {
  readonly id: string;
  readonly sourcePath: readonly string[];
}

function readDrag(event: DragEvent): DragPayload | null {
  try {
    const value: unknown = JSON.parse(event.dataTransfer.getData(BOARD_DRAG_TYPE));
    if (
      typeof value !== 'object' ||
      value === null ||
      !('id' in value) ||
      !('sourcePath' in value)
    ) {
      return null;
    }
    const id = (value as { readonly id: unknown }).id;
    const sourcePath = (value as { readonly sourcePath: unknown }).sourcePath;
    return typeof id === 'string' && Array.isArray(sourcePath)
      ? { id, sourcePath: sourcePath.filter((part): part is string => typeof part === 'string') }
      : null;
  } catch {
    return null;
  }
}

/** Render columns and optional swimlanes from independently paginated server groups. */
export function WorkBoard<TTarget extends ViewTarget>({
  target,
  definition,
  groups,
  groupPages,
  hiddenColumns,
  selectedIds,
  onSelectionChange,
  onCreate,
  onActivate,
  onDrop,
  onLoadMore,
  onHideColumn,
  onShowAllColumns,
}: WorkBoardProps<TTarget>): JSX.Element {
  const columns = groups.filter(
    (group) => group.path.length === 1 && !hiddenColumns.has(group.key),
  );
  const laneGroups = groups.filter((group) => group.path.length === 2);
  const laneKeys = [
    ...new Set(
      laneGroups.map((group) => group.path[1]).filter((key): key is string => key !== undefined),
    ),
  ];
  const lanes = laneKeys.length === 0 ? [null] : laneKeys;
  const rows = useMemo(
    () =>
      new Map<string, WorkViewRowFor<TTarget>>(
        groupPages.flatMap((page) => page.rows.map((row) => [row.id, row] as const)),
      ),
    [groupPages],
  );
  const groupField = definition.arrangement.groupBy as string | null;
  const mutable =
    groupField !== null &&
    workViewFieldCatalog(target).find((field) => field.key === groupField)?.mutableGroup === true;
  const properties = workViewDisplayFieldCatalog(target).filter((field) =>
    definition.presentation.properties.includes(field.key),
  );

  const toggle = (id: string): void => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

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
              <h2 className="text-on-surface text-label-large min-w-0 flex-1 truncate font-medium">
                {column.label}
              </h2>
              <span className="text-on-surface-variant text-label-small tabular-nums">
                {column.count}
              </span>
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
              {onHideColumn ? (
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
                const page = groupPages.find(
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
                const mountedRows = (page?.rows ?? []).slice(-MAX_MOUNTED_CARDS_PER_CELL);
                return (
                  <section
                    key={workViewGroupPathKey(path)}
                    data-testid={`board-cell-${path.join('-')}`}
                    className="min-h-20 rounded-lg"
                    onDragOver={
                      mutable
                        ? (event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                          }
                        : undefined
                    }
                    onDrop={
                      mutable
                        ? (event) => {
                            event.preventDefault();
                            const payload = readDrag(event);
                            const item = payload ? rows.get(payload.id) : undefined;
                            if (!payload || !item) return;
                            onDrop({
                              item,
                              sourcePath: payload.sourcePath,
                              destinationPath: path,
                              beforeId: null,
                              afterId: null,
                            });
                          }
                        : undefined
                    }
                  >
                    {lane ? (
                      <h3 className="text-on-surface-variant text-label-medium mb-2 flex items-center justify-between px-1">
                        <span>{lane.label}</span>
                        <span className="tabular-nums">{lane.count}</span>
                      </h3>
                    ) : null}
                    <div className="flex flex-col gap-2">
                      {mountedRows.map((row) => (
                        <article
                          key={row.id}
                          aria-label={workViewRowTitle(row)}
                          draggable={mutable}
                          className="border-outline-variant bg-surface text-on-surface hover:bg-surface-container-high rounded-lg border p-3"
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData(
                              BOARD_DRAG_TYPE,
                              JSON.stringify({ id: row.id, sourcePath: page?.path ?? path }),
                            );
                          }}
                          onDoubleClick={() => {
                            onActivate(row);
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <Checkbox
                              aria-label={`Select ${workViewRowTitle(row)}`}
                              checked={selectedIds.has(row.id)}
                              onChange={() => {
                                toggle(row.id);
                              }}
                            />
                            <span className="text-body-medium min-w-0 flex-1 font-medium">
                              {workViewRowTitle(row)}
                            </span>
                          </div>
                          {properties.length > 0 ? (
                            <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                              {properties.map((field) => (
                                <div
                                  key={field.key}
                                  className="text-on-surface-variant text-label-small flex min-w-0 gap-1"
                                >
                                  <dt className="sr-only">{field.label}</dt>
                                  <dd className="max-w-36 truncate">
                                    {formatWorkViewValue(workViewRowValue(row, field.key))}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : null}
                        </article>
                      ))}
                    </div>
                    {page?.nextCursor ? (
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
                  </section>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
