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

import { PickerList, type PickerListProps } from './PickerList';
import { PropertyTrigger } from './PropertyTrigger';
import type { PickerOption } from './types';

/** Props for {@link OptionPicker}. */
export interface OptionPickerProps<TValue extends string = string> {
  /** Optional creation action in the searchable list. */
  create?: PickerListProps<TValue>['create'];
  /** Replace the list with an inline confirmation while keeping the popover mounted. */
  confirmation?: React.ReactNode;
  /** Optional controlled visibility for async creation completion. */
  open?: boolean | undefined;
  /** Cancel the nested confirmation before dismissing the picker. */
  onCancelConfirmation?: (() => void) | undefined;
  /** The full set of choices (already resolved + vocabulary-skinned by the caller). */
  options: readonly PickerOption<TValue>[];
  /** The currently-selected value, or `null` when the property is unset. */
  value: TValue | null;
  /** Report a chosen value, or `null` when the "clear" row is chosen. */
  onChange: (value: TValue | null) => void;
  /** The calm empty prompt shown on the trigger when unset (e.g. "Set lead"). */
  placeholder: string;
  /**
   * The field's semantic icon, shown on the trigger's empty prompt in place of the default `+`
   * (e.g. a calendar for a date field). Ignored once a value is selected — the selected option's
   * own `icon` takes over then.
   */
  triggerIcon?: React.ReactNode | undefined;
  /** Whether the search input is shown. Defaults to `true`; pass `false` for short lists. */
  searchable?: boolean | undefined;
  /** Placeholder for the search input. */
  searchPlaceholder?: string | undefined;
  /** Text shown when no option matches a *typed* query. */
  emptyText?: string | undefined;
  /** Text shown when the list is empty and nothing has been typed. See {@link PickerListProps}. */
  idleText?: string | undefined;
  /** The search text, when the caller owns it. Supplying this makes the field controlled. */
  query?: string | undefined;
  /** Report typing. Pair with `query` for a controlled search field. */
  onQueryChange?: ((query: string) => void) | undefined;
  /**
   * Who narrows `options` against the query. Defaults to `'local'`; pass `'none'` when the caller
   * has already filtered (e.g. at a provider). See {@link PickerListProps.filter}.
   */
  filter?: 'local' | 'none' | undefined;
  /** True while the caller is fetching options; renders placeholder rows, not an empty state. */
  loading?: boolean | undefined;
  /**
   * Observe the popover opening and closing.
   *
   * @remarks
   * The open state stays owned here — this only reports it. A server-filtered picker needs it to
   * stop querying for a list nobody is looking at.
   */
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** When set, render a top "clear" row with this label that reports `null` through `onChange`. */
  clearLabel?: string | undefined;
  /** Accessible label prefix for the trigger + listbox (e.g. "Lead", "Project"). */
  ariaLabel?: string | undefined;
  /** Disable the trigger (e.g. while a mutation is in flight). */
  disabled?: boolean | undefined;
  /** Render the value as plain text with no affordance (actor lacks edit capability). */
  readOnly?: boolean | undefined;
  /** Trigger weight: `ghost` (panel rows) or `secondary` (composer strip). */
  triggerVariant?: 'ghost' | 'secondary' | undefined;
  /** Extra classes for the trigger. */
  triggerClassName?: string | undefined;
  /** Optional action area below the option list. */
  footer?: React.ReactNode | undefined;
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
export function OptionPicker<TValue extends string = string>(
  props: OptionPickerProps<TValue>,
): React.JSX.Element {
  const {
    options,
    value,
    placeholder,
    triggerIcon,
    ariaLabel,
    disabled,
    readOnly,
    triggerClassName,
    confirmation,
    onCancelConfirmation,
  } = props;
  const [localOpen, setOpen] = React.useState(false);
  const open = props.open ?? localOpen;
  const setOpenState = (next: boolean): void => {
    setOpen(next);
    props.onOpenChange?.(next);
  };
  const active = value !== null ? options.find((option) => option.value === value) : undefined;

  // A read-only or disabled picker never opens; render the trigger affordance only.
  const trigger = (
    <PropertyTrigger
      icon={active?.icon ?? triggerIcon}
      label={active?.label}
      placeholder={placeholder}
      ariaLabel={ariaLabel ? `${ariaLabel} — ${active ? active.label : 'not set'}` : undefined}
      disabled={disabled}
      readOnly={readOnly}
      variant={props.triggerVariant ?? 'ghost'}
      className={triggerClassName}
    />
  );

  if (readOnly) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpenState}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        width="lg"
        onEscapeKeyDown={(event) => {
          if (confirmation) {
            event.preventDefault();
            onCancelConfirmation?.();
          }
        }}
      >
        {confirmation ?? (
          <>
            <OptionPickerList
              {...props}
              close={() => {
                setOpenState(false);
              }}
            />
            {props.footer}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function OptionPickerList<TValue extends string>({
  value,
  onChange,
  close,
  clearLabel,
  ...props
}: Omit<OptionPickerProps<TValue>, 'placeholder'> & { close: () => void }): React.JSX.Element {
  const select = (next: TValue | null): void => {
    onChange(next);
    close();
  };
  return (
    <PickerList
      {...props}
      selected={value}
      onSelect={select}
      clear={
        clearLabel
          ? {
              label: clearLabel,
              onClear: () => {
                select(null);
              },
            }
          : null
      }
    />
  );
}
