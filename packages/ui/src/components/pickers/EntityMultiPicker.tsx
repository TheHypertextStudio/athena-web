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
  singularLabel: string;
  pluralLabel: string;
  searchPlaceholder?: string;
  emptyText?: string;
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
  singularLabel,
  pluralLabel,
  searchPlaceholder,
  emptyText,
  ariaLabel,
  disabled,
  readOnly,
  triggerVariant = 'ghost',
  triggerClassName,
}: EntityMultiPickerProps<TValue>): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const summary =
    value.length === 0
      ? undefined
      : value.length === 1
        ? (options.find((option) => option.value === value[0])?.label ?? `1 ${singularLabel}`)
        : `${String(value.length)} ${pluralLabel}`;
  const trigger = (
    <PropertyTrigger
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
    <Popover open={open} onOpenChange={setOpen}>
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
          ariaLabel={ariaLabel}
        />
      </PopoverContent>
    </Popover>
  );
}
