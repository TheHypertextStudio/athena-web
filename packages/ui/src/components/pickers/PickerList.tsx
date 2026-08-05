'use client';

/**
 * `@docket/ui` — the searchable, keyboard-navigable listbox that lives inside a picker popover.
 *
 * @remarks
 * The shared engine behind the searchable pickers (actor / entity / labels). It renders a
 * filter `<input>` and a roving `listbox` of {@link PickerOption}s, owns the query + active
 * (keyboard-highlighted) index, and reports a selection through `onSelect`. Single-select
 * pickers close the popover on select (the caller flips `open`); multi-select pickers keep
 * it open and reflect the `selected` set with a trailing check. The list is plain DOM (no
 * Radix menu), so it composes inside {@link PopoverContent} without fighting the menu
 * typeahead. Empty states and a "Clear" affordance keep it Linear-calm.
 *
 * ## One row family, not two
 *
 * This is the "select" member of the menu-like primitive family — {@link DropdownMenuItem} and
 * {@link ContextMenuItem} are the other two. Its rows resolve height and corner radius from the
 * same {@link CONTROL}.`lg` step and {@link CONTROL_RADIUS} that
 * `packages/ui/src/primitives/menu-styles.ts`'s `menuItemClass` does, and use the same two color
 * roles: `on-surface/8` for a hovered/keyboard-highlighted row, `secondary-container` for the
 * chosen one. It cannot literally import `menuItemClass` — that module is written for
 * `role="menuitem"` and, more importantly, its `[&_svg]:size-4.5!` bundles an `!important` icon
 * sizing rule that would race the one {@link StatusIcon} (a common option icon here) already
 * carries on its own inner `<svg>` — so the shared numbers are reproduced as literals instead.
 *
 * Rows also reserve a fixed leading-icon column whenever *any* option in the list carries one, so
 * an icon-less row still lines up under an icon-bearing sibling instead of starting flush left.
 * `DropdownMenuContent`/`ContextMenuContent` get the equivalent for free from a `:has()` rule in
 * `globals.css` keyed off `role="menu"`/`role="menuitem"`; this list uses plain `listbox`/`option`
 * roles and heterogeneous icon content (an avatar image, a color swatch, a multi-bar glyph — not
 * reliably a bare `<svg>`), so the same reservation is computed here instead.
 */
import * as React from 'react';

import { Check, Search, X } from '../../icons';
import { cn } from '../../lib/utils';
import { CONTROL, CONTROL_RADIUS, focusRingInset } from '../../primitives';

import { type PickerOption, optionMatches } from './types';

/**
 * Row metrics shared by the "clear" row and every option row: height and corner radius, kept in
 * step with `menuItemClass`'s `lg` {@link CONTROL} step so a picker's listbox row and a
 * dropdown/context menu's row read as one family. See the module remarks for why icon sizing is
 * deliberately left out of this shared string.
 */
const PICKER_ROW_METRICS = cn(
  CONTROL.lg.minHeight,
  CONTROL_RADIUS,
  'flex w-full items-start gap-2 px-2 py-1.5 text-left text-body-medium transition-colors outline-none select-none disabled:pointer-events-none disabled:opacity-50',
);

/** Props for {@link PickerList}. */
export interface PickerListProps<TValue extends string = string> {
  /** The full set of choices (already vocabulary-skinned / resolved by the caller). */
  options: readonly PickerOption<TValue>[];
  /** The currently-selected value(s): a single value for single-select, a set for multi. */
  selected: TValue | readonly TValue[] | null;
  /** Report a chosen option's value (multi-select toggles; single-select sets). */
  onSelect: (value: TValue) => void;
  /** When `true`, render trailing checks and keep selection open for multiple picks. */
  multiple?: boolean;
  /** Hide the search input (for short, unsearchable lists). Defaults to showing it. */
  searchable?: boolean;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
  /** Text shown when no option matches the query. */
  emptyText?: string;
  /**
   * An optional "clear / none" affordance rendered at the top of the list (single-select):
   * its label and the callback to invoke when chosen (e.g. "No lead", "No project").
   */
  clear?: { label: string; onClear: () => void } | null;
  /** Accessible label for the listbox. */
  ariaLabel?: string;
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
  clear = null,
  ariaLabel,
}: PickerListProps<TValue>): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listId = React.useId();

  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return options.filter((option) => optionMatches(option, normalized));
  }, [options, query]);

  // MD3's leading-icon column: reserved on every row once *any* row in the (unfiltered) list
  // carries an icon, so a bare label still lines up under an icon-bearing sibling instead of
  // stair-stepping around whichever options happen to have a glyph. Keyed off the full `options`
  // set, not `filtered` — narrowing the query shouldn't make the column pop in and out.
  const hasAnyIcon = React.useMemo(() => options.some((option) => option.icon != null), [options]);

  // Build the flat row model: an optional clear row, then the filtered options. Keeping a
  // single flat array makes arrow-key navigation and Enter activation uniform across rows.
  const rows = React.useMemo<{ kind: 'clear' | 'option'; option?: PickerOption<TValue> }[]>(() => {
    const list: { kind: 'clear' | 'option'; option?: PickerOption<TValue> }[] = [];
    if (clear) list.push({ kind: 'clear' });
    for (const option of filtered) list.push({ kind: 'option', option });
    return list;
  }, [clear, filtered]);

  // Clamp the active index whenever the row set shrinks (e.g. as the query narrows).
  React.useEffect(() => {
    setActiveIndex((current) =>
      current > rows.length - 1 ? Math.max(0, rows.length - 1) : current,
    );
  }, [rows.length]);

  const activate = React.useCallback(
    (index: number): void => {
      const row = rows[index];
      if (!row) return;
      if (row.kind === 'clear') {
        clear?.onClear();
        return;
      }
      if (row.option && !row.option.disabled) onSelect(row.option.value);
    },
    [rows, clear, onSelect],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent): void => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex((current) => Math.min(rows.length - 1, current + 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex((current) => Math.max(0, current - 1));
          break;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setActiveIndex(rows.length - 1);
          break;
        case 'Enter':
          event.preventDefault();
          activate(activeIndex);
          break;
        default:
          break;
      }
    },
    [rows.length, activate, activeIndex],
  );

  return (
    <div className="flex flex-col">
      {searchable ? (
        <div className="border-outline-variant flex items-center gap-2 border-b px-2 py-1.5">
          <Search aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
          <input
            // A bare input (not the boxed Input primitive) so the search field reads as part
            // of the popover chrome, like Linear's command-style pickers.
            type="text"
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            aria-label={ariaLabel ? `Search ${ariaLabel}` : 'Search'}
            aria-controls={listId}
            placeholder={searchPlaceholder}
            className="placeholder:text-on-surface-variant text-on-surface text-body-medium h-6 w-full bg-transparent outline-none"
          />
        </div>
      ) : null}

      <ul
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        aria-multiselectable={multiple || undefined}
        // When the search input is hidden the list itself must catch the arrow keys.
        tabIndex={searchable ? -1 : 0}
        onKeyDown={searchable ? undefined : onKeyDown}
        className="max-h-64 overflow-y-auto p-1"
      >
        {rows.length === 0 ? (
          <li className="flex flex-col items-center gap-1.5 px-2 py-6 text-center">
            <Search aria-hidden="true" className="text-on-surface-variant size-5 opacity-40" />
            <span className="text-on-surface-variant text-body-medium">{emptyText}</span>
          </li>
        ) : (
          rows.map((row, index) => {
            const active = index === activeIndex;
            if (row.kind === 'clear') {
              return (
                <li key="__clear__" role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => {
                      clear?.onClear();
                    }}
                    onMouseEnter={() => {
                      setActiveIndex(index);
                    }}
                    className={cn(
                      PICKER_ROW_METRICS,
                      'text-on-surface-variant',
                      focusRingInset,
                      active && 'bg-on-surface/8',
                    )}
                  >
                    <X aria-hidden="true" className="size-4 shrink-0 opacity-70" />
                    <span className="truncate">{clear?.label}</span>
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
              <li key={option.value} role="option" aria-selected={chosen}>
                <button
                  type="button"
                  disabled={option.disabled}
                  onClick={() => {
                    if (!option.disabled) onSelect(option.value);
                  }}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                  className={cn(
                    PICKER_ROW_METRICS,
                    // The chosen row escalates into MD3's selection role — the same
                    // `secondary-container` background `menuItemClass({ selected: true })` gives a
                    // checked DropdownMenu/ContextMenu row — rather than relying on the trailing
                    // check alone. A merely hovered/keyboard-highlighted row (never simultaneously
                    // chosen and active in a way that should mask the selection) gets the plain
                    // `on-surface/8` overlay every other menu-family row uses.
                    chosen
                      ? 'bg-secondary-container text-on-secondary-container'
                      : cn('text-on-surface', active && 'bg-on-surface/8'),
                    focusRingInset,
                  )}
                >
                  {hasAnyIcon ? (
                    <span
                      aria-hidden="true"
                      className="flex size-4 shrink-0 items-center justify-center pt-0.5"
                    >
                      {option.icon}
                    </span>
                  ) : null}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.supporting ? (
                      <span
                        className={cn(
                          'text-body-small',
                          chosen ? 'text-on-secondary-container' : 'text-on-surface-variant',
                        )}
                      >
                        {option.supporting}
                      </span>
                    ) : null}
                  </span>
                  {option.hint ? (
                    <span
                      className={cn(
                        'text-label-small shrink-0 tabular-nums',
                        chosen ? 'text-on-secondary-container' : 'text-on-surface-variant',
                      )}
                    >
                      {option.hint}
                    </span>
                  ) : null}
                  {chosen ? <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
