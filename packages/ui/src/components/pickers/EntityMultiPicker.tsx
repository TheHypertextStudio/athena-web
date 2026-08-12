'use client';

/** Searchable multi-select picker for relationships to other Docket entities. */
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '../../primitives';
import { PickerList } from './PickerList';
import { PropertyTrigger } from './PropertyTrigger';
import type { PickerOption } from './types';

/** Props for {@link EntityMultiPicker}. */
export interface EntityMultiPickerProps<TValue extends string = string> {
  options: readonly PickerOption<TValue>[];
  value: readonly TValue[];
  onToggle: (value: TValue) => void;
  placeholder: string;
  /** The field's semantic icon shown on the empty prompt in place of the default `+`. */
  triggerIcon?: React.ReactNode;
  singularLabel: string;
  pluralLabel: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /**
   * Remote-search passthrough. Supply `query` + `onQueryChange` to own the search text, and
   * `filter="none"` when the options are already narrowed by the server. See {@link PickerList}.
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
  ariaLabel: string;
  disabled?: boolean;
  readOnly?: boolean;
  /** Trigger weight: `ghost` (panel rows) or `outline` (composer strip). */
  triggerVariant?: 'ghost' | 'outline';
  /** Extra classes for the trigger. */
  triggerClassName?: string;
}

/**
 * Render a compact relationship picker without implying that one selected entity is primary.
 *
 * @param props - Controlled relationship values and picker copy.
 * @returns An anchored searchable multi-select popover.
 */
export function EntityMultiPicker<TValue extends string = string>({
  options,
  value,
  onToggle,
  placeholder,
  triggerIcon,
  singularLabel,
  pluralLabel,
  searchPlaceholder,
  emptyText,
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
}: EntityMultiPickerProps<TValue>): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const setOpenState = (next: boolean): void => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const summary =
    value.length === 0
      ? undefined
      : value.length === 1
        ? (options.find((option) => option.value === value[0])?.label ?? `1 ${singularLabel}`)
        : `${String(value.length)} ${pluralLabel}`;
  const trigger = (
    <PropertyTrigger
      icon={triggerIcon}
      label={summary}
      placeholder={placeholder}
      ariaLabel={`${ariaLabel} — ${summary ?? 'none'}`}
      disabled={disabled}
      readOnly={readOnly}
      variant={triggerVariant}
      className={triggerClassName}
    />
  );

  if (readOnly) return trigger;
  return (
    <Popover open={open} onOpenChange={setOpenState}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent>
        <PickerList<TValue>
          options={options}
          selected={value}
          onSelect={onToggle}
          multiple
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          query={query}
          onQueryChange={onQueryChange}
          filter={filter}
          loading={loading}
          idleText={idleText}
          ariaLabel={ariaLabel}
        />
      </PopoverContent>
    </Popover>
  );
}
