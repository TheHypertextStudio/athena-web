'use client';

import { CircleAlert } from '@docket/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@docket/ui/primitives';
import type { WorkLocationAssertionOut, WorkLocationOccurrenceException } from '@docket/types';
import { type JSX, type ReactNode, useMemo, useState } from 'react';

import type { SchedulingCanvasProps } from '@/components/scheduling';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiListQuery, useApiMutation, useApiQuery } from '@/lib/query';

import { OccurrenceEditorDialog } from './occurrence-editor-dialog';
import { ScheduleEditorDialog } from './schedule-editor-dialog';
import {
  WorkLocationAllDayContext,
  WorkLocationTimeboxDecoration,
  WorkLocationTimedLaneContext,
} from './work-location-calendar-components';
import {
  workLocationAllDayMove,
  type WorkLocationCalendarEdit,
  workLocationTimedEdit,
} from './work-location-calendar-editing';
import {
  buildWorkLocationCalendarModel,
  type WorkLocationCalendarRegion,
} from './work-location-calendar-model';
import {
  workLocationAssertionsDef,
  workLocationPlacesDef,
  workLocationRangeDef,
  workLocationSyncDef,
} from './work-location-data';

/** Shared canvas slots, status control, and editors for work-location composition. */
export interface WorkLocationCalendarComposition {
  readonly canvasProps: Pick<
    SchedulingCanvasProps,
    | 'gutterSlot'
    | 'renderAllDayLaneContext'
    | 'renderTimedLaneContext'
    | 'renderTimedItemDecoration'
  >;
  readonly overlays: ReactNode;
}

/** Inputs common to Calendar and Agenda work-location composition. */
export interface UseWorkLocationCalendarCompositionInput {
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
  readonly lanes: SchedulingCanvasProps['lanes'];
}

/** Render one compact provider status control instead of repeated warning chips. */
export function WorkLocationStatusControl({
  warnings,
}: {
  readonly warnings: readonly {
    readonly id: string;
    readonly label: string;
    readonly message: string;
  }[];
}): JSX.Element | null {
  if (warnings.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Work-location status, ${String(warnings.length)} ${warnings.length === 1 ? 'notice' : 'notices'}`}
          className="bg-warning-container text-on-warning-container hover:bg-warning-container/80 focus-visible:outline-primary text-label-small inline-flex min-h-7 items-center gap-1 rounded-full px-2 focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition-colors motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
        >
          <CircleAlert aria-hidden="true" className="size-4!" />
          <span>{warnings.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 shadow-none">
        <div className="space-y-2" aria-label="Work-location status details">
          {warnings.map((warning) => (
            <div key={warning.id} className="min-w-0">
              <p className="text-on-surface text-label-medium truncate">{warning.label}</p>
              <p className="text-on-surface-variant text-body-small">{warning.message}</p>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Provide the same work-location model, gestures, editors, and mutations to every schedule. */
export function useWorkLocationCalendarComposition({
  start,
  end,
  timezone,
  lanes,
}: UseWorkLocationCalendarCompositionInput): WorkLocationCalendarComposition {
  const sync = useApiQuery(workLocationSyncDef());
  const range = useApiListQuery({
    ...workLocationRangeDef(start, end),
    enabled: sync.data?.ready === true,
  });
  const assertions = useApiListQuery(workLocationAssertionsDef());
  const places = useApiListQuery(workLocationPlacesDef());
  const [editingRegion, setEditingRegion] = useState<WorkLocationCalendarRegion | null>(null);
  const assertionById = useMemo(
    () => new Map((assertions.data?.items ?? []).map((assertion) => [assertion.id, assertion])),
    [assertions.data?.items],
  );
  const model = useMemo(
    () =>
      buildWorkLocationCalendarModel({
        timezone,
        range: range.data ?? null,
        assertions: assertions.data?.items ?? [],
        places: places.data?.items ?? [],
        accounts: sync.data?.accounts ?? [],
      }),
    [assertions.data?.items, places.data?.items, range.data, sync.data?.accounts, timezone],
  );
  const warnings = useMemo(() => {
    if (!sync.isError && !range.isError && !assertions.isError && !places.isError) {
      return model.warnings;
    }
    return [
      ...model.warnings,
      {
        id: 'work-location-read-failure',
        label: 'Work locations',
        message: 'Work locations are temporarily unavailable.',
      },
    ];
  }, [assertions.isError, model.warnings, places.isError, range.isError, sync.isError]);
  const invalidateKeys = [queryKeys.workLocation()];
  const persistEdit = useApiMutation({
    mutationFn: (edit: WorkLocationCalendarEdit) => {
      if (edit.kind === 'assertion_patch') {
        return unwrap(
          () =>
            api.v1.me['work-location'].assertions[':id'].$patch({
              param: { id: edit.assertionId },
              json: edit.input,
            }),
          'Could not update that work location.',
        );
      }
      return unwrap(
        () =>
          api.v1.me['work-location'].assertions[':id'].occurrences[':date'].$put({
            param: { id: edit.assertionId, date: edit.occurrenceDate },
            json: edit.input,
          }),
        'Could not update that work-location occurrence.',
      );
    },
    invalidateKeys,
  });
  const updateAssertion = useApiMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: WorkLocationAssertionOut['id'];
      input: Parameters<
        (typeof api.v1.me)['work-location']['assertions'][':id']['$patch']
      >[0]['json'];
    }) =>
      unwrap(
        () => api.v1.me['work-location'].assertions[':id'].$patch({ param: { id }, json: input }),
        'Could not update that work-location schedule.',
      ),
    invalidateKeys,
    onSuccess: () => {
      setEditingRegion(null);
    },
  });
  const setOccurrence = useApiMutation({
    mutationFn: ({
      id,
      date,
      input,
    }: {
      id: WorkLocationAssertionOut['id'];
      date: string;
      input: WorkLocationOccurrenceException;
    }) =>
      unwrap(
        () =>
          api.v1.me['work-location'].assertions[':id'].occurrences[':date'].$put({
            param: { id, date },
            json: input,
          }),
        'Could not update that work-location occurrence.',
      ),
    invalidateKeys,
    onSuccess: () => {
      setEditingRegion(null);
    },
  });
  const clearOccurrence = useApiMutation({
    mutationFn: ({ id, date }: { id: WorkLocationAssertionOut['id']; date: string }) =>
      unwrap(
        () =>
          api.v1.me['work-location'].assertions[':id'].occurrences[':date'].$delete({
            param: { id, date },
          }),
        'Could not restore that work-location occurrence.',
      ),
    invalidateKeys,
    onSuccess: () => {
      setEditingRegion(null);
    },
  });
  const mutationFailed =
    persistEdit.isError ||
    updateAssertion.isError ||
    setOccurrence.isError ||
    clearOccurrence.isError;
  const statusWarnings = mutationFailed
    ? [
        ...warnings,
        {
          id: 'work-location-write-failure',
          label: 'Work locations',
          message: 'Could not save that work-location change.',
        },
      ]
    : warnings;
  const openRegion = (region: WorkLocationCalendarRegion): void => {
    if (region.editable) setEditingRegion(region);
  };

  return {
    canvasProps: {
      gutterSlot: <WorkLocationStatusControl warnings={statusWarnings} />,
      renderAllDayLaneContext: (context) => (
        <WorkLocationAllDayContext
          regions={model.regions}
          context={context}
          lanes={lanes}
          displayTimezone={timezone}
          onOpen={openRegion}
          onMove={(region, targetDate) => {
            const edit = workLocationAllDayMove({ region, targetDate, timezone });
            if (edit) persistEdit.mutate(edit);
          }}
        />
      ),
      renderTimedLaneContext: (context) => (
        <WorkLocationTimedLaneContext
          regions={model.regions}
          context={context}
          displayTimezone={timezone}
          onOpen={openRegion}
          onEdit={({ region, targetDate, startMinutes, endMinutes }) => {
            const edit = workLocationTimedEdit({
              region,
              targetDate,
              startMinutes,
              endMinutes,
              timezone,
            });
            if (edit) persistEdit.mutate(edit);
          }}
        />
      ),
      renderTimedItemDecoration: (context) => (
        <WorkLocationTimeboxDecoration
          regions={model.regions}
          context={context}
          displayTimezone={timezone}
        />
      ),
    },
    overlays: (
      <>
        <ScheduleEditorDialog
          open={editingRegion?.assertionKind === 'one_off'}
          onOpenChange={(open) => {
            if (!open) setEditingRegion(null);
          }}
          places={places.data?.items ?? []}
          timezone={timezone}
          assertion={
            editingRegion?.assertionKind === 'one_off' && editingRegion.assertionId
              ? (assertionById.get(editingRegion.assertionId) ?? null)
              : null
          }
          pending={updateAssertion.isPending}
          onSave={(input) => {
            if (editingRegion?.assertionId) {
              updateAssertion.mutate({ id: editingRegion.assertionId, input });
            }
          }}
        />
        <OccurrenceEditorDialog
          open={editingRegion?.assertionKind === 'weekly'}
          onOpenChange={(open) => {
            if (!open) setEditingRegion(null);
          }}
          assertion={
            editingRegion?.assertionKind === 'weekly' && editingRegion.assertionId
              ? (assertionById.get(editingRegion.assertionId) ?? null)
              : null
          }
          date={editingRegion?.occurrenceDate ?? null}
          places={places.data?.items ?? []}
          pending={setOccurrence.isPending || clearOccurrence.isPending}
          onSet={(id, date, input) => {
            setOccurrence.mutate({ id, date, input });
          }}
          onRestore={(id, date) => {
            clearOccurrence.mutate({ id, date });
          }}
        />
      </>
    ),
  };
}
