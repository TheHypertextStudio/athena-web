'use client';

/**
 * `@docket/ui` — the searchable actor picker (assignee / lead / owner / delegate).
 *
 * @remarks
 * A preset over {@link OptionPicker} tuned for choosing a *who*: search is on (member rosters
 * grow long), each option carries an {@link ActorAvatar} as its `icon` (supplied by the
 * app-data wrapper that resolves members/agents into options), and a "clear" row lets the
 * caller unassign. The app-data-bound wrapper in `apps/web` builds the option list from the
 * org's members/agents and owns the optimistic PATCH; this shell stays presentational.
 */
import * as React from 'react';

import { OptionPicker } from './OptionPicker';
import type { PickerOption } from './types';

/** Props for {@link ActorPicker}. */
export interface ActorPickerProps<TValue extends string = string> {
  /** The actor choices (each `icon` is an `ActorAvatar` built by the caller). */
  options: readonly PickerOption<TValue>[];
  /** The currently-selected actor id, or `null` when unassigned. */
  value: TValue | null;
  /** Report the chosen actor id, or `null` when the "clear" row is chosen. */
  onChange: (value: TValue | null) => void;
  /** The calm empty prompt shown when unset (e.g. "Assign", "Set lead"). */
  placeholder?: string;
  /** The "clear" row label (e.g. "Unassigned", "No lead"). */
  clearLabel?: string;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
  /** Text shown when no actor matches the query. */
  emptyText?: string;
  /** Accessible label prefix (e.g. "Assignee", "Lead"). */
  ariaLabel?: string;
  /** Disable the trigger (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** Render as plain text with no affordance (actor lacks edit capability). */
  readOnly?: boolean;
  /** Trigger weight: `ghost` (panel rows) or `outline` (composer strip). */
  triggerVariant?: 'ghost' | 'outline';
  /** Extra classes for the trigger. */
  triggerClassName?: string;
}

/**
 * The searchable actor picker.
 *
 * @param props - The {@link ActorPickerProps}.
 * @returns the rendered avatar trigger + searchable actor listbox.
 */
export function ActorPicker<TValue extends string = string>({
  options,
  value,
  onChange,
  placeholder = 'Assign',
  clearLabel = 'Unassigned',
  searchPlaceholder = 'Search people…',
  emptyText = 'No matches',
  ariaLabel = 'Assignee',
  disabled,
  readOnly,
  triggerVariant = 'ghost',
  triggerClassName,
}: ActorPickerProps<TValue>): React.JSX.Element {
  return (
    <OptionPicker<TValue>
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      clearLabel={clearLabel}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      ariaLabel={ariaLabel}
      disabled={disabled}
      readOnly={readOnly}
      triggerVariant={triggerVariant}
      triggerClassName={triggerClassName}
    />
  );
}
