'use client';

/**
 * `@docket/ui` — the shared, column-aligned entity table.
 *
 * @remarks
 * Docket's design decision (the user's mandate) is that Initiatives, Projects, and Tasks must
 * read as the *same* surface: **aligned rows under a light header**, Linear-style — not a heavy
 * spreadsheet. {@link EntityTable} is that one surface. Every entity list renders through it so a
 * project roster, an initiative roster, and a task list share one visual hierarchy: a leading
 * status/type glyph, a {@link Column} *title* that flexes and truncates, and the entity's key
 * properties (status, lead, labels, cycle, target/due date, estimate, progress) in **aligned**
 * columns.
 *
 * It is the table sibling of {@link EntityListRow}/{@link ListRow}: it reuses the exact same row
 * chrome — the `min-h-9 px-3 py-1.5 gap-2` density, the hairline `border-outline-variant` divider,
 * `hover:bg-surface-container-high`, the `bg-surface-container-highest` active/selected tone, and
 * the dense-row {@link focusRingInset} — so a table of entities and a {@link ListView} of tasks
 * feel identical. The light header row is a real `text-on-surface-variant text-xs` label band with
 * a hairline bottom border; it is deliberately **not** an uppercase/`tracking-wide` eyebrow (Phase
 * A removed those).
 *
 * Columns are declared once as a typed {@link Column}`<T>` array — `{ key, header, render, align?,
 * width?/minWidth?, sortable?, priority? }` — which a page derives from its existing
 * `FieldCatalog` (label → header, accessor/resolveLabel → render). The title column flexes
 * (`flex-1`, `min-w-0`, truncating); property columns take a fixed `width` or a `minWidth` and an
 * `align`, so values line up across rows.
 *
 * **Responsive**: the table is its own `@container/table`, so it never forces the app to overflow
 * horizontally. Each column may declare a `priority` (lower = more important); when the container
 * is too narrow for all columns, the table hides the lowest-priority columns first (via container
 * queries), keeping the leading glyph + title + the highest-priority properties. Past the point
 * where even the kept columns don't fit, the table scrolls horizontally *within its own panel*
 * (the page chrome stays put). The title column always survives.
 *
 * **Keyboard**: the container is a `role="grid"` with roving-tabindex navigation
 * ({@link useListKeyboard}) over the flattened rows (group headers + data rows). Arrow/Home/End
 * move the active row, Enter activates it (opens a data row, toggles a group), Escape clears.
 *
 * **Grouping**: pass `groups` (e.g. the `AppliedView.groups` an entity catalog produces) to render
 * full-width {@link GroupHeader} boundary rows that span every column, with the data rows beneath —
 * consistent with how {@link ListView} renders grouped tasks. Omit `groups` for a flat table.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { focusRingInset } from '../../primitives/focus';
import { useListKeyboard } from '../../hooks/useListKeyboard';
import { GroupHeader } from './GroupHeader';

/**
 * A column priority tier, driving responsive column hiding.
 *
 * @remarks
 * Lower tiers are kept longer as the container narrows. `'always'` columns (the title, the
 * leading glyph) never hide. The numeric tiers map to container breakpoints: a higher number is
 * dropped first.
 *
 * - `'always'` — never hidden (title + leading glyph).
 * - `1` — hidden only on the narrowest containers (kept down to `@md`).
 * - `2` — hidden below `@lg`.
 * - `3` — hidden below `@xl` (the first to go).
 */
export type ColumnPriority = 'always' | 1 | 2 | 3;

/**
 * One column of an {@link EntityTable}.
 *
 * @typeParam T - The row type (e.g. `ProjectOut`, `InitiativeOut`, a task view-model).
 */
export interface Column<T> {
  /** Stable column key (React key + the `data-col` hook for tests/styling). */
  key: string;
  /**
   * The header label shown in the light header band. A page derives this from a
   * `FieldDescriptor.label`. Use an empty string for a label-less column (e.g. the leading glyph).
   */
  header: React.ReactNode;
  /**
   * Render this column's cell for a row. A page derives this from a `FieldDescriptor`'s
   * `accessor`/`resolveLabel` (e.g. a status glyph, a lead avatar, a formatted date or estimate).
   */
  render: (row: T) => React.ReactNode;
  /**
   * Horizontal alignment of the header + cells. Defaults to `'start'`. Use `'end'` for trailing
   * numeric columns (estimate, progress) so they line up against the row's end.
   */
  align?: 'start' | 'center' | 'end';
  /**
   * The column's fixed width (any CSS length). Use for tight, predictable columns (a glyph, an
   * avatar, a status badge). Mutually exclusive with {@link Column.minWidth} — `width` wins.
   */
  width?: string;
  /**
   * The column's minimum width (any CSS length); the column may grow past it. Use for columns
   * whose content varies (a lead name). Ignored when {@link Column.width} is set.
   */
  minWidth?: string;
  /**
   * Mark the *title* column: it flexes to fill (`flex-1`), truncates its content, and is never
   * hidden by the responsive strategy. Exactly one column should set this; if none does, the first
   * column without an explicit width flexes.
   */
  flex?: boolean;
  /**
   * The responsive priority tier. Defaults to `1` (kept until the container is narrow). Set
   * `'always'` for must-keep columns; raise the number for columns that may drop first on narrow
   * containers. The {@link Column.flex} title column is always `'always'`.
   */
  priority?: ColumnPriority;
  /** Whether this column is sortable; surfaces an `aria-sort` hook on its header. Defaults `false`. */
  sortable?: boolean;
  /** Extra classes merged onto every cell (and the header) of this column. */
  className?: string;
}

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
   * The flat rows to render. Provide *either* `rows` (a flat table) *or* {@link EntityTableProps.groups}
   * (a grouped table). When both are given, `groups` wins.
   */
  rows?: readonly T[];
  /**
   * Grouped rows: full-width {@link GroupHeader} boundary rows with their data rows beneath.
   * Typically the `groups` of an `applyView` result. When set, takes precedence over `rows`.
   */
  groups?: readonly EntityTableGroup<T>[];
  /** Stable React key + identity for a row (also the `onSelect`/`href`/`onRowClick` argument key). */
  getRowKey: (row: T) => string;
  /**
   * Per-row link target. When provided, each data row renders as an `<a href>` so it is a real,
   * right-clickable, new-tab-openable link (the row's cells are the link's content). Mutually
   * composable with {@link EntityTableProps.onRowClick} (click still fires for selection/recording).
   */
  rowHref?: (row: T) => string | undefined;
  /**
   * Render the row's link via a custom element — typically a router `Link`. Receives the row's
   * `href`, the composed row `className`, the cell `children`, and the row's roving `tabIndex`.
   * Use with {@link EntityTableProps.rowHref}.
   */
  renderRowLink?: (props: EntityTableRowLinkProps) => React.ReactNode;
  /** Activate (open) a row on click / Enter when it is not a link (or in addition to navigating). */
  onRowClick?: (row: T) => void;
  /** The currently selected row keys (controlled). Rows in this set adopt the MD3 selected tone. */
  selected?: ReadonlySet<string>;
  /** Toggle a row's selection (controlled). Called with the row and its next selected state. */
  onSelect?: (row: T, next: boolean) => void;
  /** Controlled collapsed group ids. Omit for uncontrolled collapse via {@link defaultCollapsed}. */
  collapsed?: ReadonlySet<string>;
  /** Toggle a group's collapse state (controlled mode). */
  onToggleGroup?: (groupId: string) => void;
  /** Initial collapsed group ids (uncontrolled mode). */
  defaultCollapsed?: Iterable<string>;
  /** Hide the light header row (e.g. inside a detail panel where the header is redundant). */
  hideHeader?: boolean;
  /** Accessible label for the grid. */
  'aria-label'?: string;
  /** Extra classes merged onto the table's outer (scroll) container. */
  className?: string;
}

/** The props an {@link EntityTableProps.renderRowLink} slot receives. */
export interface EntityTableRowLinkProps {
  /** The link target. */
  href: string;
  /** The composed row class string (density, surfaces, focus ring, alignment grid). */
  className: string;
  /** Click handler (fires `onRowClick`/selection in addition to the browser's navigation). */
  onClick: () => void;
  /** Roving tab index for keyboard navigation. */
  tabIndex: number;
  /** `aria-current` mirror of the active state. */
  'aria-current': 'true' | undefined;
  /** The row's cells to render as children. */
  children: React.ReactNode;
}

/** A flattened render row: a group-header boundary, or a data row carrying its source item. */
type FlatTableRow<T> =
  | { readonly kind: 'group'; readonly key: string; readonly group: EntityTableGroup<T> }
  | { readonly kind: 'row'; readonly key: string; readonly row: T; readonly groupId?: string };

/** Justify-content utility for a column's alignment. */
const ALIGN_JUSTIFY: Record<NonNullable<Column<unknown>['align']>, string> = {
  start: 'justify-start text-left',
  center: 'justify-center text-center',
  end: 'justify-end text-right',
};

/**
 * The container-query visibility utility for a column priority tier.
 *
 * @remarks
 * The table is a `@container/table`. A column is `hidden` by default and revealed (`flex`) once
 * the container is wide enough for its tier, so the lowest-priority columns drop first as the panel
 * narrows. `'always'` columns are always shown. This is the responsive strategy that keeps the app
 * from overflowing horizontally: properties shed gracefully, and only the title + must-keep columns
 * remain on the narrowest containers (with horizontal scroll-within as the final fallback).
 */
function priorityVisibility(priority: ColumnPriority): string {
  switch (priority) {
    case 'always':
      return 'flex';
    case 1:
      return 'hidden @md/table:flex';
    case 2:
      return 'hidden @lg/table:flex';
    case 3:
      return 'hidden @xl/table:flex';
    /* v8 ignore next 2 -- defensive: `priority` is a closed union. */
    default:
      return 'flex';
  }
}

/** The effective priority of a column (the flex/title column is always kept). */
function effectivePriority<T>(column: Column<T>): ColumnPriority {
  if (column.flex) return 'always';
  return column.priority ?? 1;
}

/** The shared per-cell sizing/alignment style for a column (header + body stay in lockstep). */
function columnStyle<T>(column: Column<T>): React.CSSProperties {
  if (column.flex) return { flex: '1 1 0%', minWidth: 0 };
  if (column.width !== undefined) return { width: column.width, flex: `0 0 ${column.width}` };
  if (column.minWidth !== undefined) return { minWidth: column.minWidth };
  return {};
}

/** The shared per-cell layout class for a column (header + body stay in lockstep). */
function columnClassName<T>(column: Column<T>): string {
  return cn(
    'flex min-w-0 shrink-0 items-center',
    column.flex && 'min-w-0 flex-1 shrink',
    ALIGN_JUSTIFY[column.align ?? 'start'],
    priorityVisibility(effectivePriority(column)),
    column.className,
  );
}

/** The shared row chrome (density + dividers + the named container) — matches {@link ListRow}. */
const TABLE_ROW_BASE =
  'border-outline-variant relative flex min-h-9 w-full items-center gap-2 border-b px-3 py-1.5 text-body last:border-b-0';

/** The interactive affordances for a data row — matches {@link ListRow}/{@link EntityListRow}. */
const TABLE_ROW_INTERACTIVE = cn(
  'cursor-pointer transition-colors outline-none hover:bg-surface-container-high focus-visible:bg-surface-container-high',
  focusRingInset,
);

/**
 * The shared, column-aligned entity table.
 *
 * @typeParam T - The row item type (a `ProjectOut`, `InitiativeOut`, or task view-model).
 *
 * @remarks
 * Renders `role="grid"`: a light `role="row"` header band of `role="columnheader"` cells (unless
 * `hideHeader`), then either flat data rows or grouped data rows. Each data row is `role="row"`
 * with `role="gridcell"` cells whose widths/alignment are locked to the header by the shared
 * {@link Column} sizing, so values line up. A data row is a `<button>`, an `<a href>` (when
 * `rowHref` returns a target), or a custom `renderRowLink` element. Keyboard navigation across the
 * flattened rows is owned by {@link useListKeyboard}.
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

  // Uncontrolled collapse, used only when `collapsed` is not supplied.
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

  // Flatten groups (or wrap the flat rows) into one linear array for keyboard navigation, omitting
  // the data rows of collapsed groups — the same model the ListView uses for tasks.
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

/** Props for the internal {@link EntityTableRow}. */
interface EntityTableRowProps<T> {
  columns: readonly Column<T>[];
  row: T;
  active: boolean;
  selected: boolean;
  href?: string;
  renderRowLink?: (props: EntityTableRowLinkProps) => React.ReactNode;
  onActivate?: () => void;
  onSelect?: () => void;
}

/**
 * One column-aligned data row of an {@link EntityTable}.
 *
 * @remarks
 * Renders the row chrome (`role="row"`, density, dividers, hover/active/selected tone, inset focus
 * ring) and the per-column `role="gridcell"` cells, whose width/alignment match the header exactly.
 * It is a `<button>` by default, an `<a href>` when `href` is set, or a custom `renderRowLink`
 * element (a router `Link`). Activating fires `onActivate` (open) and, when wired, `onSelect`.
 */
function EntityTableRow<T>({
  columns,
  row,
  active,
  selected,
  href,
  renderRowLink,
  onActivate,
  onSelect,
}: EntityTableRowProps<T>): React.JSX.Element {
  const rowClassName = cn(
    TABLE_ROW_BASE,
    TABLE_ROW_INTERACTIVE,
    (active || selected) && 'bg-surface-container-highest',
  );

  const handleClick = React.useCallback(() => {
    onSelect?.();
    onActivate?.();
  }, [onSelect, onActivate]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && href === undefined) {
        event.preventDefault();
        onSelect?.();
        onActivate?.();
      }
    },
    [href, onSelect, onActivate],
  );

  const cells = (
    <>
      {columns.map((column) => (
        <span
          key={column.key}
          role="gridcell"
          data-col={column.key}
          style={columnStyle(column)}
          className={columnClassName(column)}
        >
          {column.render(row)}
        </span>
      ))}
    </>
  );

  const ariaCurrent: 'true' | undefined = active ? 'true' : undefined;

  if (renderRowLink && href !== undefined) {
    return (
      <>
        {renderRowLink({
          href,
          className: rowClassName,
          onClick: handleClick,
          tabIndex: -1,
          'aria-current': ariaCurrent,
          children: cells,
        })}
      </>
    );
  }

  if (href !== undefined) {
    return (
      <a
        role="row"
        href={href}
        aria-current={ariaCurrent}
        aria-selected={selected || undefined}
        data-active={active ? '' : undefined}
        data-selected={selected ? '' : undefined}
        tabIndex={-1}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={rowClassName}
      >
        {cells}
      </a>
    );
  }

  return (
    <button
      type="button"
      role="row"
      aria-pressed={selected || undefined}
      data-active={active ? '' : undefined}
      data-selected={selected ? '' : undefined}
      tabIndex={-1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(rowClassName, 'text-left')}
    >
      {cells}
    </button>
  );
}
