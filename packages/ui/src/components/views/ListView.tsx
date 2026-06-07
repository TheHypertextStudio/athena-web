'use client';

/**
 * `@docket/ui` — the workhorse virtualized, flattened-tree list view.
 *
 * @remarks
 * A custom virtualized list built directly on `@tanstack/react-virtual` (deliberately NOT
 * `react-arborist`): the grouped tree is flattened into a single linear array of
 * {@link FlatRow}s — a group header, an optional sub-group header, then its data rows — and
 * the virtualizer renders only the rows in view. Collapsing a group (or sub-group) omits all
 * of its descendants from the flattened array, so collapse is O(visible-rows) rather than a
 * DOM toggle.
 *
 * The view is generic over the row item type `TItem`:
 *
 * - `groupBy(item)` returns a {@link GroupKey} (id + label) or `null`. Items with no group
 *   land in a synthesized `No project / Triage` bucket so nothing is ever dropped.
 * - `subGroupBy(item)` (optional) further partitions each group; omit it for a flat,
 *   single-level grouping.
 * - `renderRow(item, ctx)` renders one data row (typically a `TaskRow`).
 * - collapse state is controlled via `collapsed` + `onToggle`, or left uncontrolled with
 *   `defaultCollapsed`.
 *
 * The container is `role="grid"` and wires {@link useListKeyboard} for arrow/Enter/Esc
 * navigation across the flattened rows, scrolling the active row into view via the
 * virtualizer.
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import * as React from 'react';

import { useListKeyboard } from '../../hooks/useListKeyboard';
import { cn } from '../../lib/utils';
import { ListGroup } from './ListGroup';
import { ListSubGroup } from './ListSubGroup';
import type { WorkflowStateType } from '../atoms/StatusIcon';

/** The id + label identifying a group or sub-group bucket. */
export interface GroupKey {
  /** Stable bucket id (used as the collapse-state key and React key). */
  id: string;
  /** Display-ready bucket label (entity nouns must already be vocabulary-resolved). */
  label: string;
  /**
   * When the (sub-)grouping is by workflow state, the canonical type — lets a sub-group
   * header render the matching status icon.
   */
  stateType?: WorkflowStateType;
}

/** The synthesized bucket id for items with no group. */
export const NO_GROUP_ID = '__no_group__';

/** The default label for the synthesized no-group bucket. */
export const NO_GROUP_LABEL = 'No project / Triage';

/** Context passed to {@link ListViewProps.renderRow} for one data row. */
export interface RenderRowContext {
  /** The row's index within the flattened row array. */
  flatIndex: number;
  /** Whether this row is the active (keyboard-focused) row. */
  active: boolean;
  /** Activate (open) this row. */
  onActivate: () => void;
}

/** A flattened row: a group header, a sub-group header, or a data row. */
export type FlatRow<TItem> =
  | {
      readonly kind: 'group';
      readonly key: string;
      readonly group: GroupKey;
      readonly count: number;
    }
  | {
      readonly kind: 'subgroup';
      readonly key: string;
      readonly group: GroupKey;
      readonly subGroup: GroupKey;
      readonly count: number;
    }
  | { readonly kind: 'row'; readonly key: string; readonly item: TItem };

/** Props for {@link ListView}. */
export interface ListViewProps<TItem> {
  /** The flat list of items to group, sub-group, and render. */
  items: readonly TItem[];
  /** Partition items into top-level groups; `null` routes to the no-group bucket. */
  groupBy: (item: TItem) => GroupKey | null;
  /** Optionally partition each group into sub-groups; omit for single-level grouping. */
  subGroupBy?: (item: TItem) => GroupKey | null;
  /** Render one data row. */
  renderRow: (item: TItem, ctx: RenderRowContext) => React.ReactNode;
  /** Stable React key for an item; falls back to the item's flat index when omitted. */
  getItemKey?: (item: TItem) => string;
  /** Controlled set of collapsed bucket ids (group id or `${groupId}/${subGroupId}`). */
  collapsed?: ReadonlySet<string>;
  /** Toggle a bucket's collapse state (controlled mode). */
  onToggle?: (bucketId: string) => void;
  /** Initial collapsed bucket ids for uncontrolled mode. */
  defaultCollapsed?: Iterable<string>;
  /** Activate (open) a data item (Enter / click). */
  onActivateItem?: (item: TItem) => void;
  /** Estimated pixel height of a single row; drives virtualization. Defaults to `36`. */
  rowHeight?: number;
  /** Accessible label for the grid. */
  label?: string;
  /** Extra classes merged onto the scroll container. */
  className?: string;
}

/** Build the composite collapse key for a sub-group bucket. */
function subGroupKey(groupId: string, subGroupId: string): string {
  return `${groupId}/${subGroupId}`;
}

/**
 * Flatten grouped items into a linear {@link FlatRow} array, omitting collapsed descendants.
 *
 * @remarks
 * Preserves first-seen order for both buckets and the items within them. A top-level group
 * always emits its header; its sub-group headers and rows are emitted only when the group is
 * expanded, and a sub-group's rows only when that sub-group is also expanded.
 */
function flattenGroups<TItem>(
  items: readonly TItem[],
  groupBy: (item: TItem) => GroupKey | null,
  subGroupBy: ((item: TItem) => GroupKey | null) | undefined,
  collapsed: ReadonlySet<string>,
  getItemKey: (item: TItem, index: number) => string,
): FlatRow<TItem>[] {
  /** Ordered group buckets keyed by group id. */
  const groupOrder: string[] = [];
  const groups = new Map<
    string,
    {
      group: GroupKey;
      subOrder: string[];
      subs: Map<string, { sub: GroupKey; items: { item: TItem; key: string }[] }>;
    }
  >();

  items.forEach((item, index) => {
    const rawGroup = groupBy(item);
    const group: GroupKey = rawGroup ?? { id: NO_GROUP_ID, label: NO_GROUP_LABEL };
    let bucket = groups.get(group.id);
    if (!bucket) {
      bucket = { group, subOrder: [], subs: new Map() };
      groups.set(group.id, bucket);
      groupOrder.push(group.id);
    }

    const rawSub = subGroupBy ? subGroupBy(item) : null;
    const sub: GroupKey = subGroupBy
      ? (rawSub ?? { id: NO_GROUP_ID, label: NO_GROUP_LABEL })
      : { id: '__all__', label: '' };
    let subBucket = bucket.subs.get(sub.id);
    if (!subBucket) {
      subBucket = { sub, items: [] };
      bucket.subs.set(sub.id, subBucket);
      bucket.subOrder.push(sub.id);
    }
    subBucket.items.push({ item, key: getItemKey(item, index) });
  });

  const rows: FlatRow<TItem>[] = [];
  for (const groupId of groupOrder) {
    const bucket = groups.get(groupId);
    /* v8 ignore start -- unreachable: every id in `groupOrder` was set in `groups` above. */
    if (!bucket) continue;
    /* v8 ignore stop */
    const groupCount = bucket.subOrder.reduce(
      /* v8 ignore next -- the `?.`/`?? 0` only narrow the always-present sub-bucket lookup. */
      (sum, sid) => sum + (bucket.subs.get(sid)?.items.length ?? 0),
      0,
    );
    rows.push({ kind: 'group', key: `g:${groupId}`, group: bucket.group, count: groupCount });
    if (collapsed.has(groupId)) continue;

    const hasSubGroups = Boolean(subGroupBy);
    for (const subId of bucket.subOrder) {
      const subBucket = bucket.subs.get(subId);
      /* v8 ignore start -- unreachable: every id in `subOrder` was set in `bucket.subs` above. */
      if (!subBucket) continue;
      /* v8 ignore stop */
      if (hasSubGroups) {
        const composite = subGroupKey(groupId, subId);
        rows.push({
          kind: 'subgroup',
          key: `s:${composite}`,
          group: bucket.group,
          subGroup: subBucket.sub,
          count: subBucket.items.length,
        });
        if (collapsed.has(composite)) continue;
      }
      for (const entry of subBucket.items) {
        rows.push({ kind: 'row', key: `r:${entry.key}`, item: entry.item });
      }
    }
  }
  return rows;
}

/**
 * A virtualized, collapsible, flattened-tree list.
 *
 * @typeParam TItem - The row item type (e.g. a task DTO).
 *
 * @remarks
 * Renders `role="grid"`; group/sub-group headers and data rows share one virtualized
 * scroll surface. Collapse can be controlled (`collapsed` + `onToggle`) or uncontrolled
 * (`defaultCollapsed`). Keyboard navigation across the flattened rows is provided by
 * {@link useListKeyboard}.
 *
 * @example
 * ```tsx
 * <ListView
 *   items={tasks}
 *   groupBy={(t) => (t.projectId ? { id: t.projectId, label: t.projectName } : null)}
 *   subGroupBy={(t) => ({ id: t.stateType, label: t.stateName, stateType: t.stateType })}
 *   renderRow={(t, ctx) => <TaskRow task={t} active={ctx.active} onActivate={ctx.onActivate} />}
 * />
 * ```
 */
export function ListView<TItem>({
  items,
  groupBy,
  subGroupBy,
  renderRow,
  getItemKey,
  collapsed: collapsedProp,
  onToggle,
  defaultCollapsed,
  onActivateItem,
  rowHeight = 36,
  label = 'List',
  className,
}: ListViewProps<TItem>): React.JSX.Element {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Uncontrolled collapse state, used only when `collapsed` is not supplied.
  const [internalCollapsed, setInternalCollapsed] = React.useState<ReadonlySet<string>>(
    () => new Set(defaultCollapsed ?? []),
  );
  const isControlled = collapsedProp !== undefined;
  const collapsed = isControlled ? collapsedProp : internalCollapsed;

  const toggleBucket = React.useCallback(
    (bucketId: string) => {
      if (isControlled) {
        onToggle?.(bucketId);
        return;
      }
      setInternalCollapsed((current) => {
        const next = new Set(current);
        if (next.has(bucketId)) next.delete(bucketId);
        else next.add(bucketId);
        return next;
      });
    },
    [isControlled, onToggle],
  );

  const resolveItemKey = React.useCallback(
    (item: TItem, index: number): string => (getItemKey ? getItemKey(item) : `i${String(index)}`),
    [getItemKey],
  );

  const rows = React.useMemo<FlatRow<TItem>[]>(
    () => flattenGroups(items, groupBy, subGroupBy, collapsed, resolveItemKey),
    [items, groupBy, subGroupBy, collapsed, resolveItemKey],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  /** Activate the flattened row at `index`: toggle a (sub-)group or open a data row. */
  const activateRow = React.useCallback(
    (index: number) => {
      const row = rows[index];
      /* v8 ignore start -- unreachable: `activeIndex` is clamped to a valid row index before activation. */
      if (!row) return;
      /* v8 ignore stop */
      if (row.kind === 'group') toggleBucket(row.group.id);
      else if (row.kind === 'subgroup') toggleBucket(subGroupKey(row.group.id, row.subGroup.id));
      else onActivateItem?.(row.item);
    },
    [rows, toggleBucket, onActivateItem],
  );

  const { activeIndex, onKeyDown } = useListKeyboard({
    rowCount: rows.length,
    onActivate: activateRow,
    onActiveChange: (index) => {
      virtualizer.scrollToIndex(index, { align: 'auto' });
    },
  });

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={label}
      aria-rowcount={rows.length}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        'focus-visible:ring-ring relative h-full w-full overflow-auto outline-none focus-visible:ring-1',
        className,
      )}
    >
      <div
        role="rowgroup"
        style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          /* v8 ignore start -- unreachable: the virtualizer only yields indices within `rows`. */
          if (!row) return null;
          /* v8 ignore stop */
          const active = virtualRow.index === activeIndex;
          return (
            <div
              key={row.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${String(virtualRow.start)}px)`,
              }}
            >
              {row.kind === 'group' ? (
                <ListGroup
                  label={row.group.label}
                  count={row.count}
                  expanded={!collapsed.has(row.group.id)}
                  onToggle={() => {
                    toggleBucket(row.group.id);
                  }}
                />
              ) : row.kind === 'subgroup' ? (
                <ListSubGroup
                  label={row.subGroup.label}
                  count={row.count}
                  stateType={row.subGroup.stateType}
                  expanded={!collapsed.has(subGroupKey(row.group.id, row.subGroup.id))}
                  onToggle={() => {
                    toggleBucket(subGroupKey(row.group.id, row.subGroup.id));
                  }}
                />
              ) : (
                renderRow(row.item, {
                  flatIndex: virtualRow.index,
                  active,
                  onActivate: () => onActivateItem?.(row.item),
                })
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
