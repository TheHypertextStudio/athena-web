'use client';

/**
 * `@docket/ui` — the compact multi-select labels picker.
 *
 * @remarks
 * A searchable {@link PickerList} in multi-select mode behind a {@link PropertyTrigger}. The
 * popover stays open across picks (toggling each label in/out of the selected set) so a user
 * can tag several at once; the trigger summarizes the selection ("3 labels", or the single
 * label's name) and falls back to a calm "Add labels" prompt when empty. Selection is
 * *controlled*: the caller owns the `value` array and is told of each toggle through
 * `onToggle`. Each option carries its own swatch as its `icon`, supplied by the caller.
 *
 * Passing `onCreate` turns on inline creation: typing a name the org does not have offers a
 * `Create "…"` row. This is the path most labels are actually born through, so the match is
 * case-insensitive — typing `Bug` where `bug` exists offers the existing label rather than a
 * near-duplicate beside it, which is the failure mode that turns a picker into a junk drawer.
 */
import * as React from 'react';

import { Tag } from '../../icons';

import { PickerList } from './PickerList';
import { PropertyTrigger } from './PropertyTrigger';
import type { PickerOption } from './types';
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives';

/** Props for {@link LabelsPicker}. */
export interface LabelsPickerProps<TValue extends string = string> {
  /** The full set of label choices (each `icon` is the caller's color swatch). */
  options: readonly PickerOption<TValue>[];
  /** The currently-selected label values. */
  value: readonly TValue[];
  /** Report a toggled label value (the caller adds/removes it from its set). */
  onToggle: (value: TValue) => void;
  /** The calm empty prompt shown on the trigger when no labels are set. */
  placeholder?: string;
  /**
   * The trigger's icon; defaults to a {@link Tag} glyph. Override when this picker is reused for
   * a non-label relation (e.g. initiatives), so the chip reads as what it actually sets.
   */
  triggerIcon?: React.ReactNode;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
  /** Text shown when no label matches the query. */
  emptyText?: string;
  /** Accessible label prefix for the trigger + listbox. */
  ariaLabel?: string;
  /** Disable the trigger (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** Render as plain text with no affordance (actor lacks edit capability). */
  readOnly?: boolean;
  /** Trigger weight: `ghost` (panel rows) or `outline` (composer strip). */
  triggerVariant?: 'ghost' | 'outline';
  /** Extra classes for the trigger. */
  triggerClassName?: string;
  /**
   * Create a label from the typed text. Supply this to enable the inline `Create "…"` row; omit
   * it (as the initiatives reuse of this picker does) and the row never appears.
   */
  onCreate?: (name: string) => void;
}

/** Summarize the selected labels into a compact trigger label, or `undefined` when none. */
function summarize<TValue extends string>(
  value: readonly TValue[],
  options: readonly PickerOption<TValue>[],
): string | undefined {
  if (value.length === 0) return undefined;
  if (value.length === 1) {
    const only = options.find((option) => option.value === value[0]);
    return only?.label ?? '1 label';
  }
  return `${value.length} labels`;
}

/**
 * The compact multi-select labels picker.
 *
 * @param props - The {@link LabelsPickerProps}.
 * @returns the rendered trigger + popover multi-select listbox.
 *
 * @example
 * ```tsx
 * <LabelsPicker options={labelOptions} value={labelIds} onToggle={toggleLabel} />
 * ```
 */
export function LabelsPicker<TValue extends string = string>({
  options,
  value,
  onToggle,
  placeholder = 'Add labels',
  triggerIcon = <Tag className="text-on-surface-variant size-4" />,
  searchPlaceholder = 'Filter labels…',
  emptyText = 'No labels',
  ariaLabel = 'Labels',
  disabled,
  readOnly,
  triggerVariant = 'ghost',
  triggerClassName,
  onCreate,
}: LabelsPickerProps<TValue>): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const summary = summarize(value, options);

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
          create={
            onCreate
              ? {
                  render: (q) => `Create “${q}”`,
                  // Case- and whitespace-insensitive, matching the server's own dedupe rule.
                  canCreate: (q, opts) =>
                    !opts.some((o) => o.label.trim().toLowerCase() === q.trim().toLowerCase()),
                  onCreate,
                }
              : null
          }
        />
      </PopoverContent>
    </Popover>
  );
}
