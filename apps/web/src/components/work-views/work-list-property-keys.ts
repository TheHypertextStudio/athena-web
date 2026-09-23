'use client';

/**
 * `work-views/work-list-property-keys` — property letters on the active roster row.
 *
 * @remarks
 * `W` on a task row opens the time-estimate popover (Sunsama's planned-time key), seeded with the
 * row's estimate. It applies to the rows this roster may edit (the route workspace's own tasks),
 * the same rows selection and bulk actions reach.
 */
import type { ViewTarget } from '@docket/work/view-contract';
import { useCallback } from 'react';

import { estimateTimeRequest } from '@/components/pickers/estimate-time-request';
import { usePickerOverlay } from '@/components/pickers/picker-overlay';

import type { ListMembership } from './work-list-groups';
import type { WorkViewRowFor } from './renderer-types';
import { workViewSelectionObject } from './work-view-object';

/** Handles one property letter on a roster row; `true` when it opened a popover. */
export type WorkListPropertyKeyHandler<TTarget extends ViewTarget> = (
  key: string,
  membership: ListMembership<TTarget>,
  anchor: HTMLElement | null,
) => boolean;

/**
 * The roster's property-letter handler.
 *
 * @param organizationId - The route workspace, which owns the editable rows.
 * @returns the handler for `EntityTable`'s `onRowPropertyKey`.
 */
export function useWorkListPropertyKey<TTarget extends ViewTarget>(
  organizationId: string,
): WorkListPropertyKeyHandler<TTarget> {
  const pickerOverlay = usePickerOverlay();
  return useCallback(
    (key, membership, anchor) => {
      const row = membership.row as WorkViewRowFor<ViewTarget>;
      if (key !== 'w' || row.target !== 'task') return false;
      const object = workViewSelectionObject(row, organizationId);
      if (object === null) return false;
      pickerOverlay.open(estimateTimeRequest(object, row.estimateMinutes, anchor));
      return true;
    },
    [organizationId, pickerOverlay],
  );
}
