'use client';

/**
 * `@docket/ui` — the compact enum picker (status / priority / health).
 *
 * @remarks
 * A thin preset over {@link OptionPicker} for *short, bounded* literal sets that each carry
 * their own glyph: a task's workflow state, a {@link Priority}, a project {@link Health}, a
 * lifecycle status. The choice list is small and ordered, so search is off by default and the
 * popover reads as a tidy menu of glyph + label rows. Selection is controlled by the caller.
 *
 * Unlike the actor/entity pickers, an enum is always *set* to one of its members, so there is
 * no "clear" row by default — pass {@link EnumPickerProps.clearLabel} only for the rare
 * nullable enum (e.g. project health, which may be unset).
 */
import * as React from 'react';

import { OptionPicker } from './OptionPicker';
import type { PickerOption } from './types';

/** Props for {@link EnumPicker}. */
export interface EnumPickerProps<TValue extends string = string> {
  /** The ordered enum choices, each with its glyph as `icon` and human `label`. */
  options: readonly PickerOption<TValue>[];
  /** The current enum value, or `null` when a nullable enum is unset. */
  value: TValue | null;
  /** Report the chosen value (or `null` when a "clear" row is offered and chosen). */
  onChange: (value: TValue | null) => void;
  /** The calm empty prompt shown when unset (only reachable for nullable enums). */
  placeholder: string;
  /** The field's semantic icon shown on the empty prompt in place of the default `+`. */
  triggerIcon?: React.ReactNode;
  /** When set, render a top "clear" row (for nullable enums like health). */
  clearLabel?: string;
  /** Placeholder for the search input, when `searchable`. */
  searchPlaceholder?: string;
  /** Text shown when no option matches a typed query. */
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
  /** Accessible label prefix (e.g. "Status", "Priority", "Health"). */
  ariaLabel?: string;
  /** Enable search (off by default — enum lists are short). */
  searchable?: boolean;
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
 * The compact enum picker.
 *
 * @param props - The {@link EnumPickerProps}.
 * @returns the rendered glyph trigger + enum menu.
 *
 * @example
 * ```tsx
 * <EnumPicker
 *   options={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityGlyph priority={p} /> }))}
 *   value={priority}
 *   onChange={(next) => setPriority(next ?? 'none')}
 *   placeholder="Set priority"
 *   ariaLabel="Priority"
 * />
 * ```
 */
export function EnumPicker<TValue extends string = string>({
  options,
  value,
  onChange,
  placeholder,
  triggerIcon,
  clearLabel,
  searchPlaceholder,
  emptyText,
  query,
  onQueryChange,
  filter,
  loading,
  idleText,
  onOpenChange,
  ariaLabel,
  searchable = false,
  disabled,
  readOnly,
  triggerVariant = 'ghost',
  triggerClassName,
}: EnumPickerProps<TValue>): React.JSX.Element {
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
      searchable={searchable}
      disabled={disabled}
      readOnly={readOnly}
      triggerVariant={triggerVariant}
      triggerClassName={triggerClassName}
    />
  );
}
