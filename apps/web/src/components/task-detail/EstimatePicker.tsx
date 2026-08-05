'use client';

/**
 * The task estimate ("points") picker.
 *
 * @remarks
 * `task.estimate` is a plain integer, but the workspace constrains it to one of a handful of
 * values via its configured {@link EstimationScale} (Settings > Work structure). `@docket/ui`'s
 * `EnumPicker`/`OptionPicker` only accept string-valued options, so this wraps `EnumPicker` and
 * converts at the boundary: {@link ESTIMATION_SCALES} supplies the scale's ordered point values,
 * each stringified into a `PickerOption`, and the selected string is parsed back to a number (or
 * `null`, when the "clear" row is chosen) before reaching the caller.
 *
 * There is deliberately no `scale === 'none'` branch in here — a workspace that has turned
 * estimation off should show no Estimate row at all, and that is a decision the call site makes
 * by not rendering this component, not something this component silently no-ops.
 */
import { ESTIMATION_SCALES, type EstimationScale } from '@docket/types';
import { EnumPicker, type PickerOption } from '@docket/ui/components';
import type { JSX } from 'react';

/** Props for {@link EstimatePicker}. */
export interface EstimatePickerProps {
  /** The workspace's configured estimation scale, which determines the offered point values. */
  scale: EstimationScale;
  /** The task's current estimate, or `null` when unestimated. */
  value: number | null;
  /** Report the chosen estimate, or `null` when cleared. */
  onChange: (value: number | null) => void;
  /** Render as plain text with no affordance (caller lacks edit capability). */
  readOnly?: boolean;
  /** Disable the trigger (e.g. while a create/save mutation is in flight). */
  disabled?: boolean;
  /** Extra classes for the trigger. */
  triggerClassName?: string;
}

/** The task estimate picker, scoped to the workspace's configured {@link EstimationScale}. */
export function EstimatePicker({
  scale,
  value,
  onChange,
  readOnly,
  disabled,
  triggerClassName,
}: EstimatePickerProps): JSX.Element {
  const options: readonly PickerOption[] = ESTIMATION_SCALES[scale].map((option) => ({
    value: String(option.value),
    label: option.label,
  }));

  return (
    <EnumPicker
      options={options}
      value={value !== null ? String(value) : null}
      onChange={(next) => {
        onChange(next !== null ? Number(next) : null);
      }}
      placeholder="Set estimate"
      clearLabel="None"
      ariaLabel="Estimate"
      readOnly={readOnly}
      disabled={disabled}
      triggerClassName={triggerClassName}
    />
  );
}
