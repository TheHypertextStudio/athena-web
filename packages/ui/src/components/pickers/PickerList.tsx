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
 */
import * as React from 'react';

import { Check, Search, X } from '../../icons';
import { cn } from '../../lib/utils';
import { focusRingInset } from '../../primitives';

import { type PickerOption, optionMatches } from './types';

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
          <Search aria-hidden="true" className="text-on-surface-variant size-3.5 shrink-0" />
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
            className="placeholder:text-on-surface-variant text-on-surface h-6 w-full bg-transparent text-sm outline-none"
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
            <span className="text-on-surface-variant text-sm">{emptyText}</span>
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
                      'text-on-surface-variant flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                      focusRingInset,
                      active && 'bg-surface-container-highest',
                    )}
                  >
                    <X aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{clear?.label}</span>
                  </button>
                </li>
              );
            }
            const option = row.option;
            if (!option) return null;
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
                    'text-on-surface flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                    'disabled:pointer-events-none disabled:opacity-50',
                    focusRingInset,
                    active && 'bg-surface-container-highest',
                  )}
                >
                  {option.icon ? (
                    <span
                      aria-hidden="true"
                      className="flex size-3.5 shrink-0 items-center justify-center"
                    >
                      {option.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="text-on-surface-variant shrink-0 text-xs tabular-nums">
                      {option.hint}
                    </span>
                  ) : null}
                  {chosen ? (
                    <Check
                      aria-hidden="true"
                      className="text-on-surface-variant size-3.5 shrink-0"
                    />
                  ) : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
