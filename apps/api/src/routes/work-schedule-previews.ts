import { db, genId } from '@docket/db';
import { RecurrenceSeriesId } from '@docket/work/ids';
import type { OptionalChoice } from '@docket/work/work-template-blueprint';
import {
  WorkScheduleCreate,
  WorkScheduleRevisionCreate,
  WorkSchedulePreviewOut,
} from '@docket/work/work-schedule-management';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { ConflictError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { prepareWorkScheduleRevisionCommand } from '../lib/recurrence/schedule-authoring';
import { compileScheduleCommand } from '../lib/recurrence/schedule-compiler';
import { firstScheduleRunDate } from '../lib/recurrence/schedule-review-date';
import { loadCreationActor } from '../lib/work-creation/context';
import { previewBlueprintCreation } from '../lib/work-template-blueprints/preview';
import { requireWorkAccess } from '../lib/work-template-selection';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import type { TemplateTransaction } from '../lib/templates/persistence';
import type { WorkCreationBatchCommand } from '../lib/work-creation/types';

async function reviewScheduledRoot(
  tx: TemplateTransaction,
  batch: WorkCreationBatchCommand,
  date: string,
  optionalChoices: OptionalChoice[],
): Promise<WorkSchedulePreviewOut> {
  const root = batch.roots[0];
  if (!root) throw new ConflictError('Choose work to schedule');
  const command = root.command;
  const title =
    command.kind === 'task'
      ? command.body.title
      : command.kind === 'project'
        ? command.body.name
        : null;
  if (title === null) throw new ConflictError('Choose Task or Project work to schedule');
  const preview = await previewBlueprintCreation(tx, command, { optionalChoices });
  return { ...preview, scheduledFor: date, title };
}

/** Review scheduled work using the same ordinary creation preflight and persisted revision authority. */
const workSchedulePreviews = new Hono<AppEnv>()
  .post(
    '/preview',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Recurrence',
      summary: 'Review scheduled work before saving',
      response: WorkSchedulePreviewOut,
    }),
    zJson(WorkScheduleCreate),
    async (c) => {
      const body = c.req.valid('json');
      const caller = c.get('actorCtx');
      const date = firstScheduleRunDate(body.trigger, body.effectiveFrom);
      if (!date) throw new ConflictError('The cadence has no future run');
      const result = await db.transaction(async (tx) => {
        const live = await loadCreationActor(tx, caller.orgId, caller.actorId);
        if (body.ownerProgramId) await requireWorkAccess(tx, live, 'program', body.ownerProgramId);
        const batch = compileScheduleCommand({
          caller: live,
          seriesId: genId(),
          ownerProgramId: body.ownerProgramId ?? null,
          runDate: date,
          document: body.document,
        });
        return reviewScheduledRoot(tx, batch, date, body.document.optionalChoices);
      });
      return ok(c, WorkSchedulePreviewOut, result);
    },
  )
  .post(
    '/:id/preview',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Recurrence',
      summary: 'Review future changes to an existing work schedule',
      response: WorkSchedulePreviewOut,
    }),
    zParam(z.object({ id: RecurrenceSeriesId })),
    zJson(WorkScheduleRevisionCreate),
    async (c) => {
      const body = c.req.valid('json');
      const caller = c.get('actorCtx');
      const date = firstScheduleRunDate(body.trigger, body.effectiveFrom);
      if (!date) throw new ConflictError('The cadence has no future run');
      const result = await db.transaction(async (tx) => {
        const batch = await prepareWorkScheduleRevisionCommand(tx, {
          organizationId: caller.orgId,
          actorId: caller.actorId,
          seriesId: c.req.valid('param').id,
          expectedRevisionId: body.expectedRevisionId,
          effectiveFrom: body.effectiveFrom,
          document: body.document,
          runDate: date,
        });
        return reviewScheduledRoot(tx, batch, date, body.document.optionalChoices);
      });
      return ok(c, WorkSchedulePreviewOut, result);
    },
  );

export default workSchedulePreviews;
