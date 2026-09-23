/**
 * `work-views/work-list-number-values` — roster cells for numbers that are not plain counts.
 *
 * @remarks
 * Each renderer answers `null` for a field it does not own, so `PropertyValue` in
 * `work-list-columns.tsx` can try them in order before falling back to a bare number.
 */
import type { JSX } from 'react';

import { formatEstimate } from '@/lib/format-estimate';

/** A roster cell's field key and raw value. */
export interface NumberPropertyValueInput {
  readonly fieldKey: string;
  readonly value: unknown;
}

/**
 * Render the progress fraction as a bar plus an exact percentage.
 *
 * @param input - The cell's field key and value.
 * @returns the bar, or `null` for another field.
 */
export function renderProgressPropertyValue({
  fieldKey,
  value,
}: NumberPropertyValueInput): JSX.Element | null {
  if (fieldKey !== 'progress' || typeof value !== 'number') return null;
  const percent = Math.round(value * 100);
  return (
    <span className="flex w-full items-center gap-2 tabular-nums">
      <span className="bg-surface-container-highest h-1.5 min-w-10 flex-1 overflow-hidden rounded-full">
        <span
          className="bg-primary block h-full rounded-full"
          style={{ width: `${String(percent)}%` }}
        />
      </span>
      {percent}%
    </span>
  );
}

/**
 * Render a task's time estimate as `h:mm`, the way every estimate reads.
 *
 * @param input - The cell's field key and value.
 * @returns the estimate or "—", or `null` for another field.
 */
export function renderEstimatePropertyValue({
  fieldKey,
  value,
}: NumberPropertyValueInput): JSX.Element | null {
  if (fieldKey !== 'estimateMinutes') return null;
  const minutes = typeof value === 'number' ? value : null;
  return <span className="tabular-nums">{formatEstimate(minutes) ?? '—'}</span>;
}
