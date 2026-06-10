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
import { useDensity } from '../shell/ContextProvider';
import { ListGroup } from './ListGroup';
import { ListSubGroup } from './ListSubGroup';
import { DENSITY_ROW_HEIGHT, flattenGroups, subGroupKey } from './flatten-groups';
import type { FlatRow, GroupKey, ListViewProps, RenderRowContext } from './list-view-types';
import { NO_GROUP_ID, NO_GROUP_LABEL } from './list-view-types';

export type { FlatRow, GroupKey, ListViewProps, RenderRowContext };
export { NO_GROUP_ID, NO_GROUP_LABEL };

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
  rowHeight,
  label = 'List',
  className,
}: ListViewProps<TItem>): React.JSX.Element {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const density = useDensity();
  const resolvedRowHeight = rowHeight ?? DENSITY_ROW_HEIGHT[density];

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
    estimateSize: () => resolvedRowHeight,
    overscan: 12,
  });

  React.useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, resolvedRowHeight]);

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
