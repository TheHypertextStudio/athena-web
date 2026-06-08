'use client';

/**
 * `@docket/ui` — the generic searchable single-select property picker.
 *
 * @remarks
 * Composes {@link PropertyTrigger} (the calm compact affordance) with a {@link Popover} that
 * hosts a {@link PickerList} (the searchable, keyboard-navigable listbox). It is the engine
 * behind the actor (assignee / lead / owner) and entity (project / program / initiative /
 * cycle / team) pickers: those are thin presets that supply the right icon, placeholder, and
 * search affordances. The trigger reflects the selected option's icon + label, or a calm
 * "Set <field>" prompt when unset; choosing an option (or the optional "clear" row) reports
 * through `onChange` and closes the popover.
 *
 * Selection state is *controlled* by the caller (the value reported back through `onChange`);
 * this component owns only the transient open state.
 */
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '../../primitives';

import { PickerList } from './PickerList';
import { PropertyTrigger } from './PropertyTrigger';
import type { PickerOption } from './types';

/** Props for {@link OptionPicker}. */
export interface OptionPickerProps<TValue extends string = string> {
  /** The full set of choices (already resolved + vocabulary-skinned by the caller). */
  options: readonly PickerOption<TValue>[];
  /** The currently-selected value, or `null` when the property is unset. */
  value: TValue | null;
  /** Report a chosen value, or `null` when the "clear" row is chosen. */
  onChange: (value: TValue | null) => void;
  /** The calm empty prompt shown on the trigger when unset (e.g. "Set lead"). */
  placeholder: string;
  /** Optional leading glyph shown on the trigger's empty prompt (replaces the default `+`). */
  triggerIcon?: React.ReactNode;
  /** Whether the search input is shown. Defaults to `true`; pass `false` for short lists. */
  searchable?: boolean;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
  /** Text shown when no option matches the query. */
  emptyText?: string;
  /** When set, render a top "clear" row with this label that reports `null` through `onChange`. */
  clearLabel?: string;
  /** Accessible label prefix for the trigger + listbox (e.g. "Lead", "Project"). */
  ariaLabel?: string;
  /** Disable the trigger (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** Render the value as plain text with no affordance (actor lacks edit capability). */
  readOnly?: boolean;
  /** Trigger weight: `ghost` (panel rows) or `outline` (composer strip). */
  triggerVariant?: 'ghost' | 'outline';
  /** Extra classes for the trigger. */
  triggerClassName?: string;
}

/**
 * The generic searchable single-select picker.
 *
 * @param props - The {@link OptionPickerProps}.
 * @returns the rendered trigger + popover listbox.
 *
 * @example
 * ```tsx
 * <OptionPicker
 *   options={projectOptions}
 *   value={projectId}
 *   onChange={setProject}
 *   placeholder="Set project"
 *   clearLabel="No project"
 *   ariaLabel="Project"
 * />
 * ```
 */
export function OptionPicker<TValue extends string = string>({
  options,
  value,
  onChange,
  placeholder,
  triggerIcon,
  searchable = true,
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  clearLabel,
  ariaLabel,
  disabled,
  readOnly,
  triggerVariant = 'ghost',
  triggerClassName,
}: OptionPickerProps<TValue>): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const active = value !== null ? options.find((option) => option.value === value) : undefined;

  // A read-only or disabled picker never opens; render the trigger affordance only.
  const trigger = (
    <PropertyTrigger
      icon={active?.icon}
      label={active?.label}
      placeholder={placeholder}
      hidePlaceholderIcon={triggerIcon !== undefined}
      ariaLabel={ariaLabel ? `${ariaLabel} — ${active ? active.label : 'not set'}` : undefined}
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
          onSelect={(next) => {
            onChange(next);
            setOpen(false);
          }}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          ariaLabel={ariaLabel}
          clear={
            clearLabel
              ? {
                  label: clearLabel,
                  onClear: () => {
                    onChange(null);
                    setOpen(false);
                  },
                }
              : null
          }
        />
      </PopoverContent>
    </Popover>
  );
}
