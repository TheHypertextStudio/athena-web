'use client';

/**
 * `pickers/estimate-time-picker-overlay` — the time-estimate popover {@link PickerOverlayProvider}
 * moves to a list row, for the Time column, the `W` key, and the "Time estimate…" action.
 *
 * @remarks
 * One or more tasks share the list. The current estimate shows as checked only when every task has
 * the same one. A choice saves every task's estimate and closes; the lists that show them refresh
 * once the saves settle, and a rejected save reaches the person as a notice (see
 * {@link useSetTaskEstimate}).
 *
 * The caller passes each task's current estimate when it has the row in hand (the Time column and
 * the `W` key do). The action path does not, so the popover reads the task details itself and
 * shows the list meanwhile, checking the current value once it arrives. A failed read says so above
 * the list, which still sets a new estimate.
 */
import { Popover, PopoverAnchor, PopoverContent } from '@docket/ui/primitives';
import type { PopoverVirtualAnchor } from '@docket/ui/primitives';
import { useQueries } from '@tanstack/react-query';
import { type JSX, useRef } from 'react';

import { objectKey, type ObjectRef } from '@/lib/actions';
import { userErrorMessage } from '@/lib/problem';
import { taskDetailDef } from '@/lib/use-task-detail';
import { useSetTaskEstimate } from '@/lib/use-set-task-estimate';

import { EstimateTimeList } from './estimate-time-picker';
import { OverlayErrorBanner } from './overlay-error-banner';
import { resolveCloseFocusTarget } from './label-picker-overlay';
import { capturePickerAnchor, type EstimateTimePickerRequest } from './picker-overlay';

/** Props for {@link EstimateTimePickerOverlay}. */
export interface EstimateTimePickerOverlayProps {
  readonly request: EstimateTimePickerRequest;
  readonly onClose: () => void;
}

/** The workspace a task object belongs to; a task always has one. */
function taskOrganization(object: ObjectRef): string {
  return object.organizationId ?? '';
}

/** Copy shown when the tasks' current estimates could not be read. */
const READ_ERROR_FALLBACK = "These tasks' current estimates didn't load.";

/** Each task's current estimate, and the failure when they had to be read and could not be. */
interface CurrentEstimates {
  /** One entry per object: its estimate, `null` when unset, `undefined` when not known. */
  readonly estimates: readonly (number | null | undefined)[];
  /** Application-owned copy for a failed read, or `null`. */
  readonly readError: string | null;
}

/** Each task's current estimate, from the caller or from the task-detail reads. */
function useCurrentEstimates(request: EstimateTimePickerRequest): CurrentEstimates {
  const { objects, current } = request;
  const details = useQueries({
    queries:
      current === undefined
        ? objects.map((object) => taskDetailDef(taskOrganization(object), object.id))
        : [],
  });
  if (current !== undefined) {
    return { estimates: objects.map((object) => current.get(objectKey(object))), readError: null };
  }
  const failed = details.find((detail) => detail.isError);
  return {
    estimates: objects.map((_object, index) => details[index]?.data?.estimateMinutes),
    readError: failed ? userErrorMessage(failed.error, READ_ERROR_FALLBACK) : null,
  };
}

/** The shared estimate, or `null` when any task differs or is still unknown. */
function sharedEstimate(estimates: readonly (number | null | undefined)[]): number | null {
  const [first] = estimates;
  if (first === undefined || first === null) return null;
  return estimates.every((estimate) => estimate === first) ? first : null;
}

/** The popover {@link PickerOverlayProvider} mounts while a time-estimate request is open. */
export function EstimateTimePickerOverlay({
  request,
  onClose,
}: EstimateTimePickerOverlayProps): JSX.Element {
  const setEstimates = useSetTaskEstimate();
  const { estimates, readError } = useCurrentEstimates(request);

  // Captured once at mount (the overlay remounts per request), as Radix needs for its first
  // measurement.
  const capturedAnchor = useRef(
    capturePickerAnchor(
      request.anchor ??
        (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null),
    ),
  ).current;
  const anchorRef = useRef<PopoverVirtualAnchor | null>(capturedAnchor.virtual);

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        width="sm"
        onCloseAutoFocus={(event) => {
          // No `PopoverTrigger` to return to: send focus back to the grid the row lives in.
          event.preventDefault();
          if (capturedAnchor.focusTarget?.isConnected) {
            resolveCloseFocusTarget(capturedAnchor.focusTarget)?.focus();
          }
        }}
      >
        {readError ? <OverlayErrorBanner title={readError} /> : null}
        <EstimateTimeList
          value={sharedEstimate(estimates)}
          clearable={estimates.some((estimate) => estimate !== null)}
          onChange={(estimateMinutes) => {
            const targets = request.objects.map((object) => ({
              organizationId: taskOrganization(object),
              taskId: object.id,
            }));
            setEstimates(targets, estimateMinutes);
            onClose();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
