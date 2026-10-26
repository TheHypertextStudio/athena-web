import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { ProcessDefinitionId } from '@docket/work/ids';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { createCanonicalPrivateDefinition } from '../../src/lib/recurrence/private-definition-publication';
import {
  createRecurrenceSeries,
  materializeSeriesOccurrence,
} from '../../src/lib/recurrence/series';
import type { PublishedProcessRevision } from '../../src/lib/recurrence/process-definition';
import type { MaterializedOccurrence } from '../../src/lib/recurrence/materialize';
import { seedPrivatePublicationActor } from './private-publication-fixture';

/** A published private Project definition with a Milestone and two Tasks, run once. */
export interface PrivateScheduleRun {
  readonly orgId: string;
  readonly teamId: string;
  readonly actorId: string;
  readonly labelId: string;
  readonly publication: PublishedProcessRevision;
  readonly seriesId: string;
  readonly run: MaterializedOccurrence;
  readonly invocationId: string;
}

/** Authored community dinner: Project, a prep Milestone, a Task under it and one directly under the Project. */
export function communityDinner(teamId: string, labelId: string): ProcessDefinitionCreate {
  return ProcessDefinitionCreate.parse({
    name: 'Community dinner',
    project: { key: 'dinner', name: 'Dinner {month}', labelIds: [labelId] },
    milestones: [{ key: 'prep', projectKey: 'dinner', name: 'Prep done', targetOffsetDays: 2 }],
    tasks: [
      { key: 'menu', title: 'Plan the menu', teamId, projectKey: 'dinner', dueOffsetDays: 1 },
      {
        key: 'shop',
        title: 'Buy groceries',
        teamId,
        projectKey: 'dinner',
        milestoneKey: 'prep',
        labelIds: [labelId],
      },
    ],
  });
}

/**
 * Seed an author, publish the dinner definition privately and run its manual schedule once.
 * Requires the alias-reference candidate to be installed and enforced on this database.
 */
export async function publishAndRunCommunityDinner(
  schema: typeof DbModule,
): Promise<PrivateScheduleRun> {
  const f = await seedPrivatePublicationActor(schema.db, schema);
  const label = assertDefined(
    (
      await schema.db
        .insert(schema.label)
        .values({ organizationId: f.orgId, name: 'Dinner', color: '#6366f1' })
        .returning()
    )[0],
  );
  const publication = await createCanonicalPrivateDefinition(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    definition: communityDinner(f.teamId, label.id),
  });
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
  const [occurrence] = await schema.db
    .select({ invocationId: schema.processOccurrence.blueprintInvocationId })
    .from(schema.processOccurrence)
    .where(eq(schema.processOccurrence.id, run.occurrenceId));
  return {
    orgId: f.orgId,
    teamId: f.teamId,
    actorId: f.humanActorId,
    labelId: label.id,
    publication,
    seriesId: series.id,
    run,
    invocationId: assertDefined(occurrence?.invocationId),
  };
}
