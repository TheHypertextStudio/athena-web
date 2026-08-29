'use client';

/**
 * `@docket/ui` — the searchable, keyboard-navigable listbox that lives inside a picker popover.
 *
 * @remarks
 * The shared engine behind the searchable pickers (actor / entity / labels). It renders a
 * filter `<input>` and a roving `listbox` of {@link PickerOption}s, owns the query + active
 * (keyboard-highlighted) index, and reports a selection through `onSelect`. The focus owner uses
 * `aria-activedescendant` to identify that active row instead of drawing a ring around the whole
 * list. Single-select pickers close the popover on select (the caller flips `open`). Multi-select
 * pickers keep it open and reflect the `selected` set with a trailing check. The list uses plain
 * DOM instead of a Radix menu, so it composes inside {@link PopoverContent} without fighting the
 * menu typeahead. Empty states and a "Clear" affordance keep it Linear-calm.
 *
 * ## One row family, not two
 *
 * This is the "select" member of the menu family — {@link DropdownMenuItem} and
 * {@link ContextMenuItem} are the other two — and it renders from the same `menuItemClass` they
 * do.
 *
 * Rows also reserve a fixed leading-icon column whenever *any* option in the list carries one, so
 * an icon-less row still lines up under an icon-bearing sibling instead of starting flush left.
 * `DropdownMenuContent`/`ContextMenuContent` get the equivalent for free from a `:has()` rule in
 * `globals.css` keyed off `role="menu"`/`role="menuitem"`; this list uses plain `listbox`/`option`
 * roles and heterogeneous icon content (an avatar image, a color swatch, a multi-bar glyph — not
 * reliably a bare `<svg>`), so the same reservation is computed here instead.
 */
import * as React from 'react';

import { Check, Plus, Search, X } from '../../icons';
import { cn } from '../../lib/utils';
import { Skeleton } from '../../primitives';
import { MENU_METRICS, menuItemClass, menuSupporting } from '../../primitives/menu-styles';

import { type PickerOption, optionMatches } from './types';

/**
 * Row metrics for the "clear" row and every option row.
 *
 * @remarks
 * `menuItemClass` verbatim, plus the two things a button nested inside a `role="option"` needs that
 * a Radix `role="menuitem"` does not: full width, and `disabled:` rather than `data-[disabled]:`
 * for the state layer, because this row is a real disabled button.
 */
const PICKER_ROW_DENSITY =
  'min-h-9 gap-2 px-3 py-1.5 coarse:min-h-11 coarse:gap-3 coarse:px-4 coarse:py-2';

/** Resolve one picker row's compact pointer-aware metrics and selection colors. */
function pickerRowClass(selected = false): string {
  return cn(
    menuItemClass('standard', selected ? { selected: true } : undefined),
    PICKER_ROW_DENSITY,
    'w-full text-left disabled:pointer-events-none disabled:opacity-38',
  );
}

/** Fit edge rows to the menu's 12dp inner corner while keeping internal corners at 4dp. */
function pickerRowShape(index: number, rowCount: number, searchable: boolean): string {
  return cn(
    !searchable && index === 0 && 'rounded-t-corner-md',
    index === rowCount - 1 && 'rounded-b-corner-md',
  );
}

interface PickerRow<TValue extends string> {
  kind: 'clear' | 'option' | 'create';
  option?: PickerOption<TValue>;
}

type ActiveSyncMode = 'navigation' | 'query' | 'selection';

/** Return a stable DOM id for one row in the listbox. */
function pickerRowId<TValue extends string>(listId: string, row: PickerRow<TValue>): string {
  return `${listId}-option-${pickerRowKey(row)}`;
}

/** Return the stable identity used to preserve an active row through reordering. */
function pickerRowKey<TValue extends string>(row: PickerRow<TValue>): string {
  return row.option ? `value-${encodeURIComponent(row.option.value)}` : row.kind;
}

/** The menu focus indicator applied to the row named by `aria-activedescendant`. */
const ACTIVE_PICKER_ROW = 'ring-[3px] ring-ring ring-inset' as const;

/** Props for {@link PickerList}. */
export interface PickerListProps<TValue extends string = string> {
  /** The full set of choices (already vocabulary-skinned / resolved by the caller). */
  options: readonly PickerOption<TValue>[];
  /** The currently-selected value(s): a single value for single-select, a set for multi. */
  selected: TValue | readonly TValue[] | null;
  /** Report a chosen option's value (multi-select toggles; single-select sets). */
  onSelect: (value: TValue) => void;
  /** When `true`, render trailing checks and keep selection open for multiple picks. */
  multiple?: boolean | undefined;
  /** Hide the search input (for short, unsearchable lists). Defaults to showing it. */
  searchable?: boolean | undefined;
  /** Placeholder for the search input. */
  searchPlaceholder?: string | undefined;
  /** Text shown when no option matches a *typed* query. */
  emptyText?: string | undefined;
  /**
   * Text shown when the list is empty and nothing has been typed yet.
   *
   * @remarks
   * Defaults to `emptyText`, so a locally-filtered picker is unaffected. It exists for
   * server-filtered lists, where "you have nothing here" and "nothing matched what you typed" are
   * different problems with different fixes — the first usually needs an action from the reader,
   * the second just needs a shorter query. Collapsing them into one string sends people looking
   * for a fault that isn't there.
   */
  idleText?: string | undefined;
  /** The search text, when the caller owns it. Supplying this makes the field controlled. */
  query?: string | undefined;
  /** Report typing. Pair with {@link PickerListProps.query} for a controlled search field. */
  onQueryChange?: ((query: string) => void) | undefined;
  /**
   * Who narrows `options` against the query. Defaults to `'local'`.
   *
   * @remarks
   * `'none'` is for a list the caller has already filtered — typically at a provider, which
   * interprets the query more cleverly than `includes` does, so a second local pass would drop
   * rows the server deliberately returned.
   *
   * Deliberately its own prop rather than inferred from `onQueryChange` being present. Who owns
   * the *text* and who does the *filtering* are independent decisions, and this list is the engine
   * under every picker in the app: a caller reaching for `onQueryChange` to lift the query into
   * URL state, or to clear it when a popover closes, must not silently lose filtering — a failure
   * with no type error and no runtime signal.
   */
  filter?: 'local' | 'none' | undefined;
  /**
   * True while the caller is fetching options.
   *
   * @remarks
   * Renders placeholder rows instead of the empty state, and marks the list `aria-busy`. Without
   * it a remote picker says "No matches" during every request — an answer it does not have yet,
   * and the one thing a search box must never claim prematurely.
   */
  loading?: boolean | undefined;
  /**
   * An optional "clear / none" affordance rendered at the top of the list (single-select):
   * its label and the callback to invoke when chosen (e.g. "No lead", "No project").
   */
  clear?: { label: string; onClear: () => void } | null | undefined;
  /**
   * An optional "create what you just typed" row, rendered last.
   *
   * @remarks
   * This is where most labels are actually born: mid-thought, in the middle of doing the work,
   * from someone who has just typed a word the org does not have yet. Sending them to a settings
   * page to define it first is how a taxonomy ends up unused.
   *
   * `render` builds the row's text from the live query (e.g. `Create "onboarding"`), and
   * `canCreate` decides whether the row appears at all for that query — a picker passes a
   * case-insensitive existence check here so typing `Bug` when `bug` exists offers the existing
   * label instead of a near-duplicate beside it.
   */
  create?:
    | {
        render: (query: string) => string;
        canCreate: (query: string, options: readonly PickerOption<TValue>[]) => boolean;
        onCreate: (query: string) => void;
      }
    | null
    | undefined;
  /** Accessible label for the listbox. */
  ariaLabel?: string | undefined;
}

/** True when `value` is in the (single or array) `selected` set. */
function isSelected<TValue extends string>(
  value: TValue,
  selected: TValue | readonly TValue[] | null,
): boolean {
  if (selected === null) return false;
  if (Array.isArray(selected)) return (selected as readonly TValue[]).includes(value);
  return selected === value;
}

/**
 * The searchable picker listbox.
 *
 * @param props - The {@link PickerListProps}.
 * @returns the rendered search input + roving option listbox.
 */
export function PickerList<TValue extends string = string>({
  options,
  selected,
  onSelect,
  multiple = false,
  searchable = true,
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  idleText,
  query: queryProp,
  onQueryChange,
  filter = 'local',
  loading = false,
  clear = null,
  create = null,
  ariaLabel,
}: PickerListProps<TValue>): React.JSX.Element {
  const [ownQuery, setOwnQuery] = React.useState('');
  const listId = React.useId();

  // Controlled when a `query` is supplied, uncontrolled otherwise — React's own convention.
  const query = queryProp ?? ownQuery;
  const setQuery = onQueryChange ?? setOwnQuery;

  const filtered = React.useMemo(() => {
    if (filter === 'none') return options;
    const normalized = query.trim().toLowerCase();
    return options.filter((option) => optionMatches(option, normalized));
  }, [options, query, filter]);

  // MD3's leading-icon column: reserved on every row once *any* row in the (unfiltered) list
  // carries an icon, so a bare label still lines up under an icon-bearing sibling instead of
  // stair-stepping around whichever options happen to have a glyph. Keyed off the full `options`
  // set, not `filtered` — narrowing the query shouldn't make the column pop in and out.
  const hasAnyIcon = React.useMemo(() => options.some((option) => option.icon != null), [options]);

  const trimmedQuery = query.trim();
  const showCreate =
    create != null && trimmedQuery.length > 0 && create.canCreate(trimmedQuery, options);

  // Build the flat row model: an optional clear row, the filtered options, then an optional
  // create row. Keeping a single flat array makes arrow-key navigation and Enter activation
  // uniform across every row kind — the create row is reachable by Down-arrow like any other.
  const rows = React.useMemo<PickerRow<TValue>[]>(() => {
    const list: PickerRow<TValue>[] = [];
    if (clear) list.push({ kind: 'clear' });
    for (const option of filtered) list.push({ kind: 'option', option });
    if (showCreate) list.push({ kind: 'create' });
    return list;
  }, [clear, filtered, showCreate]);

  const selectedValue = !multiple && typeof selected === 'string' ? selected : null;
  const chosenRowKey = React.useMemo(() => {
    if (selectedValue === null) return null;
    const chosenRow = rows.find((row) => row.option?.value === selectedValue);
    return chosenRow ? pickerRowKey(chosenRow) : null;
  }, [rows, selectedValue]);
  const firstRowKey = rows[0] ? pickerRowKey(rows[0]) : null;
  const [activeRowKey, setActiveRowKey] = React.useState(chosenRowKey ?? firstRowKey);
  const previousSelectedValue = React.useRef(selectedValue);
  const previousQuery = React.useRef(query);
  const activeSyncMode = React.useRef<ActiveSyncMode>('selection');
  const pendingSelectionValue = React.useRef(
    selectedValue !== null && chosenRowKey === null ? selectedValue : null,
  );
  const rowElements = React.useRef(new Map<string, HTMLLIElement>());

  // Selection synchronization, query resets, and explicit navigation have different ownership.
  // A missing controlled selection remains pending until its row arrives. Query changes consume
  // one reset to the first result. Navigation then owns the stable key across ordinary reorders.
  React.useEffect(() => {
    const selectionChanged = previousSelectedValue.current !== selectedValue;
    const queryChanged = previousQuery.current !== query;

    if (selectionChanged) {
      activeSyncMode.current = 'selection';
      pendingSelectionValue.current = chosenRowKey === null ? selectedValue : null;
    } else if (queryChanged) {
      activeSyncMode.current = 'query';
    }

    let synchronizedKey: string | null | undefined;
    if (
      pendingSelectionValue.current !== null &&
      pendingSelectionValue.current === selectedValue &&
      chosenRowKey !== null
    ) {
      synchronizedKey = chosenRowKey;
      pendingSelectionValue.current = null;
      activeSyncMode.current = 'navigation';
    } else if (activeSyncMode.current === 'selection') {
      if (chosenRowKey !== null) synchronizedKey = chosenRowKey;
      if (selectedValue === null || chosenRowKey !== null) activeSyncMode.current = 'navigation';
    } else if (activeSyncMode.current === 'query') {
      synchronizedKey = firstRowKey;
      activeSyncMode.current = 'navigation';
    }

    setActiveRowKey((current) => {
      if (synchronizedKey !== undefined) return synchronizedKey;
      if (current !== null && rows.some((row) => pickerRowKey(row) === current)) return current;
      return firstRowKey;
    });
    previousSelectedValue.current = selectedValue;
    previousQuery.current = query;
  }, [chosenRowKey, firstRowKey, query, rows, selectedValue]);

  const activeIndex = rows.findIndex((row) => pickerRowKey(row) === activeRowKey);
  const activeRow = rows[activeIndex];
  const activeRowId = activeRow ? pickerRowId(listId, activeRow) : undefined;

  const setActiveRow = React.useCallback((row: PickerRow<TValue>, scroll: boolean): void => {
    const key = pickerRowKey(row);
    activeSyncMode.current = 'navigation';
    setActiveRowKey(key);
    const element = rowElements.current.get(key);
    const maybeScrollable = element as
      { scrollIntoView?: (options?: ScrollIntoViewOptions) => void } | undefined;
    if (scroll) maybeScrollable?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const activate = React.useCallback(
    (index: number): void => {
      const row = rows[index];
      if (!row) return;
      if (row.kind === 'clear') {
        clear?.onClear();
        return;
      }
      if (row.kind === 'create') {
        create?.onCreate(trimmedQuery);
        setQuery('');
        return;
      }
      if (row.option && !row.option.disabled) onSelect(row.option.value);
    },
    [rows, clear, create, trimmedQuery, onSelect],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent): void => {
      const moveToIndex = (index: number): void => {
        const row = rows[index];
        if (row) setActiveRow(row, true);
      };

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (rows.length > 0) moveToIndex(Math.min(rows.length - 1, Math.max(0, activeIndex + 1)));
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (rows.length > 0) moveToIndex(Math.max(0, activeIndex < 0 ? 0 : activeIndex - 1));
          break;
        case 'Home':
          event.preventDefault();
          moveToIndex(0);
          break;
        case 'End':
          event.preventDefault();
          if (rows.length > 0) moveToIndex(rows.length - 1);
          break;
        case 'Enter':
          event.preventDefault();
          activate(activeIndex);
          break;
        default:
          break;
      }
    },
    [rows, setActiveRow, activeIndex, activate],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {searchable ? (
        <div className="border-outline-variant flex items-center gap-3 border-b px-4 py-2">
          <Search aria-hidden="true" className="text-on-surface-variant size-5 shrink-0" />
          <input
            // A bare input (not the boxed Input primitive) so the search field reads as part
            // of the popover chrome, like Linear's command-style pickers.
            type="text"
            autoFocus
            value={query}
            onChange={(event) => {
              activeSyncMode.current = 'query';
              setQuery(event.target.value);
              setActiveRowKey(null);
            }}
            onKeyDown={onKeyDown}
            aria-label={ariaLabel ? `Search ${ariaLabel}` : 'Search'}
            aria-controls={listId}
            aria-activedescendant={activeRowId}
            placeholder={searchPlaceholder}
            className="placeholder:text-on-surface-variant text-on-surface text-label-large h-7 w-full bg-transparent outline-none"
          />
        </div>
      ) : null}

      <ul
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        aria-multiselectable={multiple || undefined}
        aria-activedescendant={!searchable ? activeRowId : undefined}
        // When the search input is hidden the list itself must catch the arrow keys.
        tabIndex={searchable ? -1 : 0}
        onKeyDown={searchable ? undefined : onKeyDown}
        aria-busy={loading || undefined}
        className="max-h-64 min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
      >
        {rows.length === 0 ? (
          loading ? (
            // Placeholder rows, not "No matches": the request has not answered yet, and a search
            // box that reports absence before it knows is the most reliable way to make someone
            // stop typing a term that would have worked.
            <li aria-hidden="true" className="flex flex-col gap-1 px-2 py-1.5">
              <Skeleton className="h-8 rounded-md" />
              <Skeleton className="h-8 rounded-md" />
            </li>
          ) : (
            <li className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
              <Search aria-hidden="true" className="text-on-surface-variant size-5 opacity-40" />
              <span className="text-on-surface-variant text-label-large">
                {trimmedQuery ? emptyText : (idleText ?? emptyText)}
              </span>
            </li>
          )
        ) : (
          rows.map((row, index) => {
            const active = index === activeIndex;
            if (row.kind === 'clear') {
              return (
                <li
                  key="__clear__"
                  id={pickerRowId(listId, row)}
                  ref={(element) => {
                    const key = pickerRowKey(row);
                    if (element) rowElements.current.set(key, element);
                    else rowElements.current.delete(key);
                  }}
                  role="option"
                  aria-selected={false}
                  data-active={active || undefined}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      clear?.onClear();
                    }}
                    onMouseEnter={() => {
                      setActiveRow(row, false);
                    }}
                    className={cn(
                      pickerRowClass(),
                      'text-on-surface-variant',
                      pickerRowShape(index, rows.length, searchable),
                      active && ACTIVE_PICKER_ROW,
                      // The keyboard-highlighted row is the focus state, so it takes the 10%
                      // layer. Pointer hover comes from menuItemClass at the spec's 8%.
                      { 'bg-on-surface/10': active },
                    )}
                  >
                    <X aria-hidden="true" className="shrink-0 opacity-70" />
                    <span className="truncate">{clear?.label}</span>
                  </button>
                </li>
              );
            }
            if (row.kind === 'create') {
              return (
                <li
                  key="__create__"
                  id={pickerRowId(listId, row)}
                  ref={(element) => {
                    const key = pickerRowKey(row);
                    if (element) rowElements.current.set(key, element);
                    else rowElements.current.delete(key);
                  }}
                  role="option"
                  aria-selected={false}
                  data-active={active || undefined}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      create?.onCreate(trimmedQuery);
                      setQuery('');
                    }}
                    onMouseEnter={() => {
                      setActiveRow(row, false);
                    }}
                    className={cn(
                      pickerRowClass(),
                      'text-on-surface',
                      pickerRowShape(index, rows.length, searchable),
                      active && ACTIVE_PICKER_ROW,
                      { 'bg-on-surface/10': active },
                    )}
                  >
                    <Plus aria-hidden="true" className="shrink-0 opacity-70" />
                    <span className="truncate">{create?.render(trimmedQuery)}</span>
                  </button>
                </li>
              );
            }
            const option = row.option;
            /* v8 ignore start -- unreachable: `rows` (built above) always pairs a `'row'`-kind
               entry with a defined `option`; this only narrows the discriminated union's optional
               field for TypeScript. */
            if (!option) return null;
            /* v8 ignore stop */
            const chosen = isSelected(option.value, selected);
            return (
              <li
                key={option.value}
                id={pickerRowId(listId, row)}
                ref={(element) => {
                  const key = pickerRowKey(row);
                  if (element) rowElements.current.set(key, element);
                  else rowElements.current.delete(key);
                }}
                role="option"
                aria-selected={chosen}
                aria-disabled={option.disabled}
                data-active={active || undefined}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={option.disabled}
                  onClick={() => {
                    if (!option.disabled) onSelect(option.value);
                  }}
                  onMouseEnter={() => {
                    setActiveRow(row, false);
                  }}
                  className={cn(
                    // A single-select row already has a trailing check and semantic leading glyph,
                    // so it stays on the neutral menu surface. Multi-select needs a persistent
                    // fill because several checked rows can remain in view at once.
                    pickerRowClass(multiple && chosen),
                    { 'bg-on-surface/10': active && !(multiple && chosen) },
                    pickerRowShape(index, rows.length, searchable),
                    active && ACTIVE_PICKER_ROW,
                  )}
                >
                  {hasAnyIcon ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex shrink-0 items-center justify-center',
                        MENU_METRICS.iconBox,
                      )}
                    >
                      {option.icon}
                    </span>
                  ) : null}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.supporting ? (
                      <span
                        className={cn(menuSupporting('standard'), {
                          'text-on-tertiary-container': multiple && chosen,
                        })}
                      >
                        {option.supporting}
                      </span>
                    ) : null}
                  </span>
                  {option.hint ? (
                    <span
                      className={cn(
                        'text-label-large shrink-0 tabular-nums',
                        multiple && chosen
                          ? 'text-on-tertiary-container'
                          : 'text-on-surface-variant',
                      )}
                    >
                      {option.hint}
                    </span>
                  ) : null}
                  {chosen ? <Check aria-hidden="true" className="shrink-0" /> : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
