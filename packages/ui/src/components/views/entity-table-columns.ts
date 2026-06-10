import type * as React from 'react';

import { cn } from '../../lib/utils';

/**
 * A column priority tier, driving responsive column hiding.
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
  /** The header label shown in the light header band. */
  header: React.ReactNode;
  /** Render this column's cell for a row. */
  render: (row: T) => React.ReactNode;
  /** Horizontal alignment of the header + cells. Defaults to `'start'`. */
  align?: 'start' | 'center' | 'end';
  /** Fixed width (any CSS length). Mutually exclusive with `minWidth` — `width` wins. */
  width?: string;
  /** Minimum width (any CSS length); the column may grow past it. */
  minWidth?: string;
  /**
   * Mark the *title* column: it flexes to fill (`flex-1`), truncates, and is never hidden.
   * Exactly one column should set this.
   */
  flex?: boolean;
  /** The responsive priority tier. Defaults to `1`. */
  priority?: ColumnPriority;
  /** Whether this column is sortable. */
  sortable?: boolean;
  /** Extra classes merged onto every cell (and the header) of this column. */
  className?: string;
}

/** The props an {@link EntityTableProps.renderRowLink} slot receives. */
export interface EntityTableRowLinkProps {
  href: string;
  className: string;
  onClick: () => void;
  tabIndex: number;
  'aria-current': 'true' | undefined;
  children: React.ReactNode;
}

/** Justify-content utility for a column's alignment. */
export const ALIGN_JUSTIFY: Record<NonNullable<Column<unknown>['align']>, string> = {
  start: 'justify-start text-left',
  center: 'justify-center text-center',
  end: 'justify-end text-right',
};

/** The container-query visibility utility for a column priority tier. */
export function priorityVisibility(priority: ColumnPriority): string {
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
export function effectivePriority<T>(column: Column<T>): ColumnPriority {
  if (column.flex) return 'always';
  return column.priority ?? 1;
}

/** The shared per-cell sizing/alignment style for a column (header + body stay in lockstep). */
export function columnStyle<T>(column: Column<T>): React.CSSProperties {
  if (column.flex) return { flex: '1 1 0%', minWidth: 0 };
  if (column.width !== undefined) return { width: column.width, flex: `0 0 ${column.width}` };
  if (column.minWidth !== undefined) return { minWidth: column.minWidth };
  return {};
}

/** The shared per-cell layout class for a column (header + body stay in lockstep). */
export function columnClassName<T>(column: Column<T>): string {
  return cn(
    'flex min-w-0 shrink-0 items-center',
    column.flex && 'min-w-0 flex-1 shrink',
    ALIGN_JUSTIFY[column.align ?? 'start'],
    priorityVisibility(effectivePriority(column)),
    column.className,
  );
}
