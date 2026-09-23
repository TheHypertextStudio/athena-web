'use client';

/**
 * `views/task-row-pickers` — the property popovers a task row opens in place.
 *
 * @remarks
 * A task table row opens the app's moved picker overlay rather than mounting a picker per row: `L`
 * for labels and `W` for the time estimate (Sunsama's planned-time key), and the Time column's
 * estimate opens the same time popover on click. Each request carries the row's current value, so
 * the popover shows it checked without a read.
 */
import type { TaskOut } from '@docket/work/task-model';
import { useCallback, useMemo } from 'react';

import { estimateTimeRequest } from '@/components/pickers/estimate-time-request';
import { usePickerOverlay } from '@/components/pickers/picker-overlay';
import { objectKey, type ObjectRef, taskObjectRef } from '@/lib/actions';

/** A task row as the interaction layer's object. */
export interface TaskRowObject extends ObjectRef {
  readonly kind: 'task';
  readonly organizationId: string;
}

/**
 * Build the canonical `kind: 'task'` identity used by drag, selection, actions, and row pickers.
 * The object stays intentionally small so each interaction reads the same stable facts instead of
 * copying a full Task record into UI-specific payloads.
 *
 * @param task - The row's task.
 * @returns the task's object identity.
 */
export function taskRowObject(task: TaskOut): TaskRowObject {
  return taskObjectRef(task, task.organizationId);
}

/** Opens a row's property popover anchored to an element. */
export type OpenTaskRowPicker = (task: TaskOut, anchor: HTMLElement | null) => void;

/** What {@link useTaskRowPickers} returns. */
export interface TaskRowPickers {
  /** Edit the row's labels. */
  readonly openLabels: OpenTaskRowPicker;
  /** Edit the row's time estimate. */
  readonly openEstimate: OpenTaskRowPicker;
  /** Handle a property letter on the active row; `true` when the letter opened a popover. */
  readonly onPropertyKey: (key: string, task: TaskOut, anchor: HTMLElement | null) => boolean;
}

/**
 * The opener for one row's time-estimate popover.
 *
 * @returns a stable opener, for a cell that needs only this one.
 */
export function useOpenEstimate(): OpenTaskRowPicker {
  const pickerOverlay = usePickerOverlay();
  return useCallback(
    (task, anchor) => {
      pickerOverlay.open(
        estimateTimeRequest(taskRowObject(task), task.estimateMinutes ?? null, anchor),
      );
    },
    [pickerOverlay],
  );
}

/**
 * The row pickers for task tables.
 *
 * @returns stable openers for the labels and time-estimate popovers, and the row-key handler.
 */
export function useTaskRowPickers(): TaskRowPickers {
  const pickerOverlay = usePickerOverlay();
  const openEstimate = useOpenEstimate();
  return useMemo(() => {
    const openLabels: OpenTaskRowPicker = (task, anchor) => {
      const object = taskRowObject(task);
      pickerOverlay.open({
        kind: 'labels',
        organizationId: task.organizationId,
        objects: [object],
        current: new Map([[objectKey(object), task.labels.map((label) => label.id)]]),
        anchor,
      });
    };
    const byKey: ReadonlyMap<string, OpenTaskRowPicker> = new Map([
      ['l', openLabels],
      ['w', openEstimate],
    ]);
    return {
      openLabels,
      openEstimate,
      onPropertyKey: (key, task, anchor) => {
        const open = byKey.get(key);
        if (open === undefined) return false;
        open(task, anchor);
        return true;
      },
    };
  }, [openEstimate, pickerOverlay]);
}
