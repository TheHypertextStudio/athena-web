/** Canonical schedule commands expose authoring drafts, never retained execution authority. */
import { OccurrenceId, ProgramId, RecurrenceSeriesId } from '@docket/work/ids';
import {
  WorkScheduleCreate,
  WorkScheduleDetailOut,
  WorkScheduleOut,
  WorkScheduleRevisionCreate,
  WorkScheduleRunOut,
  WorkScheduleRunPage,
  WorkScheduleRunRequest,
} from '@docket/work/work-schedule-management';
import { z } from 'zod';
import { orgIdParam } from './tools-shared';

const page = {
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
};
/** Each read intent accepts only its own bounded discovery or history arguments. */
export const WorkScheduleRead = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('list'), ownerProgramId: ProgramId.optional(), ...page }),
  z.strictObject({ action: z.literal('detail'), scheduleId: RecurrenceSeriesId }),
  z.strictObject({ action: z.literal('history'), scheduleId: RecurrenceSeriesId, ...page }),
]);
/** Each mutation intent validates through the same public contracts as REST. */
export const WorkScheduleCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create'), schedule: WorkScheduleCreate }),
  z.strictObject({
    action: z.literal('revise'),
    scheduleId: RecurrenceSeriesId,
    revision: WorkScheduleRevisionCreate,
  }),
  z.strictObject({ action: z.literal('pause'), scheduleId: RecurrenceSeriesId }),
  z.strictObject({ action: z.literal('resume'), scheduleId: RecurrenceSeriesId }),
  z.strictObject({ action: z.literal('end'), scheduleId: RecurrenceSeriesId }),
  z.strictObject({
    action: z.literal('run'),
    scheduleId: RecurrenceSeriesId,
    run: WorkScheduleRunRequest,
  }),
  z.strictObject({
    action: z.literal('retry'),
    scheduleId: RecurrenceSeriesId,
    occurrenceId: OccurrenceId,
  }),
]);
/** Read results distinguish discovery, current detail and history without unvalidated unions. */
export const WorkScheduleReadResult = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('list'),
    items: z.array(WorkScheduleOut),
    nextCursor: z.string().optional(),
  }),
  z.strictObject({ action: z.literal('detail'), schedule: WorkScheduleDetailOut }),
  z.strictObject({ action: z.literal('history'), runs: WorkScheduleRunPage }),
]);
/** Mutation receipts identify either the saved schedule or the exact attempted durable run. */
export const WorkScheduleCommandResult = z.discriminatedUnion('result', [
  z.strictObject({ result: z.literal('schedule'), schedule: WorkScheduleOut }),
  z.strictObject({ result: z.literal('run'), run: WorkScheduleRunOut }),
]);
/** Discovery and history share one compact read tool. */
export const listWorkSchedulesDefinition = {
  title: 'Read work schedules',
  description:
    'List visible schedules, reopen a private draft, or read run history.\n\nUse returned revision.id for checked future edits; failureCode and canRetry identify recoverable runs. Reading creates no work.',
  inputSchema: { orgId: orgIdParam, query: WorkScheduleRead },
  outputSchema: { data: WorkScheduleReadResult },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
/** Schedule management remains one intent-based mutation surface. */
export const manageWorkScheduleDefinition = {
  title: 'Manage work schedule',
  description:
    'Create recurring work, revise future runs, pause/resume/end, run or retry.\n\nUse published Task/Project templates and expectedRevisionId for future edits. Past work stays unchanged. Calendar/completion runs use date identity; omit occurrenceKey. Retry retains accepted versions and cannot create duplicate work. End is permanent.',
  inputSchema: { orgId: orgIdParam, command: WorkScheduleCommand },
  outputSchema: { data: WorkScheduleCommandResult },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};
