'use client';

/**
 * `@docket/ui` — the searchable entity picker (project / program / initiative / cycle / team).
 *
 * @remarks
 * A preset over {@link OptionPicker} for relating a piece of work to another entity: search is
 * on (these lists grow), each option may carry a small entity glyph as its `icon`, and a
 * "clear" row detaches the relation. The app-data-bound wrapper in `apps/web` resolves the
 * org's projects/programs/initiatives/cycles/teams into options (vocabulary-skinned nouns and
 * "No <entity>" clear labels) and owns the optimistic PATCH; this shell stays presentational.
 */
import * as React from 'react';

import { OptionPicker } from './OptionPicker';
import type { PickerOption } from './types';

/** Props for {@link EntityPicker}. */
export interface EntityPickerProps<TValue extends string = string> {
  /** The entity choices (each optional `icon` is a small entity glyph from the caller). */
  options: readonly PickerOption<TValue>[];
  /** The currently-selected entity id, or `null` when unrelated. */
  value: TValue | null;
  /** Report the chosen entity id, or `null` when the "clear" row is chosen. */
  onChange: (value: TValue | null) => void;
  /** The calm empty prompt shown when unset (e.g. "Set project", "Add to program"). */
  placeholder: string;
  /** The field's semantic icon shown on the empty prompt in place of the default `+`. */
  triggerIcon?: React.ReactNode;
  /** The "clear" row label (e.g. "No project", "No cycle"). Omit to forbid clearing. */
  clearLabel?: string;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
  /** Text shown when no entity matches the query. */
  emptyText?: string;
  /**
   * Remote-search passthrough. Supply `query` + `onQueryChange` to own the search text, and
   * `filter="none"` when the options are already narrowed by the server. See {@link OptionPicker}.
   */
  query?: string;
  /** Report typing; pair with `query`. */
  onQueryChange?: (query: string) => void;
  /** Who narrows the options — `'local'` (default) or `'none'` when the caller already did. */
  filter?: 'local' | 'none';
  /** True while the caller is fetching options; renders placeholder rows, not an empty state. */
  loading?: boolean;
  /** Text shown when the list is empty and nothing has been typed. */
  idleText?: string;
  /** Observe the popover opening and closing (e.g. to stop searching for a shut list). */
  onOpenChange?: (open: boolean) => void;
  /** Accessible label prefix (e.g. "Project", "Cycle"). */
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
 * The searchable entity picker.
 *
 * @param props - The {@link EntityPickerProps}.
 * @returns the rendered entity trigger + searchable entity listbox.
 */
export function EntityPicker<TValue extends string = string>({
  options,
  value,
  onChange,
  placeholder,
  triggerIcon,
  clearLabel,
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  query,
  onQueryChange,
  filter,
  loading,
  idleText,
  onOpenChange,
  ariaLabel,
  disabled,
  readOnly,
  triggerVariant = 'ghost',
  triggerClassName,
}: EntityPickerProps<TValue>): React.JSX.Element {
  return (
    <OptionPicker<TValue>
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      triggerIcon={triggerIcon}
      clearLabel={clearLabel}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      query={query}
      onQueryChange={onQueryChange}
      filter={filter}
      loading={loading}
      idleText={idleText}
      onOpenChange={onOpenChange}
      ariaLabel={ariaLabel}
      disabled={disabled}
      readOnly={readOnly}
      triggerVariant={triggerVariant}
      triggerClassName={triggerClassName}
    />
  );
}
