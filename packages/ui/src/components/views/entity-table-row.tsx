'use client';

import * as React from 'react';

import { cn } from '../../lib/utils';
import { focusRingInset } from '../../primitives/focus';
import { surfaceToneColor } from '../../primitives/surface';

import type { Column, EntityTableRowLinkProps } from './entity-table-columns';
import type { EntityTableRowInteraction } from './EntityTable';
import type { EntityTableRowAria } from './EntityTable';
import { columnClassName, columnStyle } from './entity-table-columns';

/** The shared row chrome (density + dividers + the named container) — matches {@link ListRow}. */
const TABLE_ROW_BASE =
  'border-outline-variant relative flex min-h-(--row-h) w-full items-center gap-2 border-b px-3 py-(--row-py) text-body-medium last:border-b-0';

/** The interactive affordances for a data row — matches {@link ListRow}/{@link EntityListRow}. */
const TABLE_ROW_INTERACTIVE = cn(
  'cursor-pointer transition-colors outline-none hover:bg-surface-container-high focus-visible:bg-surface-container-high',
  focusRingInset,
);

/** Resolve the resting row surface without adding branching to the row renderer. */
function rowSurfaceTone(tone: 'outlined' | 'tonal'): string {
  return surfaceToneColor(tone === 'tonal' ? 'card' : 'page');
}

/** Resolve row state attributes outside the main renderer's branch budget. */
function rowStateDataAttributes(
  active: boolean,
  selected: boolean,
): {
  readonly 'data-active': '' | undefined;
  readonly 'data-selected': '' | undefined;
} {
  return {
    'data-active': active ? '' : undefined,
    'data-selected': selected ? '' : undefined,
  };
}

/** Props for the internal {@link EntityTableRow}. */
export interface EntityTableRowProps<T> {
  /** Stable DOM id used by the owning grid's `aria-activedescendant`. */
  id?: string | undefined;
  /** Logical one-based row position in the owning grid. */
  ariaRowIndex?: number | undefined;
  /** Stable flattened-entry key for diagnostics and interaction adapters. */
  entryKey?: string | undefined;
  /** Rendered minimum height shared with the table virtualizer estimate. */
  rowHeight: number;
  /** Optional caller-owned hierarchy metadata. */
  rowAria?: EntityTableRowAria | undefined;
  /** Surface treatment inherited from the owning table. */
  tone: 'outlined' | 'tonal';
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
  /** Dispatch a table-owned pointer selection command before row activation. */
  onSelectionCommand?: ((event: React.MouseEvent<HTMLElement>) => void) | undefined;
  /** Application-owned row selection/focus binding. */
  interaction?: EntityTableRowInteraction | undefined;
  /** When set, only this column renders the row href. */
  linkColumnKey?: string | undefined;
}

/** Build the shared DOM semantics used by every row element branch. */
function rowSemanticAttributes(
  id: string | undefined,
  ariaRowIndex: number | undefined,
  entryKey: string | undefined,
  rowHeight: number,
  rowAria: EntityTableRowAria | undefined,
): {
  readonly id: string | undefined;
  readonly role: 'row';
  readonly 'aria-rowindex': number | undefined;
  readonly 'aria-level': number | undefined;
  readonly 'aria-posinset': number | undefined;
  readonly 'aria-setsize': number | undefined;
  readonly 'aria-expanded': boolean | undefined;
  readonly 'data-entry-key': string | undefined;
  readonly 'data-row-height': number;
  readonly style: React.CSSProperties;
} {
  return {
    id,
    role: 'row',
    'aria-rowindex': ariaRowIndex,
    'aria-level': rowAria?.level,
    'aria-posinset': rowAria?.posInSet,
    'aria-setsize': rowAria?.setSize,
    'aria-expanded': rowAria?.expanded,
    'data-entry-key': entryKey,
    'data-row-height': rowHeight,
    style: { '--row-h': `${String(rowHeight)}px` } as React.CSSProperties,
  };
}

/** Fire the generic pointer selection command and legacy row actions in their existing order. */
function activateRowActions(
  event: React.MouseEvent<HTMLElement>,
  onSelectionCommand: ((event: React.MouseEvent<HTMLElement>) => void) | undefined,
  onSelect: (() => void) | undefined,
  onActivate: (() => void) | undefined,
): void {
  onSelectionCommand?.(event);
  onSelect?.();
  onActivate?.();
}

/** Handle Enter for non-link rows. */
function handleUnlinkedEnter(
  event: React.KeyboardEvent,
  href: string | undefined,
  onSelect: (() => void) | undefined,
  onActivate: (() => void) | undefined,
): void {
  if (event.key !== 'Enter' || href !== undefined) return;
  event.preventDefault();
  onSelect?.();
  onActivate?.();
}

/** Follow a row-body target while leaving nested controls in charge. */
function activateBodyTarget(
  event: React.MouseEvent<HTMLElement>,
  href: string | undefined,
  onSelect: (() => void) | undefined,
  onActivate: (() => void) | undefined,
): void {
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
}

/** Coordinate an application row binding with the table's body-link behavior. */
function handleLinkedBodyClick(
  event: React.MouseEvent<HTMLElement>,
  interaction: EntityTableRowInteraction | undefined,
  onSelectionCommand: ((event: React.MouseEvent<HTMLElement>) => void) | undefined,
  activateBody: (event: React.MouseEvent<HTMLElement>) => void,
): void {
  interaction?.rowProps.onClick?.(event);
  if (event.defaultPrevented) return;
  const nestedControl = (event.target as HTMLElement).closest(
    'a, button, input, textarea, select, [contenteditable="true"], [role="button"]',
  );
  if (nestedControl === null || nestedControl === event.currentTarget) {
    onSelectionCommand?.(event);
  }
  if (interaction === undefined || event.metaKey || event.ctrlKey || event.shiftKey) {
    activateBody(event);
  }
}

/** Activate a linked body row from the table-owned Enter handler. */
function handleLinkedBodyEnter(
  event: React.KeyboardEvent<HTMLElement>,
  href: string | undefined,
  onSelect: (() => void) | undefined,
  onActivate: (() => void) | undefined,
): void {
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
}

/** Render one shared column sequence for a data row. */
function EntityTableCells<T>({
  columns,
  row,
  href,
  renderRowLink,
  linkColumnKey,
  onActivate,
  onRowPrefetch,
}: Pick<
  EntityTableRowProps<T>,
  'columns' | 'row' | 'href' | 'renderRowLink' | 'linkColumnKey' | 'onActivate' | 'onRowPrefetch'
>): React.JSX.Element {
  return (
    <>
      {columns.map((column) => {
        const content = column.render(row);
        const linked = href !== undefined && column.key === linkColumnKey;
        let cellContent = content;
        if (linked && renderRowLink) {
          cellContent = renderRowLink({
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
          });
        } else if (linked) {
          cellContent = (
            <a
              href={href}
              className="min-w-0 truncate rounded-sm outline-none focus-visible:ring-2"
              onClick={() => onActivate?.()}
              onMouseEnter={onRowPrefetch}
              onFocus={onRowPrefetch}
            >
              {content}
            </a>
          );
        }
        return (
          <span
            key={column.key}
            role="gridcell"
            data-col={column.key}
            style={columnStyle(column)}
            className={columnClassName(column)}
          >
            {cellContent}
          </span>
        );
      })}
    </>
  );
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
  entryKey,
  rowHeight,
  rowAria,
  tone,
  columns,
  row,
  active,
  selected,
  href,
  renderRowLink,
  onRowPrefetch,
  onActivate,
  onSelect,
  onSelectionCommand,
  interaction,
  linkColumnKey,
}: EntityTableRowProps<T>): React.JSX.Element {
  const rowClassName = cn(
    rowSurfaceTone(tone),
    TABLE_ROW_BASE,
    TABLE_ROW_INTERACTIVE,
    // Explicit selection takes the indigo tonal fill; the roving keyboard cursor stays neutral
    // (its inset focus ring already marks it) so a dense table never over-colors.
    selected && 'bg-secondary-container',
    active && !selected && 'bg-surface-container-highest',
  );

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      activateRowActions(event, onSelectionCommand, onSelect, onActivate);
    },
    [onSelectionCommand, onSelect, onActivate],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      handleUnlinkedEnter(event, href, onSelect, onActivate);
    },
    [href, onSelect, onActivate],
  );

  const activateBodyHref = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      activateBodyTarget(event, href, onSelect, onActivate);
    },
    [href, onActivate, onSelect],
  );

  const cells = (
    <EntityTableCells
      columns={columns}
      row={row}
      href={href}
      renderRowLink={renderRowLink}
      linkColumnKey={linkColumnKey}
      onActivate={onActivate}
      onRowPrefetch={onRowPrefetch}
    />
  );

  const ariaCurrent: 'true' | undefined = active ? 'true' : undefined;
  const semantics = rowSemanticAttributes(id, ariaRowIndex, entryKey, rowHeight, rowAria);
  const stateDataAttributes = rowStateDataAttributes(active, selected);

  if (linkColumnKey !== undefined) {
    return (
      <div
        {...interaction?.rowProps}
        {...semantics}
        {...stateDataAttributes}
        ref={interaction?.interactionRef}
        aria-current={ariaCurrent}
        className={cn(rowClassName, 'group/row', interaction?.className)}
        onClick={(event) => {
          handleLinkedBodyClick(event, interaction, onSelectionCommand, activateBodyHref);
        }}
        onAuxClick={(event) => {
          if (event.button === 1) activateBodyHref(event);
        }}
        onKeyDown={(event) => {
          handleLinkedBodyEnter(event, href, onSelect, onActivate);
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
          ...semantics,
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
        {...semantics}
        {...stateDataAttributes}
        href={href}
        aria-current={ariaCurrent}
        aria-selected={selected || undefined}
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
      {...semantics}
      {...stateDataAttributes}
      type="button"
      aria-pressed={selected || undefined}
      aria-current={ariaCurrent}
      tabIndex={-1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(rowClassName, 'text-left')}
    >
      {cells}
    </button>
  );
}
