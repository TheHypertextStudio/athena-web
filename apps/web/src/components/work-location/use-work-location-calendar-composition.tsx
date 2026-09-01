'use client';

import type {
  WorkLocationAssertionOut,
  WorkLocationOccurrenceException,
} from '@docket/planning/work-location-contract';
import { type ReactNode, useMemo, useState } from 'react';

import type { SchedulingCanvasProps } from '@/components/scheduling';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiListQuery, useApiMutation, useApiQuery } from '@/lib/query';

import { OccurrenceEditorDialog } from './occurrence-editor-dialog';
import { ScheduleEditorDialog } from './schedule-editor-dialog';
import {
  WorkLocationAllDayContext,
  hasWorkLocationAllDayRegion,
  resolveWorkLocationTimedLeadingInset,
  WorkLocationTimeboxDecoration,
  WorkLocationTimedLaneContext,
  type WorkLocationTimedEditOutcome,
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

/** Shared canvas slots and editors for work-location composition. */
export interface WorkLocationCalendarComposition {
  readonly canvasProps: Pick<
    SchedulingCanvasProps,
    | 'renderAllDayLaneContext'
    | 'renderTimedLaneContext'
    | 'renderTimedItemDecoration'
    | 'resolveTimedItemLeadingInset'
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
        homePlaceId: places.data?.profile.homePlaceId ?? null,
      }),
    [
      assertions.data?.items,
      places.data?.items,
      places.data?.profile.homePlaceId,
      range.data,
      timezone,
    ],
  );
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
  const resetMutationFailures = (): void => {
    persistEdit.reset();
    updateAssertion.reset();
    setOccurrence.reset();
    clearOccurrence.reset();
  };
  const persistCalendarEdit = (
    edit: WorkLocationCalendarEdit | null,
  ): WorkLocationTimedEditOutcome => {
    if (!edit) {
      return {
        status: 'rejected',
        announcement: 'That work-location time is unavailable.',
      };
    }
    resetMutationFailures();
    persistEdit.mutate(edit, { onSuccess: resetMutationFailures });
    return { status: 'accepted' };
  };
  const openRegion = (region: WorkLocationCalendarRegion): void => {
    if (region.editable) setEditingRegion(region);
  };

  return {
    canvasProps: {
      renderAllDayLaneContext: (context) => {
        if (
          !hasWorkLocationAllDayRegion({
            regions: model.regions,
            lane: context.lane,
            displayTimezone: timezone,
          })
        ) {
          return null;
        }
        return (
          <WorkLocationAllDayContext
            regions={model.regions}
            context={context}
            lanes={lanes}
            displayTimezone={timezone}
            onOpen={openRegion}
            onMove={(region, targetDate) => {
              const edit = workLocationAllDayMove({ region, targetDate, timezone });
              if (edit) {
                resetMutationFailures();
                persistEdit.mutate(edit, { onSuccess: resetMutationFailures });
              }
            }}
          />
        );
      },
      renderTimedLaneContext: (context) => (
        <WorkLocationTimedLaneContext
          regions={model.regions}
          context={context}
          displayTimezone={timezone}
          onOpen={openRegion}
          onEdit={(gesture) => {
            return persistCalendarEdit(
              workLocationTimedEdit({
                ...gesture,
                timezone,
              }),
            );
          }}
        />
      ),
      resolveTimedItemLeadingInset: ({ lane, bounds }) =>
        resolveWorkLocationTimedLeadingInset({
          regions: model.regions,
          lane,
          bounds,
          displayTimezone: timezone,
        }),
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
              resetMutationFailures();
              updateAssertion.mutate(
                { id: editingRegion.assertionId, input },
                { onSuccess: resetMutationFailures },
              );
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
            resetMutationFailures();
            setOccurrence.mutate({ id, date, input }, { onSuccess: resetMutationFailures });
          }}
          onRestore={(id, date) => {
            resetMutationFailures();
            clearOccurrence.mutate({ id, date }, { onSuccess: resetMutationFailures });
          }}
        />
      </>
    ),
  };
}
