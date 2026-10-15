'use client';
import type {
  WorkScheduleCreate,
  WorkScheduleRevisionCreate,
  WorkScheduleLifecycle,
  WorkScheduleRunRequest,
  WorkScheduleOut,
} from '@docket/work/work-schedule-management';
import { api } from '@/lib/api';
import { apiInfiniteQueryOptions, apiQueryOptions, unwrap, useApiMutation } from '@/lib/query';

/** Canonical schedule cache family shared by authoring, lifecycle and history. */
export function workScheduleKey(orgId: string): readonly string[] {
  return ['org', orgId, 'work-schedules'];
}
/** Bounded Program-owned schedules, retaining the server's opaque cursor. */
export function workSchedulesDef(orgId: string, programId: string) {
  return apiInfiniteQueryOptions(
    [...workScheduleKey(orgId), 'program', programId],
    (cursor) =>
      api.v1.orgs[':orgId']['work-schedules'].$get({
        param: { orgId },
        query: { ownerProgramId: programId, limit: '20', ...(cursor ? { cursor } : {}) },
      }),
    (page) => page.nextCursor,
    'Could not load schedules.',
  );
}
/** Authorized revision and its first bounded run page. */
export function workScheduleDef(orgId: string, id: string) {
  return apiQueryOptions(
    [...workScheduleKey(orgId), id],
    () => api.v1.orgs[':orgId']['work-schedules'][':id'].$get({ param: { orgId, id } }),
    'Could not load this schedule.',
  );
}
/** Paginated durable run history, without private execution documents. */
export function workScheduleRunsDef(orgId: string, id: string) {
  return apiInfiniteQueryOptions(
    [...workScheduleKey(orgId), id, 'runs'],
    (cursor) =>
      api.v1.orgs[':orgId']['work-schedules'][':id'].runs.$get({
        param: { orgId, id },
        query: { limit: '20', ...(cursor ? { cursor } : {}) },
      }),
    (page) => page.nextCursor,
    'Could not load run history.',
  );
}
/** Canonical read-only review of the concrete title, nested work, dates and choices. */
export function schedulePreviewDef(
  orgId: string,
  input: WorkScheduleCreate | null,
  enabled = true,
  schedule?: WorkScheduleOut,
) {
  return apiQueryOptions(
    [...workScheduleKey(orgId), 'preview', schedule?.id, schedule?.revision.id, input],
    () => previewSchedule(orgId, requireInput(input), schedule),
    'Could not review scheduled work.',
    { enabled: enabled && input !== null },
  );
}
function previewSchedule(
  orgId: string,
  input: WorkScheduleCreate,
  schedule: WorkScheduleOut | undefined,
) {
  if (!schedule)
    return api.v1.orgs[':orgId']['work-schedules'].preview.$post({ param: { orgId }, json: input });
  const { ownerProgramId: _owner, ...revision } = input;
  return api.v1.orgs[':orgId']['work-schedules'][':id'].preview.$post({
    param: { orgId, id: schedule.id },
    json: { ...revision, expectedRevisionId: schedule.revision.id },
  });
}
function requireInput(input: WorkScheduleCreate | null): WorkScheduleCreate {
  if (!input) throw new Error('Review valid schedule input.');
  return input;
}
/** Schedule writes retain application-owned errors and refresh the same canonical reads. */
export function useWorkScheduleWrites(orgId: string) {
  const invalidateKeys = [workScheduleKey(orgId)];
  return {
    create: useApiMutation({
      mutationFn: (input: WorkScheduleCreate) =>
        unwrap(
          () => api.v1.orgs[':orgId']['work-schedules'].$post({ param: { orgId }, json: input }),
          'Could not start this schedule.',
        ),
      invalidateKeys,
    }),
    revise: useApiMutation({
      mutationFn: ({ id, ...input }: WorkScheduleRevisionCreate & { id: string }) =>
        unwrap(
          () =>
            api.v1.orgs[':orgId']['work-schedules'][':id'].revisions.$post({
              param: { orgId, id },
              json: input,
            }),
          'Could not save future runs.',
        ),
      invalidateKeys,
    }),
    lifecycle: useApiMutation({
      mutationFn: ({ id, action }: WorkScheduleLifecycle & { id: string }) =>
        unwrap(
          () =>
            api.v1.orgs[':orgId']['work-schedules'][':id'].lifecycle.$post({
              param: { orgId, id },
              json: { action },
            }),
          'Could not change this schedule.',
        ),
      invalidateKeys,
    }),
    run: useApiMutation({
      mutationFn: ({ id, ...input }: WorkScheduleRunRequest & { id: string }) =>
        unwrap(
          () =>
            api.v1.orgs[':orgId']['work-schedules'][':id'].runs.$post({
              param: { orgId, id },
              json: input,
            }),
          'Could not run this schedule.',
        ),
      invalidateKeys,
    }),
    retry: useApiMutation({
      mutationFn: ({ id, occurrenceId }: { id: string; occurrenceId: string }) =>
        unwrap(
          () =>
            api.v1.orgs[':orgId']['work-schedules'][':id'].runs[':occurrenceId'].retry.$post({
              param: { orgId, id, occurrenceId },
            }),
          'Could not retry this run.',
        ),
      invalidateKeys,
    }),
  };
}
