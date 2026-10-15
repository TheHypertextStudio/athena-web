import { db } from '@docket/db';
import { OccurrenceId, ProgramId, RecurrenceSeriesId } from '@docket/work/ids';
import {
  WorkScheduleCreate,
  WorkScheduleDetailOut,
  WorkScheduleLifecycle,
  WorkScheduleOut,
  WorkScheduleRevisionCreate,
  WorkScheduleRunOut,
  WorkScheduleRunPage,
  WorkScheduleRunRequest,
} from '@docket/work/work-schedule-management';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { createWorkSchedule, reviseWorkSchedule } from '../lib/recurrence/schedule-authoring';
import { listWorkScheduleRuns } from '../lib/recurrence/schedule-history';
import { transitionWorkSchedule } from '../lib/recurrence/schedule-lifecycle';
import {
  loadWorkSchedule,
  loadWorkScheduleDetail,
  listWorkSchedules,
} from '../lib/recurrence/schedule-reads';
import { runWorkSchedule, retryWorkSchedule } from '../lib/recurrence/schedule-run-commands';
import workSchedulePreviews from './work-schedule-previews';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

const seriesParam = z.object({ id: RecurrenceSeriesId });
const runParam = seriesParam.extend({ occurrenceId: OccurrenceId });
const listQuery = CursorQuery.extend({ ownerProgramId: ProgramId.optional() });
function identity(c: Context<AppEnv>, id: string) {
  const caller = c.get('actorCtx');
  return { organizationId: caller.orgId, actorId: caller.actorId, seriesId: id };
}

/** Canonical schedule authoring and durable history reuse the existing scheduler and sole work writer. */
const workSchedules = new Hono<AppEnv>()
  .route('/', workSchedulePreviews)
  .get(
    '/',
    apiDoc({
      tag: 'Recurrence',
      summary: 'List work schedules',
      response: pageOf(WorkScheduleOut),
    }),
    zQuery(listQuery),
    async (c) => {
      const caller = c.get('actorCtx');
      return ok(
        c,
        pageOf(WorkScheduleOut),
        await listWorkSchedules(db, {
          organizationId: caller.orgId,
          actorId: caller.actorId,
          ...c.req.valid('query'),
        }),
      );
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Recurrence',
      summary: 'Create a work schedule',
      response: WorkScheduleDetailOut,
      status: 201,
    }),
    zJson(WorkScheduleCreate),
    async (c) => {
      const caller = c.get('actorCtx');
      const result = await createWorkSchedule(db, {
        organizationId: caller.orgId,
        actorId: caller.actorId,
        ...c.req.valid('json'),
      });
      return created(
        c,
        WorkScheduleDetailOut,
        await loadWorkScheduleDetail(db, identity(c, result.series.id)),
      );
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Recurrence',
      summary: 'Read a work schedule and its run history',
      response: WorkScheduleDetailOut,
    }),
    zParam(seriesParam),
    async (c) =>
      ok(
        c,
        WorkScheduleDetailOut,
        await loadWorkScheduleDetail(db, identity(c, c.req.valid('param').id)),
      ),
  )
  .post(
    '/:id/revisions',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Recurrence',
      summary: 'Edit future scheduled work',
      response: WorkScheduleDetailOut,
    }),
    zParam(seriesParam),
    zJson(WorkScheduleRevisionCreate),
    async (c) => {
      const input = identity(c, c.req.valid('param').id);
      await reviseWorkSchedule(db, { ...input, ...c.req.valid('json') });
      return ok(c, WorkScheduleDetailOut, await loadWorkScheduleDetail(db, input));
    },
  )
  .post(
    '/:id/lifecycle',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Recurrence',
      summary: 'Pause, resume or end a work schedule',
      response: WorkScheduleOut,
    }),
    zParam(seriesParam),
    zJson(WorkScheduleLifecycle),
    async (c) => {
      const input = identity(c, c.req.valid('param').id);
      await transitionWorkSchedule(db, input, c.req.valid('json'));
      return ok(c, WorkScheduleOut, await loadWorkSchedule(db, input));
    },
  )
  .get(
    '/:id/runs',
    apiDoc({
      tag: 'Recurrence',
      summary: 'Read scheduled run history',
      response: WorkScheduleRunPage,
    }),
    zParam(seriesParam),
    zQuery(CursorQuery),
    async (c) =>
      ok(
        c,
        WorkScheduleRunPage,
        await listWorkScheduleRuns(db, identity(c, c.req.valid('param').id), c.req.valid('query')),
      ),
  )
  .post(
    '/:id/runs',
    capabilityGuard('contribute'),
    apiDoc({ tag: 'Recurrence', summary: 'Run scheduled work once', response: WorkScheduleRunOut }),
    zParam(seriesParam),
    zJson(WorkScheduleRunRequest),
    async (c) => {
      const input = identity(c, c.req.valid('param').id);
      return ok(c, WorkScheduleRunOut, await runWorkSchedule(db, input, c.req.valid('json')));
    },
  )
  .post(
    '/:id/runs/:occurrenceId/retry',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Recurrence',
      summary: 'Retry a failed scheduled run',
      response: WorkScheduleRunOut,
    }),
    zParam(runParam),
    async (c) => {
      const { id, occurrenceId } = c.req.valid('param');
      const input = identity(c, id);
      return ok(c, WorkScheduleRunOut, await retryWorkSchedule(db, input, occurrenceId));
    },
  );

export default workSchedules;
