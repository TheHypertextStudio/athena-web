'use client';

/**
 * `@docket/ui` — the shared, column-aligned entity table.
 *
 * @remarks
 * The design mandate is that Initiatives, Projects, and Tasks read as *one surface*: aligned rows
 * under a light header, Linear-style. {@link EntityTable} is that surface — every entity list
 * renders through it. It reuses the same row chrome as {@link EntityListRow}/{@link ListRow}
 * (density, dividers, hover/selected tones, focus ring) so a table of entities and a
 * {@link ListView} of tasks feel identical.
 *
 * Columns are declared as a typed {@link Column}`<T>` array; the title column flexes (`flex-1`)
 * and the rest take fixed/min widths so values line up. Responsive: each column declares a
 * `priority`; lower-priority columns hide first via `@container/table` queries so the app never
 * overflows horizontally. Keyboard: `role="grid"` + {@link useListKeyboard}.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { focusRingInset } from '../../primitives/focus';
import { useListKeyboard } from '../../hooks/useListKeyboard';
import { GroupHeader } from './GroupHeader';
import type { Column, ColumnPriority, EntityTableRowLinkProps } from './entity-table-columns';
import { columnClassName, columnStyle } from './entity-table-columns';
import { EntityTableRow } from './entity-table-row';

export type { Column, ColumnPriority, EntityTableRowLinkProps };

/** A group boundary for {@link EntityTable} grouping — mirrors `AppliedView.groups`. */
export interface EntityTableGroup<T> {
  /** Stable bucket id (React key + collapse-state key). */
  id: string;
  /** Display-ready group label (vocabulary-resolved by the page). */
  label: string;
  /** Optional leading decoration for the group header (e.g. a status glyph). */
  decoration?: React.ReactNode;
  /** The bucket's rows, already filtered/sorted by the page. */
  rows: readonly T[];
}

/** Props for {@link EntityTable}. */
export interface EntityTableProps<T> {
  /** The column specification (declaration order = visual order). */
  columns: readonly Column<T>[];
  /**
   * The flat rows to render. Provide *either* `rows` (a flat table) *or* `groups`
   * (a grouped table). When both are given, `groups` wins.
   */
  rows?: readonly T[];
  /** Grouped rows: full-width group boundary rows with their data rows beneath. */
  groups?: readonly EntityTableGroup<T>[];
  /** Stable React key for a row. */
  getRowKey: (row: T) => string;
  /** Per-row link target. When provided, each data row renders as an `<a href>`. */
  rowHref?: (row: T) => string | undefined;
  /** Render the row's link via a custom element (typically a router `Link`). */
  renderRowLink?: (props: EntityTableRowLinkProps) => React.ReactNode;
  /** Activate (open) a row on click / Enter. */
  onRowClick?: (row: T) => void;
  /** The currently selected row keys (controlled). */
  selected?: ReadonlySet<string>;
  /** Toggle a row's selection (controlled). */
  onSelect?: (row: T, next: boolean) => void;
  /** Controlled collapsed group ids. */
  collapsed?: ReadonlySet<string>;
  /** Toggle a group's collapse state (controlled mode). */
  onToggleGroup?: (groupId: string) => void;
  /** Initial collapsed group ids (uncontrolled mode). */
  defaultCollapsed?: Iterable<string>;
  /** Hide the light header row. */
  hideHeader?: boolean;
  /** Accessible label for the grid. */
  'aria-label'?: string;
  /** Extra classes merged onto the table's outer (scroll) container. */
  className?: string;
}

/** A flattened render row: a group-header boundary, or a data row carrying its source item. */
type FlatTableRow<T> =
  | { readonly kind: 'group'; readonly key: string; readonly group: EntityTableGroup<T> }
  | { readonly kind: 'row'; readonly key: string; readonly row: T; readonly groupId?: string };

/**
 * The shared, column-aligned entity table.
 *
 * @typeParam T - The row item type (a `ProjectOut`, `InitiativeOut`, or task view-model).
 *
 * @example
 * ```tsx
 * <EntityTable
 *   aria-label="Projects"
 *   columns={columns}
 *   groups={applied.groups ?? undefined}
 *   rows={applied.rows}
 *   getRowKey={(p) => p.id}
 *   rowHref={(p) => `/orgs/${orgId}/projects/${p.id}`}
 *   renderRowLink={(lp) => <Link {...lp}>{lp.children}</Link>}
 * />
 * ```
 */
export function EntityTable<T>({
  columns,
  rows,
  groups,
  getRowKey,
  rowHref,
  renderRowLink,
  onRowClick,
  selected,
  onSelect,
  collapsed: collapsedProp,
  onToggleGroup,
  defaultCollapsed,
  hideHeader = false,
  'aria-label': ariaLabel,
  className,
}: EntityTableProps<T>): React.JSX.Element {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const [internalCollapsed, setInternalCollapsed] = React.useState<ReadonlySet<string>>(
    () => new Set(defaultCollapsed ?? []),
  );
  const isControlled = collapsedProp !== undefined;
  const collapsedSet = isControlled ? collapsedProp : internalCollapsed;

  const toggleGroup = React.useCallback(
    (groupId: string) => {
      if (isControlled) {
        onToggleGroup?.(groupId);
        return;
      }
      setInternalCollapsed((current) => {
        const next = new Set(current);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        return next;
      });
    },
    [isControlled, onToggleGroup],
  );

  const flat = React.useMemo<FlatTableRow<T>[]>(() => {
    if (groups) {
      const out: FlatTableRow<T>[] = [];
      for (const group of groups) {
        out.push({ kind: 'group', key: `g:${group.id}`, group });
        if (collapsedSet.has(group.id)) continue;
        for (const row of group.rows) {
          out.push({ kind: 'row', key: `r:${getRowKey(row)}`, row, groupId: group.id });
        }
      }
      return out;
    }
    return (rows ?? []).map((row) => ({
      kind: 'row',
      key: `r:${getRowKey(row)}`,
      row,
    }));
  }, [groups, rows, collapsedSet, getRowKey]);

  const activateRow = React.useCallback(
    (index: number) => {
      const entry = flat[index];
      /* v8 ignore start -- unreachable: `activeIndex` is clamped to a valid row before activation. */
      if (!entry) return;
      /* v8 ignore stop */
      if (entry.kind === 'group') toggleGroup(entry.group.id);
      else onRowClick?.(entry.row);
    },
    [flat, toggleGroup, onRowClick],
  );

  const { activeIndex, onKeyDown } = useListKeyboard({
    rowCount: flat.length,
    onActivate: activateRow,
  });

  const handleSelectRow = React.useCallback(
    (row: T) => {
      if (!onSelect) return;
      onSelect(row, !(selected?.has(getRowKey(row)) ?? false));
    },
    [onSelect, selected, getRowKey],
  );

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={flat.length}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        'border-outline-variant bg-surface @container/table flex w-full flex-col overflow-x-auto overflow-y-hidden rounded-xl border outline-none',
        focusRingInset,
        className,
      )}
    >
      {hideHeader ? null : (
        <div
          role="row"
          className="border-outline-variant text-on-surface-variant flex min-h-8 w-full items-center gap-2 border-b px-3 py-1.5 text-xs font-medium select-none"
        >
          {columns.map((column) => (
            <span
              key={column.key}
              role="columnheader"
              data-col={column.key}
              aria-sort={column.sortable ? 'none' : undefined}
              style={columnStyle(column)}
              className={cn(columnClassName(column), 'truncate')}
            >
              {column.header}
            </span>
          ))}
        </div>
      )}

      {flat.map((entry, index) => {
        if (entry.kind === 'group') {
          return (
            <GroupHeader
              key={entry.key}
              label={entry.group.label}
              decoration={entry.group.decoration}
              count={entry.group.rows.length}
              expanded={!collapsedSet.has(entry.group.id)}
              onToggle={() => {
                toggleGroup(entry.group.id);
              }}
              className={cn(activeIndex === index && 'bg-surface-container-high')}
            />
          );
        }
        const key = getRowKey(entry.row);
        return (
          <EntityTableRow
            key={entry.key}
            columns={columns}
            row={entry.row}
            active={activeIndex === index}
            selected={selected?.has(key) ?? false}
            href={rowHref?.(entry.row)}
            renderRowLink={renderRowLink}
            onActivate={
              onRowClick
                ? () => {
                    onRowClick(entry.row);
                  }
                : undefined
            }
            onSelect={
              onSelect
                ? () => {
                    handleSelectRow(entry.row);
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
