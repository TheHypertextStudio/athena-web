import type * as DbModule from '@docket/db';
import { WorkScheduleCreate, WorkScheduleDetailOut } from '@docket/work/work-schedule-management';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import type schedulesRouter from '../../src/routes/work-schedules';
import { appWithActor, seedProgram, seedTaskAccessOrg } from '../support/routes-harness';
import { expect } from 'vitest';
function eventDefinition(): WorkTemplateDefinition {
  return WorkTemplateDefinition.parse({
    name: 'Event',
    payload: { targetType: 'project', name: 'Event' },
    blueprint: {
      steps: [
        {
          key: 'book_venue',
          kind: 'task',
          parentStepKey: null,
          sort: 0,
          fields: { title: 'Book venue' },
          template: null,
          optional: { enabled: false, selectedByDefault: true },
          teamRule: 'parent_team',
          actorRule: 'unassigned',
          cycleRule: 'none',
          dates: {
            dueDate: {
              kind: 'anchor',
              anchor: { kind: 'parent' },
              offset: { days: -7, unit: 'calendar' },
            },
          },
        },
      ],
      dependencies: [],
    },
  });
}
/** Representative Program-owned schedule with genuine nested work and existing authorization. */
export async function scheduleRouteFixture(
  schema: typeof DbModule,
  router: typeof schedulesRouter,
) {
  const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['manage'],
  };
  const program = await seedProgram(schema.db, schema, base.statusId, {
    organizationId: base.orgId,
    name: 'Community dinners',
    createdBy: base.humanActorId,
  });
  const definition = eventDefinition();
  const draft = await createWorkTemplate(caller, {
    targetType: 'project',
    scope: 'organization',
    offeredTeamIds: [],
    definition,
  });
  await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  const command = WorkScheduleCreate.parse({
    ownerProgramId: program.id,
    name: 'Monthly dinner',
    effectiveFrom: '2026-10-01',
    trigger: {
      kind: 'calendar',
      schedule: {
        kind: 'monthly',
        interval: 1,
        startDate: '2026-10-01',
        timezone: 'America/Los_Angeles',
        end: { kind: 'never' },
        pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
      },
    },
    document: {
      kind: 'schedule',
      revision: 1,
      template: { targetType: 'project', workTypeId: draft.id, selection: { kind: 'latest' } },
      titlePattern: '{month} Dinner',
      timezone: 'America/Los_Angeles',
      root: {
        kind: 'project',
        fields: {},
        dates: {},
        placement: { programId: program.id },
        teamId: base.teamId,
      },
      stepOverrides: [],
      optionalChoices: [],
    },
  });
  return {
    ...base,
    program,
    command,
    app: appWithActor(router, base.orgId, ['manage'], base.humanActorId),
  };
}
/** Typed request helper preserving real server validation and output parsing. */
export async function createSchedule(f: Awaited<ReturnType<typeof scheduleRouteFixture>>) {
  const response = await f.app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(f.command),
  });
  expect(response.status).toBe(201);
  return WorkScheduleDetailOut.parse(await response.json());
}
