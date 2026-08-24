'use client';

import * as React from 'react';

import { cn } from '../../lib/utils';
import { focusRingInset } from '../../primitives/focus';

import type { Column, EntityTableRowLinkProps } from './entity-table-columns';
import type { EntityTableRowInteraction } from './EntityTable';
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
  /** Stable DOM id used by the owning grid's `aria-activedescendant`. */
  id?: string | undefined;
  /** Logical one-based row position in the owning grid. */
  ariaRowIndex?: number | undefined;
  columns: readonly Column<T>[];
  row: T;
  active: boolean;
  selected: boolean;
  href?: string | undefined;
  renderRowLink?: ((props: EntityTableRowLinkProps) => React.ReactNode) | undefined;
  /** Warm the row's destination cache on hover/focus (bound to this row by EntityTable). */
  onRowPrefetch?: (() => void) | undefined;
  onActivate?: (() => void) | undefined;
  onSelect?: (() => void) | undefined;
  /** Application-owned row selection/focus binding. */
  interaction?: EntityTableRowInteraction | undefined;
  /** When set, only this column renders the row href. */
  linkColumnKey?: string | undefined;
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
  id,
  ariaRowIndex,
  columns,
  row,
  active,
  selected,
  href,
  renderRowLink,
  onRowPrefetch,
  onActivate,
  onSelect,
  interaction,
  linkColumnKey,
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

  const activateBodyHref = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const control = (event.target as HTMLElement).closest(
        'a, button, input, textarea, select, [contenteditable="true"], [role="button"]',
      );
      if (control !== null && control !== event.currentTarget) return;
      const opensNewTab = event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey;
      if (opensNewTab && href) {
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.click();
        return;
      }
      onSelect?.();
      onActivate?.();
      if (!href || onActivate) return;
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.click();
    },
    [href, onActivate, onSelect],
  );

  const cells = (
    <>
      {columns.map((column) => {
        const content = column.render(row);
        const linked = href !== undefined && column.key === linkColumnKey;
        const link = linked
          ? renderRowLink
            ? renderRowLink({
                href,
                className: 'min-w-0 truncate rounded-sm outline-none focus-visible:ring-2',
                onClick: () => {
                  onActivate?.();
                },
                onMouseEnter: onRowPrefetch,
                onFocus: onRowPrefetch,
                tabIndex: 0,
                'aria-current': undefined,
                children: content,
              })
            : React.createElement(
                'a',
                {
                  href,
                  className: 'min-w-0 truncate rounded-sm outline-none focus-visible:ring-2',
                  onClick: () => onActivate?.(),
                  onMouseEnter: onRowPrefetch,
                  onFocus: onRowPrefetch,
                },
                content,
              )
          : content;
        return (
          <span
            key={column.key}
            role="gridcell"
            data-col={column.key}
            style={columnStyle(column)}
            className={columnClassName(column)}
          >
            {link}
          </span>
        );
      })}
    </>
  );

  const ariaCurrent: 'true' | undefined = active ? 'true' : undefined;

  if (linkColumnKey !== undefined) {
    return (
      <div
        {...interaction?.rowProps}
        id={id}
        role="row"
        aria-rowindex={ariaRowIndex}
        aria-current={ariaCurrent}
        className={cn(rowClassName, 'group/row', interaction?.className)}
        onClick={(event) => {
          interaction?.rowProps.onClick(event);
          if (event.defaultPrevented) return;
          if (interaction === undefined) {
            activateBodyHref(event);
            return;
          }
          if (event.metaKey || event.ctrlKey || event.shiftKey) activateBodyHref(event);
        }}
        onAuxClick={(event) => {
          if (event.button === 1) activateBodyHref(event);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.defaultPrevented) return;
          const control = (event.target as HTMLElement).closest(
            'a, button, input, textarea, select, [contenteditable="true"], [role="button"]',
          );
          if (control !== null && control !== event.currentTarget) return;
          event.preventDefault();
          onSelect?.();
          onActivate?.();
          if (!href || onActivate) return;
          const anchor = document.createElement('a');
          anchor.href = href;
          anchor.click();
        }}
      >
        {cells}
      </div>
    );
  }

  if (renderRowLink && href !== undefined) {
    return (
      <>
        {renderRowLink({
          id,
          role: 'row',
          'aria-rowindex': ariaRowIndex,
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
        id={id}
        role="row"
        aria-rowindex={ariaRowIndex}
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
      id={id}
      type="button"
      role="row"
      aria-rowindex={ariaRowIndex}
      aria-pressed={selected || undefined}
      aria-current={ariaCurrent}
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
