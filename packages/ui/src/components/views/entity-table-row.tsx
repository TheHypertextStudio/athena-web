'use client';

import * as React from 'react';

import { cn } from '../../lib/utils';
import { focusRingInset } from '../../primitives/focus';

import type { Column, EntityTableRowLinkProps } from './entity-table-columns';
import { columnClassName, columnStyle } from './entity-table-columns';

/** The shared row chrome (density + dividers + the named container) — matches {@link ListRow}. */
const TABLE_ROW_BASE =
  'border-outline-variant relative flex min-h-(--row-h) w-full items-center gap-2 border-b px-3 py-(--row-py) text-body-medium last:border-b-0';

/** The interactive affordances for a data row — matches {@link ListRow}/{@link EntityListRow}. */
const TABLE_ROW_INTERACTIVE = cn(
  'cursor-pointer transition-colors outline-none hover:bg-surface-container-high focus-visible:bg-surface-container-high',
  focusRingInset,
);

/** Props for the internal {@link EntityTableRow}. */
export interface EntityTableRowProps<T> {
  columns: readonly Column<T>[];
  row: T;
  active: boolean;
  selected: boolean;
  href?: string;
  renderRowLink?: (props: EntityTableRowLinkProps) => React.ReactNode;
  /** Warm the row's destination cache on hover/focus (bound to this row by EntityTable). */
  onRowPrefetch?: () => void;
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
export function EntityTableRow<T>({
  columns,
  row,
  active,
  selected,
  href,
  renderRowLink,
  onRowPrefetch,
  onActivate,
  onSelect,
}: EntityTableRowProps<T>): React.JSX.Element {
  const rowClassName = cn(
    TABLE_ROW_BASE,
    TABLE_ROW_INTERACTIVE,
    // Explicit selection takes the indigo tonal fill; the roving keyboard cursor stays neutral
    // (its inset focus ring already marks it) so a dense table never over-colors.
    selected && 'bg-secondary-container',
    active && !selected && 'bg-surface-container-highest',
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
          onMouseEnter: onRowPrefetch,
          onFocus: onRowPrefetch,
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
        onMouseEnter={onRowPrefetch}
        onFocus={onRowPrefetch}
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
