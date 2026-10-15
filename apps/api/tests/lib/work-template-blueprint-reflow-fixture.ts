import { eq } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import { TeamId } from '@docket/identity-access/ids';
import { WorkTypeId } from '@docket/work/ids';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { createWork } from '../../src/lib/work-creation/service';
import { appProvenance, originFor } from '../../src/lib/provenance/context';
import { seedTaskAccessOrg, seedUserWithHub } from '../support/routes-harness';

function reflowFixtureSteps(): BlueprintStep[] {
  const common = {
    parentStepKey: null,
    sort: 0,
    template: null,
    optional: { enabled: false, selectedByDefault: true },
    teamRule: 'parent_team',
    actorRule: 'creator',
    dates: {},
  };
  const anchor = (days: number) => ({
    kind: 'anchor',
    anchor: { kind: 'parent' },
    offset: { days, unit: 'working' },
  });
  return [
    BlueprintStep.parse({
      ...common,
      key: 'checkpoint',
      kind: 'milestone',
      fields: { name: 'Checkpoint' },
      dates: { targetDate: anchor(-2) },
    }),
    BlueprintStep.parse({
      ...common,
      key: 'prepare',
      kind: 'task',
      cycleRule: 'none',
      fields: { title: 'Prepare', description: 'Preserved edited body' },
      dates: { startDate: anchor(-4), dueDate: anchor(-1) },
    }),
    BlueprintStep.parse({
      ...common,
      key: 'finish',
      kind: 'task',
      cycleRule: 'none',
      fields: { title: 'Finish' },
      dates: {
        dueDate: {
          kind: 'after_completion',
          stepKeys: ['prepare'],
          offset: { days: 1, unit: 'working' },
        },
      },
    }),
    BlueprintStep.parse({
      ...common,
      key: 'milestone_task',
      kind: 'task',
      cycleRule: 'none',
      fields: { title: 'Milestone followup' },
      dates: {
        dueDate: {
          kind: 'anchor',
          anchor: { kind: 'milestone', stepKey: 'checkpoint' },
          offset: { days: 1, unit: 'calendar' },
        },
      },
    }),
  ];
}
/** One canonical generation with parent, Milestone, completion and independent date rules. */
export async function reflowFixture(schema: typeof DbModule, timezone?: string) {
  const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
  if (timezone) {
    const userId = await seedUserWithHub(schema.db, schema, 'Reflow timezone');
    await schema.db
      .update(schema.actor)
      .set({ userId })
      .where(eq(schema.actor.id, base.humanActorId));
    await schema.db
      .update(schema.hub)
      .set({ preferences: { timezone } })
      .where(eq(schema.hub.userId, userId));
  }
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['manage'],
  };
  const steps = reflowFixtureSteps();
  const draft = await createWorkTemplate(caller, {
    targetType: 'project',
    scope: 'personal',
    offeredTeamIds: [],
    definition: WorkTemplateDefinition.parse({
      name: 'Dinner',
      payload: { targetType: 'project' },
      blueprint: { steps, dependencies: [] },
    }),
  });
  const published = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  const created = await createWork({
    caller,
    kind: 'project',
    body: {
      name: 'Dinner',
      teamId: TeamId.parse(base.teamId),
      targetDate: '2026-11-20',
      workTypeId: WorkTypeId.parse(published.id),
    },
    invocation: { origin: originFor('project_create', {}, appProvenance()) },
  });
  if (created.root.kind !== 'project') throw new Error('Expected Project root');
  const byPath = new Map(
    created.created.map((work) => [work.row.blueprintPath?.join('/') ?? '', work]),
  );
  return { ...base, caller, published, root: created.root.row, byPath };
}
