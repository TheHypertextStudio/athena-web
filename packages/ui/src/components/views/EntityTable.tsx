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
import { useVirtualizer } from '@tanstack/react-virtual';
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

/** Selection/focus props an application can inject without coupling `@docket/ui` to its model. */
export interface EntityTableRowInteraction {
  readonly selected: boolean;
  readonly active: boolean;
  readonly rowProps: React.HTMLAttributes<HTMLElement> & {
    readonly 'aria-selected': boolean;
    readonly 'data-selected': boolean;
    readonly 'data-active': boolean;
    readonly tabIndex: number;
    readonly ref: (element: HTMLElement | null) => void;
    readonly onClick: (event: React.MouseEvent) => void;
  };
  /** State classes contributed by the interaction (selection/drop preview). */
  readonly className?: string;
}

/** Render-prop bridge from an application-owned row model into the generic table. */
export interface EntityTableRowInteractionProps<T> {
  readonly row: T;
  readonly children: (interaction: EntityTableRowInteraction) => React.ReactNode;
}

/** Props for {@link EntityTable}. */
export interface EntityTableProps<T> {
  /** The column specification (declaration order = visual order). */
  columns: readonly Column<T>[];
  /**
   * The flat rows to render. Provide *either* `rows` (a flat table) *or* `groups`
   * (a grouped table). When both are given, `groups` wins.
   */
  rows?: readonly T[] | undefined;
  /** Grouped rows: full-width group boundary rows with their data rows beneath. */
  groups?: readonly EntityTableGroup<T>[] | undefined;
  /** Stable React key for a row. */
  getRowKey: (row: T) => string;
  /** Per-row link target. When provided, each data row renders as an `<a href>`. */
  rowHref?: ((row: T) => string | undefined) | undefined;
  /**
   * Render the row's link via a custom element (typically a router `Link`).
   *
   * @remarks
   * Forward every prop you are handed — spreading (`{...props}`) rather than cherry-picking.
   */
  renderRowLink?: ((props: EntityTableRowLinkProps) => React.ReactNode) | undefined;
  /** Activate (open) a row on click / Enter. */
  onRowClick?: ((row: T) => void) | undefined;
  /**
   * Handle a property-edit hotkey (`L`, and future `S`/`A`/`P`/`D`) on the active data row.
   *
   * @remarks
   * Never called when the active flattened row is a group-header boundary. `anchor` is the active
   * row's DOM element (via its `aria-current="true"` marker, which every row-render branch —
   * button, anchor, and custom `renderRowLink` — already carries), for positioning a popover
   * against it. Return `true` to consume the keystroke.
   */
  onRowPropertyKey?: ((key: string, row: T, anchor: HTMLElement | null) => boolean) | undefined;
  /** Warm a row's destination cache on hover/focus (prefetch-on-intent). Optional; no-op if unset. */
  onRowPrefetch?: ((row: T) => void) | undefined;
  /** Inject application-owned row selection/focus behavior. */
  renderRowInteraction?:
    | ((props: EntityTableRowInteractionProps<T>) => React.ReactNode)
    | undefined;
  /** Restrict `rowHref` navigation to this column instead of making the whole row a link. */
  rowLinkColumnKey?: string | undefined;
  /** Application-owned props/ref merged onto the grid container. */
  containerInteraction?:
    | (React.HTMLAttributes<HTMLDivElement> & {
        readonly ref?: ((element: HTMLElement | null) => void) | undefined;
      })
    | undefined;
  /** The currently selected row keys (controlled). */
  selected?: ReadonlySet<string> | undefined;
  /** Toggle a row's selection (controlled). */
  onSelect?: ((row: T, next: boolean) => void) | undefined;
  /** Controlled collapsed group ids. */
  collapsed?: ReadonlySet<string> | undefined;
  /** Toggle a group's collapse state (controlled mode). */
  onToggleGroup?: ((groupId: string) => void) | undefined;
  /** Initial collapsed group ids (uncontrolled mode). */
  defaultCollapsed?: Iterable<string> | undefined;
  /** Hide the light header row. */
  hideHeader?: boolean | undefined;
  /** Render group headers and data rows through one measured, bounded virtual sequence. */
  virtualized?: boolean | undefined;
  /** Called when the virtual viewport reaches the final 12 loaded entries. */
  onEndReached?: (() => void) | undefined;
  /** Content rendered after the final virtual row, such as loading state or Retry. */
  endAdornment?: React.ReactNode;
  /** Accessible label for the grid. */
  'aria-label'?: string | undefined;
  /** Extra classes merged onto the table's outer (scroll) container. */
  className?: string | undefined;
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
  onRowPropertyKey,
  onRowPrefetch,
  renderRowInteraction,
  rowLinkColumnKey,
  containerInteraction,
  selected,
  onSelect,
  collapsed: collapsedProp,
  onToggleGroup,
  defaultCollapsed,
  hideHeader = false,
  virtualized = false,
  onEndReached,
  endAdornment,
  'aria-label': ariaLabel,
  className,
}: EntityTableProps<T>): React.JSX.Element {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const rowIdPrefix = React.useId().replaceAll(':', '');
  const activeKeyRef = React.useRef<string | null>(null);

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
          out.push({
            kind: 'row',
            key: `r:${group.id}:${getRowKey(row)}`,
            row,
            groupId: group.id,
          });
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

  const virtualCount = virtualized ? flat.length + (endAdornment === undefined ? 0 : 1) : 0;
  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
    enabled: virtualized,
    getItemKey: (index) => flat[index]?.key ?? '__end_adornment__',
  });

  React.useEffect(() => {
    if (virtualized) virtualizer.measure();
  }, [virtualized, virtualizer, flat.length]);

  const rowDomId = React.useCallback(
    (index: number): string => `entity-table-${rowIdPrefix}-row-${String(index)}`,
    [rowIdPrefix],
  );

  const activateRow = React.useCallback(
    (index: number) => {
      const entry = flat[index];
      /* v8 ignore start -- unreachable: `activeIndex` is clamped to a valid row before activation. */
      if (!entry) return;
      /* v8 ignore stop */
      if (entry.kind === 'group') toggleGroup(entry.group.id);
      else if (onRowClick) onRowClick(entry.row);
      else {
        const rowElement = document.getElementById(rowDomId(index));
        const link = rowElement?.matches('a[href]')
          ? rowElement
          : rowElement?.querySelector<HTMLElement>('a[href]');
        link?.click();
      }
    },
    [flat, toggleGroup, onRowClick, rowDomId],
  );

  const handlePropertyKey = React.useCallback(
    (key: string, index: number): boolean => {
      if (!onRowPropertyKey) return false;
      const entry = flat[index];
      if (entry?.kind !== 'row') return false;
      const anchor = scrollRef.current?.querySelector<HTMLElement>('[aria-current="true"]') ?? null;
      return onRowPropertyKey(key, entry.row, anchor);
    },
    [flat, onRowPropertyKey],
  );

  const { activeIndex, setActiveIndex, onKeyDown } = useListKeyboard({
    rowCount: flat.length,
    onActivate: activateRow,
    onPropertyKey: handlePropertyKey,
    onActiveChange: (index: number) => {
      activeKeyRef.current = flat[index]?.key ?? null;
      if (virtualized) virtualizer.scrollToIndex(index, { align: 'auto' });
    },
  });

  React.useEffect(() => {
    const activeKey = activeKeyRef.current;
    if (activeKey === null) return;
    const nextIndex = flat.findIndex((entry) => entry.key === activeKey);
    if (nextIndex < 0) {
      const first = flat[0];
      activeKeyRef.current = first?.key ?? null;
      setActiveIndex(first ? 0 : -1);
    } else if (nextIndex !== activeIndex) {
      setActiveIndex(nextIndex);
    }
  }, [activeIndex, flat, setActiveIndex]);

  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems.at(-1)?.index ?? -1;
  React.useEffect(() => {
    if (
      virtualized &&
      onEndReached &&
      flat.length > 0 &&
      lastVirtualIndex >= Math.max(0, flat.length - 13)
    ) {
      onEndReached();
    }
  }, [virtualized, onEndReached, flat.length, lastVirtualIndex]);

  const handleSelectRow = React.useCallback(
    (row: T) => {
      /* v8 ignore start -- unreachable: this callback is only ever wired to a row's `onSelect`
         prop below, and that wiring is itself gated on `onSelect` being defined
         (`onSelect ? () => handleSelectRow(...) : undefined`) — so `onSelect` can never be falsy
         by the time this runs. */
      if (!onSelect) return;
      /* v8 ignore stop */
      onSelect(row, !(selected?.has(getRowKey(row)) ?? false));
    },
    [onSelect, selected, getRowKey],
  );

  const setScrollElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      scrollRef.current = element;
      containerInteraction?.ref?.(element);
    },
    [containerInteraction],
  );

  const handleGridKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      containerInteraction?.onKeyDown?.(event);
      if (!event.defaultPrevented) {
        onKeyDown(event);
        if (event.key === 'Escape') activeKeyRef.current = null;
      }
    },
    [containerInteraction, onKeyDown],
  );

  const renderFlatEntry = (entry: FlatTableRow<T>, index: number): React.ReactNode => {
    const ariaRowIndex = index + (hideHeader ? 1 : 2);
    const id = rowDomId(index);
    if (entry.kind === 'group') {
      return (
        <GroupHeader
          key={entry.key}
          id={id}
          aria-rowindex={ariaRowIndex}
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
    const renderRow = (interaction?: EntityTableRowInteraction): React.ReactNode => (
      <EntityTableRow
        key={entry.key}
        id={id}
        ariaRowIndex={ariaRowIndex}
        columns={columns}
        row={entry.row}
        active={interaction?.active ?? activeIndex === index}
        selected={interaction?.selected ?? selected?.has(key) ?? false}
        href={rowHref?.(entry.row)}
        renderRowLink={renderRowLink}
        interaction={interaction}
        linkColumnKey={rowLinkColumnKey}
        onRowPrefetch={
          onRowPrefetch
            ? () => {
                onRowPrefetch(entry.row);
              }
            : undefined
        }
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
    return renderRowInteraction ? (
      <React.Fragment key={entry.key}>
        {renderRowInteraction({ row: entry.row, children: renderRow })}
      </React.Fragment>
    ) : (
      renderRow()
    );
  };

  return (
    <div
      {...containerInteraction}
      ref={setScrollElement}
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={flat.length + (hideHeader ? 0 : 1)}
      aria-activedescendant={activeIndex < 0 ? undefined : rowDomId(activeIndex)}
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
      className={cn(
        'border-outline-variant bg-surface @container/table flex w-full flex-col overflow-x-auto rounded-xl border outline-none',
        virtualized ? 'relative h-full min-h-0 overflow-y-auto' : 'overflow-y-hidden',
        focusRingInset,
        className,
      )}
    >
      {hideHeader ? null : (
        <div
          role="row"
          aria-rowindex={1}
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

      {virtualized ? (
        <div
          role="rowgroup"
          style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}
        >
          {virtualItems.map((virtualRow) => {
            const entry = flat[virtualRow.index];
            const key = entry?.key ?? '__end_adornment__';
            return (
              <div
                key={key}
                role="presentation"
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
                {entry ? renderFlatEntry(entry, virtualRow.index) : endAdornment}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {flat.map(renderFlatEntry)}
          {endAdornment}
        </>
      )}
    </div>
  );
}
