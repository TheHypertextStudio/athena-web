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
import { surfaceToneColor } from '../../primitives/surface';
import { useListKeyboard } from '../../hooks/useListKeyboard';
import { type Density, useDensity } from '../shell/ContextProvider';
import { DENSITY_ROW_HEIGHT } from './flatten-groups';
import { GroupHeader } from './GroupHeader';

import type { Column, ColumnPriority, EntityTableRowLinkProps } from './entity-table-columns';
import { columnClassName, columnStyle } from './entity-table-columns';
import type {
  EntityTableContinuation,
  EntityTableContinuationBase,
  EntityTableGroup,
  EntityTableGroupBase,
  FlatEntityTableEntry,
} from './entity-table-groups';
import { flattenEntityTableEntries } from './entity-table-groups';
import { EntityTableRow } from './entity-table-row';

export type { Column, ColumnPriority, EntityTableRowLinkProps };
export type {
  EntityTableContinuation,
  EntityTableContinuationBase,
  EntityTableGroup,
  EntityTableGroupBase,
};

/** Modifier state attached to a table-owned selection command. */
export interface EntityTableSelectionModifiers {
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

/** A generic selection intent emitted against the table's flattened eligible order. */
export interface EntityTableSelectionCommand {
  readonly command:
    'replace' | 'toggle' | 'range' | 'move-active' | 'extend-active' | 'select-all' | 'clear';
  readonly activeEntryKey: string | null;
  readonly targetSelectionKey: string | null;
  readonly anchorSelectionKey: string | null;
  readonly orderedSelectionKeys: readonly string[];
  readonly modifiers: EntityTableSelectionModifiers;
}

/** Caller-owned hierarchy metadata for one data row. */
export interface EntityTableRowAria {
  readonly level: number;
  readonly posInSet: number;
  readonly setSize: number;
  readonly expanded?: boolean;
}

/** Pointer, selection, and drag/drop props an application can inject without taking focus. */
export interface EntityTableRowInteraction {
  readonly selected: boolean;
  /** Register drag/drop behavior without supplying a focus-management ref. */
  readonly interactionRef?: ((element: HTMLElement | null) => void) | undefined;
  readonly rowProps: Omit<
    React.HTMLAttributes<HTMLElement>,
    'aria-activedescendant' | 'onKeyDown' | 'role' | 'tabIndex'
  > & {
    readonly 'aria-selected': boolean;
    readonly 'data-selected': boolean;
    readonly [key: `data-${string}`]: string | number | boolean | undefined;
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
  /** Surface treatment. The current outlined table remains the default. */
  tone?: 'outlined' | 'tonal' | undefined;
  /** Grid semantics for flat or hierarchical rosters. */
  gridRole?: 'grid' | 'treegrid' | undefined;
  /** Supply hierarchy metadata without coupling this package to a domain model. */
  getRowAria?: ((row: T) => EntityTableRowAria) | undefined;
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
  /** Inject application-owned row selection, pointer, and drag/drop behavior. */
  renderRowInteraction?:
    ((props: EntityTableRowInteractionProps<T>) => React.ReactNode) | undefined;
  /** Restrict `rowHref` navigation to this column instead of making the whole row a link. */
  rowLinkColumnKey?: string | undefined;
  /** Application-owned non-keyboard props/ref merged onto the grid container. */
  containerInteraction?:
    | (Omit<
        React.HTMLAttributes<HTMLDivElement>,
        'aria-activedescendant' | 'onKeyDown' | 'role' | 'tabIndex'
      > & {
        readonly ref?: ((element: HTMLElement | null) => void) | undefined;
      })
    | undefined;
  /** The currently selected row keys (controlled). */
  selected?: ReadonlySet<string> | undefined;
  /** Toggle a row's selection (controlled). */
  onSelect?: ((row: T, next: boolean) => void) | undefined;
  /** Resolve the application selection identity for eligible data rows. */
  getRowSelectionKey?: ((row: T) => string | undefined) | undefined;
  /** Current application-owned range-selection anchor. */
  selectionAnchorKey?: string | null | undefined;
  /** Receive table-owned pointer and keyboard selection commands. */
  onSelectionCommand?: ((command: EntityTableSelectionCommand) => void) | undefined;
  /** Receive the active flattened-entry key after table navigation changes it. */
  onActiveEntryChange?: ((entryKey: string | null) => void) | undefined;
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
  /** Row minimum and matching virtualizer estimate. Defaults to the shared density. */
  rowHeight?: number | undefined;
  /** Called when the virtual viewport reaches the final 12 loaded entries. */
  onEndReached?: (() => void) | undefined;
  /** Typed root-page continuation included in keyboard navigation and virtualization. */
  continuation?: EntityTableContinuation | undefined;
  /** Content rendered after the final virtual row, such as loading state or Retry. */
  endAdornment?: React.ReactNode;
  /** Accessible label for the grid. */
  'aria-label'?: string | undefined;
  /** Extra classes merged onto the table's outer (scroll) container. */
  className?: string | undefined;
}

/** Resolve the resting table surface for one presentation tone. */
function tableSurfaceTone(tone: 'outlined' | 'tonal'): string {
  return surfaceToneColor(tone === 'tonal' ? 'card' : 'page');
}

/** Resolve a row estimate from an explicit value or shared density. */
function entityTableRowHeight(rowHeight: number | undefined, density: Density): number {
  return rowHeight ?? DENSITY_ROW_HEIGHT[density];
}

/** Count the items owned by the virtualizer without adding display-only content to navigation. */
function entityTableVirtualCount(
  virtualized: boolean,
  entryCount: number,
  hasEndAdornment: boolean,
): number {
  if (!virtualized) return 0;
  return entryCount + (hasEndAdornment ? 1 : 0);
}

/** Derive selectable data-row order from the complete flattened entry sequence. */
function orderedEntityTableSelectionKeys<T>(
  flat: readonly FlatEntityTableEntry<T>[],
  getRowSelectionKey: ((row: T) => string | undefined) | undefined,
): string[] {
  if (getRowSelectionKey === undefined) return [];
  return flat.flatMap((entry) => {
    if (entry.kind !== 'row') return [];
    const key = getRowSelectionKey(entry.row);
    return key === undefined ? [] : [key];
  });
}

/** Find the closest key that remains after a flattened entry disappears. */
function nearestSurvivingEntityTableKey(
  previousKeys: readonly string[],
  currentKeys: ReadonlySet<string>,
  removedKey: string,
): string | undefined {
  const previousIndex = previousKeys.indexOf(removedKey);
  for (let distance = 1; previousIndex >= 0 && distance < previousKeys.length; distance += 1) {
    const after = previousKeys[previousIndex + distance];
    if (after !== undefined && currentKeys.has(after)) return after;
    const before = previousKeys[previousIndex - distance];
    if (before !== undefined && currentKeys.has(before)) return before;
  }
  return undefined;
}

/** Resolve table chrome classes from the two public presentation switches. */
function entityTableClassName(
  tone: 'outlined' | 'tonal',
  virtualized: boolean,
  className: string | undefined,
): string {
  return cn(
    tableSurfaceTone(tone),
    '@container/table flex w-full flex-col overflow-x-auto rounded-xl outline-none',
    tone === 'outlined' && 'border-outline-variant border',
    virtualized ? 'relative h-full min-h-0 overflow-y-auto' : 'overflow-y-hidden',
    focusRingInset,
    className,
  );
}

/** Resolve root grid metadata from the header and active entry. */
function entityTableRootAria(
  entryCount: number,
  hideHeader: boolean,
  activeIndex: number,
  rowDomId: (index: number) => string,
): { readonly rowCount: number; readonly activeDescendant: string | undefined } {
  return {
    rowCount: entryCount + (hideHeader ? 0 : 1),
    activeDescendant: activeIndex < 0 ? undefined : rowDomId(activeIndex),
  };
}

/** Render the sticky column header inside the table scrollport. */
function EntityTableHeader<T>({
  columns,
  hidden,
  tone,
}: {
  readonly columns: readonly Column<T>[];
  readonly hidden: boolean;
  readonly tone: 'outlined' | 'tonal';
}): React.JSX.Element | null {
  if (hidden) return null;
  return (
    <div
      role="row"
      aria-rowindex={1}
      className={cn(
        tableSurfaceTone(tone),
        'border-outline-variant text-on-surface-variant sticky top-0 z-10 flex min-h-8 w-full shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs font-medium select-none',
      )}
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
  );
}

/** Render virtual and non-virtual entries through the same entry renderer. */
function EntityTableBody<T>({
  virtualized,
  flat,
  virtualItems,
  totalSize,
  measureElement,
  renderEntry,
  endAdornment,
}: {
  readonly virtualized: boolean;
  readonly flat: readonly FlatEntityTableEntry<T>[];
  readonly virtualItems: readonly { readonly index: number; readonly start: number }[];
  readonly totalSize: number;
  readonly measureElement: (element: Element | null) => void;
  readonly renderEntry: (entry: FlatEntityTableEntry<T>, index: number) => React.ReactNode;
  readonly endAdornment: React.ReactNode;
}): React.JSX.Element {
  if (!virtualized) {
    return (
      <>
        {flat.map(renderEntry)}
        {endAdornment}
      </>
    );
  }
  return (
    <div role="rowgroup" style={{ height: totalSize, width: '100%', position: 'relative' }}>
      {virtualItems.map((virtualRow) => {
        const entry = flat[virtualRow.index];
        return (
          <div
            key={entry?.key ?? '__end_adornment__'}
            role="presentation"
            data-index={virtualRow.index}
            ref={measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${String(virtualRow.start)}px)`,
            }}
          >
            {entry ? renderEntry(entry, virtualRow.index) : endAdornment}
          </div>
        );
      })}
    </div>
  );
}

/** Render one typed continuation as a keyboard-indexed grid row. */
function EntityTableContinuationEntry({
  entry,
  id,
  ariaRowIndex,
  active,
  rowHeight,
  onActivate,
}: {
  readonly entry: Extract<FlatEntityTableEntry<unknown>, { readonly kind: 'continuation' }>;
  readonly id: string;
  readonly ariaRowIndex: number;
  readonly active: boolean;
  readonly rowHeight: number;
  readonly onActivate: () => void;
}): React.JSX.Element {
  const loading = entry.continuation.state === 'loading';
  return (
    <div
      id={id}
      role="row"
      aria-rowindex={ariaRowIndex}
      aria-current={active ? 'true' : undefined}
      data-active={active ? '' : undefined}
      data-entry-key={entry.key}
      data-row-height={rowHeight}
      style={{ '--row-h': `${String(rowHeight)}px` } as React.CSSProperties}
      className={cn(
        'border-outline-variant flex min-h-(--row-h) w-full items-center border-b px-3 py-(--row-py)',
        active && 'bg-surface-container-highest',
      )}
    >
      <div role="gridcell" className="min-w-0 flex-1">
        <button
          id={entry.continuation.id}
          type="button"
          tabIndex={-1}
          disabled={loading}
          aria-disabled={loading ? 'true' : undefined}
          aria-busy={loading ? 'true' : undefined}
          className="text-label-medium text-primary rounded-sm px-2 py-1 text-left outline-none hover:underline disabled:cursor-wait disabled:no-underline"
          onClick={loading ? undefined : onActivate}
        >
          {entry.continuation.label}
        </button>
      </div>
    </div>
  );
}

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
  tone = 'outlined',
  gridRole = 'grid',
  getRowAria,
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
  getRowSelectionKey,
  selectionAnchorKey = null,
  onSelectionCommand,
  onActiveEntryChange,
  collapsed: collapsedProp,
  onToggleGroup,
  defaultCollapsed,
  hideHeader = false,
  virtualized = false,
  rowHeight,
  onEndReached,
  continuation,
  endAdornment,
  'aria-label': ariaLabel,
  className,
}: EntityTableProps<T>): React.JSX.Element {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const density = useDensity();
  const resolvedRowHeight = entityTableRowHeight(rowHeight, density);
  const rowIdPrefix = React.useId().replaceAll(':', '');
  const activeKeyRef = React.useRef<string | null>(null);
  const previousFlatKeysRef = React.useRef<readonly string[]>([]);

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

  const flat = React.useMemo<FlatEntityTableEntry<T>[]>(
    () =>
      flattenEntityTableEntries({ rows, groups, continuation, collapsed: collapsedSet, getRowKey }),
    [groups, rows, continuation, collapsedSet, getRowKey],
  );

  const virtualCount = entityTableVirtualCount(
    virtualized,
    flat.length,
    endAdornment !== undefined,
  );
  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => resolvedRowHeight,
    overscan: 12,
    enabled: virtualized,
    getItemKey: (index) => flat[index]?.key ?? '__end_adornment__',
  });

  const orderedSelectionKeys = React.useMemo(
    () => orderedEntityTableSelectionKeys(flat, getRowSelectionKey),
    [flat, getRowSelectionKey],
  );

  const selectionKeyAt = React.useCallback(
    (index: number): string | null => {
      const entry = flat[index];
      if (entry?.kind !== 'row' || getRowSelectionKey === undefined) return null;
      return getRowSelectionKey(entry.row) ?? null;
    },
    [flat, getRowSelectionKey],
  );

  const emitSelectionCommand = React.useCallback(
    (
      command: EntityTableSelectionCommand['command'],
      index: number,
      event: {
        readonly shiftKey?: boolean;
        readonly metaKey?: boolean;
        readonly ctrlKey?: boolean;
      },
    ) => {
      onSelectionCommand?.({
        command,
        activeEntryKey: flat[index]?.key ?? null,
        targetSelectionKey: selectionKeyAt(index),
        anchorSelectionKey: selectionAnchorKey,
        orderedSelectionKeys,
        modifiers: {
          shiftKey: event.shiftKey ?? false,
          metaKey: event.metaKey ?? false,
          ctrlKey: event.ctrlKey ?? false,
        },
      });
    },
    [flat, onSelectionCommand, orderedSelectionKeys, selectionAnchorKey, selectionKeyAt],
  );

  React.useEffect(() => {
    if (virtualized) virtualizer.measure();
  }, [virtualized, virtualizer, flat.length, resolvedRowHeight]);

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
      if (entry.kind === 'group') {
        toggleGroup(entry.group.id);
      } else if (entry.kind === 'continuation') {
        if (entry.continuation.state !== 'loading') entry.continuation.onActivate();
      } else if (onRowClick) {
        onRowClick(entry.row);
      } else {
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
      onActiveEntryChange?.(activeKeyRef.current);
      if (virtualized) virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    onMove: (index, event) => {
      emitSelectionCommand(event.shiftKey ? 'extend-active' : 'move-active', index, event);
    },
    onToggle: (index, event) => {
      emitSelectionCommand('toggle', index, event);
    },
    onSelectAll: (index, event) => {
      emitSelectionCommand('select-all', index, event);
    },
    onClear: (index, event) => {
      emitSelectionCommand('clear', index, event);
      onActiveEntryChange?.(null);
    },
  });

  React.useEffect(() => {
    const activeKey = activeKeyRef.current;
    const previousKeys = previousFlatKeysRef.current;
    const currentKeys = flat.map(({ key }) => key);
    previousFlatKeysRef.current = currentKeys;
    if (activeKey === null) return;
    const nextIndex = flat.findIndex((entry) => entry.key === activeKey);
    if (nextIndex < 0) {
      const nearestKey = nearestSurvivingEntityTableKey(
        previousKeys,
        new Set(currentKeys),
        activeKey,
      );
      const fallbackIndex = Math.min(Math.max(activeIndex, 0), flat.length - 1);
      const replacementIndex =
        nearestKey === undefined ? fallbackIndex : flat.findIndex(({ key }) => key === nearestKey);
      const replacement = flat[replacementIndex];
      activeKeyRef.current = replacement?.key ?? null;
      if (replacement === undefined) onActiveEntryChange?.(null);
      setActiveIndex(replacement === undefined ? -1 : replacementIndex);
    } else if (nextIndex !== activeIndex) {
      setActiveIndex(nextIndex);
    }
  }, [activeIndex, flat, onActiveEntryChange, setActiveIndex]);

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
      onKeyDown(event);
      if (event.key === 'Escape') activeKeyRef.current = null;
    },
    [onKeyDown],
  );

  const renderFlatEntry = (entry: FlatEntityTableEntry<T>, index: number): React.ReactNode => {
    const ariaRowIndex = index + (hideHeader ? 1 : 2);
    const id = rowDomId(index);
    if (entry.kind === 'group') {
      return (
        <GroupHeader
          key={entry.key}
          id={id}
          aria-rowindex={ariaRowIndex}
          entryKey={entry.key}
          label={entry.group.label}
          decoration={entry.group.decoration}
          count={entry.count}
          level={entry.level}
          rowHeight={resolvedRowHeight}
          expanded={!collapsedSet.has(entry.group.id)}
          onToggle={() => {
            toggleGroup(entry.group.id);
          }}
          className={cn(activeIndex === index && 'bg-surface-container-high')}
        />
      );
    }
    if (entry.kind === 'continuation') {
      return (
        <EntityTableContinuationEntry
          key={entry.key}
          entry={entry}
          id={id}
          ariaRowIndex={ariaRowIndex}
          active={activeIndex === index}
          rowHeight={resolvedRowHeight}
          onActivate={() => {
            setActiveIndex(index);
            if (entry.continuation.state !== 'loading') entry.continuation.onActivate();
          }}
        />
      );
    }
    const key = getRowKey(entry.row);
    const selectionKey = getRowSelectionKey?.(entry.row) ?? key;
    const renderRow = (interaction?: EntityTableRowInteraction): React.ReactNode => (
      <EntityTableRow
        key={entry.key}
        id={id}
        ariaRowIndex={ariaRowIndex}
        entryKey={entry.key}
        rowHeight={resolvedRowHeight}
        rowAria={getRowAria?.(entry.row)}
        tone={tone}
        columns={columns}
        row={entry.row}
        active={activeIndex === index}
        selected={interaction?.selected ?? selected?.has(selectionKey) ?? false}
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
        onSelectionCommand={
          onSelectionCommand
            ? (event) => {
                setActiveIndex(index);
                const command = event.shiftKey
                  ? 'range'
                  : event.metaKey || event.ctrlKey
                    ? 'toggle'
                    : 'replace';
                emitSelectionCommand(command, index, event);
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
  const rootAria = entityTableRootAria(flat.length, hideHeader, activeIndex, rowDomId);

  return (
    <div
      {...containerInteraction}
      ref={setScrollElement}
      role={gridRole}
      aria-label={ariaLabel}
      aria-rowcount={rootAria.rowCount}
      aria-activedescendant={rootAria.activeDescendant}
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
      className={entityTableClassName(tone, virtualized, className)}
    >
      <EntityTableHeader columns={columns} hidden={hideHeader} tone={tone} />
      <EntityTableBody
        virtualized={virtualized}
        flat={flat}
        virtualItems={virtualItems}
        totalSize={virtualizer.getTotalSize()}
        measureElement={virtualizer.measureElement}
        renderEntry={renderFlatEntry}
        endAdornment={endAdornment}
      />
    </div>
  );
}
