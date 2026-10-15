import type * as DbModule from '@docket/db';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { ProgramDefaultSchedule } from '@docket/work/work-schedule-defaults';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { ProgramCreate } from '@docket/work/program-contract';
import { TeamId } from '@docket/identity-access/ids';
import { appProvenance, originFor } from '../../src/lib/provenance/context';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { seedTaskAccessOrg } from '../support/routes-harness';

/** Published Program with a genuine independent calendar default and ordinary real actor. */
export async function defaultScheduleFixture(schema: typeof DbModule) {
  const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['manage'],
  };
  const project = await createWorkTemplate(caller, {
    targetType: 'project',
    scope: 'organization',
    offeredTeamIds: [],
    definition: WorkTemplateDefinition.parse({
      name: 'Dinner',
      payload: { targetType: 'project' },
    }),
  });
  await publishWorkTemplate(caller, project.id, project.draftRevision);
  const outline = ProgramDefaultSchedule.parse({
    key: 'dinner',
    name: 'Community dinner',
    template: { targetType: 'project', workTypeId: project.id, selection: { kind: 'latest' } },
    titlePattern: '{month} Dinner',
    cadence: {
      kind: 'monthly',
      pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
      startOffsetDays: 0,
    },
    teamRule: 'none',
    actorRule: 'parent_responsible',
  });
  const draft = await createWorkTemplate(caller, {
    targetType: 'program',
    scope: 'organization',
    offeredTeamIds: [],
    definition: WorkTemplateDefinition.parse({
      name: 'Dinners',
      payload: { targetType: 'program' },
      blueprint: {
        steps: [
          BlueprintStep.parse({
            key: 'prepare_program',
            kind: 'task',
            parentStepKey: null,
            sort: 0,
            fields: { title: 'Prepare the Program' },
            template: null,
            optional: { enabled: false, selectedByDefault: true },
            teamRule: 'creation_team',
            actorRule: 'creator',
            cycleRule: 'none',
            dates: {},
          }),
        ],
        dependencies: [],
      },
      defaultSchedules: [outline],
    }),
  });
  const published = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  const command = {
    caller,
    kind: 'program' as const,
    body: ProgramCreate.parse({
      name: 'Community dinners',
      ownerId: caller.actorId,
      workTypeId: published.id,
    }),
    invocation: { origin: originFor('program_create', {}, appProvenance()) },
    blueprint: { optionalChoices: [], creationTeamId: TeamId.parse(base.teamId) },
  };
  return { ...base, caller, project, outline, published, command };
}
