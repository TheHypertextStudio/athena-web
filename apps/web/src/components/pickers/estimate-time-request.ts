/**
 * `pickers/estimate-time-request` — the time-estimate popover request for one row.
 *
 * @remarks
 * Task tables and the Tasks roster both open the moved time-estimate popover on a row they already
 * hold, so both build the request here, carrying the row's own estimate.
 */
import { objectKey, type ObjectRef } from '@/lib/actions';

import type { EstimateTimePickerRequest } from './picker-overlay';

/**
 * Build the popover request for one row's task.
 *
 * @param object - The row's task object.
 * @param estimateMinutes - The row's current estimate, or `null` when unset.
 * @param anchor - The element the popover opens against.
 * @returns the request for `usePickerOverlay().open`.
 */
export function estimateTimeRequest(
  object: ObjectRef,
  estimateMinutes: number | null,
  anchor: HTMLElement | null,
): EstimateTimePickerRequest {
  return {
    kind: 'estimate-time',
    objects: [object],
    current: new Map([[objectKey(object), estimateMinutes]]),
    anchor,
  };
}
