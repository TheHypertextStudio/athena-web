/** MCP adapters use canonical schedule services with the caller's current identity and grants. */
import { db } from '@docket/db';
import type { z } from 'zod';
import { createWorkSchedule, reviseWorkSchedule } from '../lib/recurrence/schedule-authoring';
import { listWorkScheduleRuns } from '../lib/recurrence/schedule-history';
import { transitionWorkSchedule } from '../lib/recurrence/schedule-lifecycle';
import {
  listWorkSchedules,
  loadWorkSchedule,
  loadWorkScheduleDetail,
} from '../lib/recurrence/schedule-reads';
import { runWorkSchedule, retryWorkSchedule } from '../lib/recurrence/schedule-run-commands';
import type { McpActor, McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import {
  listWorkSchedulesDefinition,
  manageWorkScheduleDefinition,
  type WorkScheduleCommand,
  WorkScheduleCommandResult,
  WorkScheduleReadResult,
} from './work-schedule-tools-contract';

async function mutateSchedule(
  actor: McpActor,
  command: z.infer<typeof WorkScheduleCommand>,
): Promise<z.infer<typeof WorkScheduleCommandResult>> {
  const identity = { organizationId: actor.orgId, actorId: actor.actorId };
  if (command.action === 'create') {
    const created = await createWorkSchedule(db, { ...identity, ...command.schedule });
    return {
      result: 'schedule',
      schedule: await loadWorkSchedule(db, { ...identity, seriesId: created.series.id }),
    };
  }
  const access = { ...identity, seriesId: command.scheduleId };
  if (command.action === 'run')
    return { result: 'run', run: await runWorkSchedule(db, access, command.run) };
  if (command.action === 'retry')
    return { result: 'run', run: await retryWorkSchedule(db, access, command.occurrenceId) };
  if (command.action === 'revise') await reviseWorkSchedule(db, { ...access, ...command.revision });
  else await transitionWorkSchedule(db, access, { action: command.action });
  return { result: 'schedule', schedule: await loadWorkSchedule(db, access) };
}

/** Register bounded schedule discovery and intent-based management without another writer. */
export function registerWorkScheduleTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool('list_work_schedules', listWorkSchedulesDefinition, (input) =>
    runTool(async () => {
      const actor = await scopedActor(ctx, input.orgId, 'work:read');
      await authorize(actor, 'view', { kind: 'organization', id: actor.orgId, orgId: actor.orgId });
      const identity = { organizationId: actor.orgId, actorId: actor.actorId };
      const query = input.query;
      if (query.action === 'list') {
        const { action, ...page } = query;
        return jsonResult({
          data: WorkScheduleReadResult.parse({
            action,
            ...(await listWorkSchedules(db, { ...identity, ...page })),
          }),
        });
      }
      const access = { ...identity, seriesId: query.scheduleId };
      if (query.action === 'detail')
        return jsonResult({
          data: WorkScheduleReadResult.parse({
            action: query.action,
            schedule: await loadWorkScheduleDetail(db, access),
          }),
        });
      return jsonResult({
        data: WorkScheduleReadResult.parse({
          action: query.action,
          runs: await listWorkScheduleRuns(db, access, {
            limit: query.limit,
            cursor: query.cursor,
          }),
        }),
      });
    }),
  );
  server.registerTool('manage_work_schedule', manageWorkScheduleDefinition, (input) =>
    runTool(async () => {
      const actor = await scopedActor(ctx, input.orgId, 'work:write');
      await authorize(actor, 'contribute', {
        kind: 'organization',
        id: actor.orgId,
        orgId: actor.orgId,
      });
      return jsonResult({
        data: WorkScheduleCommandResult.parse(await mutateSchedule(actor, input.command)),
      });
    }),
  );
}
