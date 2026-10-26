import { beforeAll, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { ProcessDefinitionId } from '@docket/work/ids';
import { WorkTemplateListQuery } from '@docket/work/work-template-contract';
import { createCanonicalPrivateDefinition } from '../../src/lib/recurrence/private-definition-publication';
import {
  createRecurrenceSeries,
  materializeSeriesOccurrence,
} from '../../src/lib/recurrence/series';
import { listWorkTemplates } from '../../src/lib/templates/service';
import { loadCreationActor } from '../../src/lib/work-creation/context';
import {
  getPrivatePublicationDb,
  seedPrivatePublicationActor,
} from '../support/private-publication-fixture';
import { installPrivateAliasReferenceCandidate } from '../support/private-alias-reference-candidate';
import { communityDinner } from '../support/private-schedule-run-fixture';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getPrivatePublicationDb();
  await installPrivateAliasReferenceCandidate(schema.db);
  await schema.db.execute(sql`select docket_enforce_private_alias_references()`);
});

it('runs inline private structure under base identities with registered private origins and no library entries', async () => {
  const f = await seedPrivatePublicationActor(schema.db, schema);
  const label = assertDefined(
    (
      await schema.db
        .insert(schema.label)
        .values({ organizationId: f.orgId, name: 'Dinner', color: '#6366f1' })
        .returning()
    )[0],
  );
  const reader = await loadCreationActor(schema.db, f.orgId, f.humanActorId);
  const query = WorkTemplateListQuery.parse({});
  const before = await listWorkTemplates(reader, query, { seedDefaults: false });
  const publication = await createCanonicalPrivateDefinition(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    definition: communityDinner(f.teamId, label.id),
  });
  expect(
    (await listWorkTemplates(reader, query, { seedDefaults: false })).map((row) => row.id),
  ).toEqual(before.map((row) => row.id));
  const steps = await schema.db
    .select()
    .from(schema.privateStep)
    .where(eq(schema.privateStep.organizationId, f.orgId));
  expect(steps.map((step) => [step.stepAlias, step.kind, step.path]).sort()).toEqual(
    [
      [publication.stepIdsByKey['dinner'], 'project', []],
      [publication.stepIdsByKey['prep'], 'milestone', ['prep']],
      [publication.stepIdsByKey['menu'], 'task', ['menu']],
      [publication.stepIdsByKey['shop'], 'task', ['shop']],
    ].sort(),
  );

  const series = await createRecurrenceSeries(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    series: {
      processDefinitionId: ProcessDefinitionId.parse(publication.definitionId),
      name: 'Monthly dinner',
      effectiveFrom: '2026-10-26',
      trigger: { kind: 'manual' },
    },
  });
  const run = await materializeSeriesOccurrence(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    seriesId: series.id,
    scheduledFor: '2026-10-26',
  });
  const projectId = assertDefined(run.projectIdsByKey['dinner']);
  const milestoneId = assertDefined(run.milestoneIdsByKey['prep']);
  const [project] = await schema.db
    .select()
    .from(schema.project)
    .where(eq(schema.project.id, projectId));
  const [base] = await schema.db
    .select({ id: schema.template.id })
    .from(schema.template)
    .where(
      and(
        eq(schema.template.organizationId, f.orgId),
        eq(schema.template.isBase, true),
        eq(schema.template.targetType, 'project'),
      ),
    );
  expect(project?.workTypeId).toBe(base?.id);
  const [occurrence] = await schema.db
    .select({ invocationId: schema.processOccurrence.blueprintInvocationId })
    .from(schema.processOccurrence)
    .where(eq(schema.processOccurrence.id, run.occurrenceId));
  const invocationId = assertDefined(occurrence?.invocationId);

  const [milestone] = await schema.db
    .select()
    .from(schema.milestone)
    .where(eq(schema.milestone.id, milestoneId));
  expect(milestone).toMatchObject({
    projectId,
    privateInvocationId: invocationId,
    privateStepAlias: publication.stepIdsByKey['prep'],
    blueprintStepId: null,
  });
  const tasks = await schema.db
    .select()
    .from(schema.task)
    .where(eq(schema.task.organizationId, f.orgId));
  expect(
    tasks.map((task) => [task.id, task.projectId, task.milestoneId, task.privateStepAlias]).sort(),
  ).toEqual(
    [
      [run.taskIdsByKey['menu'], projectId, null, publication.stepIdsByKey['menu']],
      [run.taskIdsByKey['shop'], projectId, milestoneId, publication.stepIdsByKey['shop']],
    ].sort(),
  );
  expect(tasks.every((task) => task.privateInvocationId === invocationId)).toBe(true);
  expect(tasks.every((task) => task.blueprintStepId === null)).toBe(true);
});
