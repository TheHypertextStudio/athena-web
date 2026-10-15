import type * as DbModule from '@docket/db';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { seedTaskAccessOrg, one } from '../support/routes-harness';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';

/** A persisted lawful single-root legacy binding using current canonical publications. */
export async function retainedFixture(
  schema: typeof DbModule,
  pending = false,
  invalid?: 'key' | 'overrides',
  templateDefinition?: WorkTemplateDefinition | ((base: Base) => Promise<WorkTemplateDefinition>),
) {
  const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const preparedDefinition =
    typeof templateDefinition === 'function' ? await templateDefinition(base) : templateDefinition;
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['manage'],
  };
  const draft = await createWorkTemplate(caller, {
    targetType: 'task',
    scope: 'personal',
    offeredTeamIds: [],
    definition:
      preparedDefinition ??
      WorkTemplateDefinition.parse({
        name: 'Recurring report',
        payload: { targetType: 'task', title: 'Report' },
      }),
  });
  const published = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  if (!published.latestPublishedVersionId) throw new Error('Missing published fixture');
  const { definition, revision, step } = await originalProcess(schema, base, {
    published,
    pending,
  });
  const invocation = await originalInvocation(schema, base, published, {
    revisionId: revision.id,
    stepId: step.id,
    pending,
    invalid,
  });
  const { series, seriesRevision, occurrence, instance } = await occurrenceBinding(
    schema,
    base,
    published,
    { definitionId: definition.id, revisionId: revision.id, invocationId: invocation.id, pending },
  );
  return {
    ...base,
    caller,
    published,
    definition,
    revision,
    step,
    invocation,
    series,
    seriesRevision,
    occurrence,
    instance,
    request: {
      organizationId: base.orgId,
      seriesId: series.id,
      seriesRevisionId: seriesRevision.id,
      occurrenceId: occurrence.id,
      instanceId: instance.id,
    },
  };
}
type Base = Awaited<ReturnType<typeof seedTaskAccessOrg>>;
type Published = Awaited<ReturnType<typeof publishWorkTemplate>>;

async function originalProcess(
  schema: typeof DbModule,
  base: Base,
  options: { published: Published; pending: boolean },
) {
  const { published, pending } = options;
  const definition = one(
    await schema.db
      .insert(schema.processDefinition)
      .values({
        organizationId: base.orgId,
        name: 'Reports',
        status: pending ? 'draft' : 'published',
        createdBy: base.humanActorId,
      })
      .returning(),
  );
  const revision = one(
    await schema.db
      .insert(schema.processRevision)
      .values({
        organizationId: base.orgId,
        definitionId: definition.id,
        number: 1,
        creationMode: 'all_at_once',
        publishedAt: pending ? null : new Date(),
      })
      .returning(),
  );
  const step = one(
    await schema.db
      .insert(schema.processStep)
      .values({
        organizationId: base.orgId,
        revisionId: revision.id,
        key: 'report',
        kind: 'task',
        sort: 0,
        timingKind: 'on_trigger',
      })
      .returning(),
  );
  await schema.db.insert(schema.processTaskSpec).values({
    organizationId: base.orgId,
    stepId: step.id,
    title: 'Report',
    teamId: base.teamId,
    workTypeId: pending ? null : published.id,
    workTypeVersionId: pending ? null : published.latestPublishedVersionId,
  });
  return { definition, revision, step };
}

async function originalInvocation(
  schema: typeof DbModule,
  base: Base,
  published: Published,
  source: {
    revisionId: string;
    stepId: string;
    pending: boolean;
    invalid: 'key' | 'overrides' | undefined;
  },
) {
  const { revisionId, stepId, pending, invalid } = source;
  const manifest: DbModule.BlueprintInvocationManifest = {
    kind: pending ? 'pending_draft' : 'published',
    legacyProcessRevisionId: revisionId,
    roots: [
      {
        sourceStepId: stepId,
        sourceKey: invalid === 'key' ? 'changed' : 'report',
        key: 'report',
        kind: 'task',
        workTypeId: pending ? null : published.id,
        workTypeVersionId: pending ? null : published.latestPublishedVersionId,
      },
    ],
    steps: [
      {
        sourceStepId: stepId,
        sourceKey: 'report',
        rootKey: 'report',
        path: [],
        blueprintStepId: null,
        sourceVersionId: null,
      },
    ],
    dependencies: [],
  };
  const invocation = one(
    await schema.db
      .insert(schema.blueprintInvocation)
      .values({
        organizationId: base.orgId,
        ownerActorId: base.humanActorId,
        manifest,
        overrides:
          invalid === 'overrides'
            ? []
            : [
                {
                  sourceStepId: stepId,
                  kind: 'task',
                  fields: { title: 'Report', team_id: base.teamId },
                  timing: { kind: 'on_trigger', offsetDays: null, afterStepId: null },
                },
              ],
      })
      .returning(),
  );
  return invocation;
}

async function occurrenceBinding(
  schema: typeof DbModule,
  base: Base,
  published: Published,
  source: { definitionId: string; revisionId: string; invocationId: string; pending: boolean },
) {
  const { definitionId, revisionId, invocationId, pending } = source;
  const series = one(
    await schema.db
      .insert(schema.recurrenceSeries)
      .values({
        organizationId: base.orgId,
        definitionId: definitionId,
        name: 'Reports',
        createdBy: base.humanActorId,
      })
      .returning(),
  );
  const seriesRevision = one(
    await schema.db
      .insert(schema.recurrenceSeriesRevision)
      .values({
        organizationId: base.orgId,
        seriesId: series.id,
        processRevisionId: revisionId,
        number: 1,
        effectiveFrom: '2026-10-14',
        triggerKind: 'manual',
        blueprintInvocationId: invocationId,
        workTypeId: pending ? null : published.id,
        workTypeVersionId: pending ? null : published.latestPublishedVersionId,
      })
      .returning(),
  );
  const occurrence = one(
    await schema.db
      .insert(schema.processOccurrence)
      .values({
        organizationId: base.orgId,
        seriesId: series.id,
        seriesRevisionId: seriesRevision.id,
        scheduledFor: '2026-10-14',
        blueprintInvocationId: invocationId,
        blueprintRootRefs: [],
      })
      .returning(),
  );
  const instance = one(
    await schema.db
      .insert(schema.processInstance)
      .values({
        organizationId: base.orgId,
        definitionId: definitionId,
        revisionId: revisionId,
        occurrenceId: occurrence.id,
      })
      .returning(),
  );
  return { series, seriesRevision, occurrence, instance };
}
