import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { ProcessDefinitionCreate, RecurrenceSeriesCreate } from '../../src/contracts/recurrence';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import { createRecurrenceSeries } from '../../src/lib/recurrence/series';
import { materializeOccurrence } from '../../src/lib/recurrence/materialize';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { loadCreationActor } from '../../src/lib/work-creation/context';
import { one } from '../support/routes-harness';
import { seedMcpUpdateOrg, type McpUpdateSeed } from './mcp-update-tool-fixtures';

/** Real published private completion consumers and their managed public descendants in one MCP workspace. */
export interface RetainedUpdateFixture {
  readonly seed: McpUpdateSeed;
  readonly firstIds: readonly string[];
  readonly secondIds: readonly string[];
}
function childTemplate(count: number): WorkTemplateDefinition {
  return WorkTemplateDefinition.parse({
    name: 'Completion follow-up',
    payload: { targetType: 'task' },
    blueprint: {
      steps: Array.from({ length: count }, (_, index) => ({
        key: `child_${index}`,
        kind: 'task',
        parentStepKey: null,
        sort: index,
        fields: { title: `Follow-up ${index}` },
        template: null,
        optional: { enabled: false, selectedByDefault: true },
        teamRule: 'parent_team',
        actorRule: 'unassigned',
        cycleRule: 'none',
        dates: {
          dueDate: {
            kind: 'anchor',
            anchor: { kind: 'parent' },
            offset: { days: 0, unit: 'calendar' },
          },
        },
      })),
      dependencies: [],
    },
  });
}
/** Publish and materialize genuine retained occurrences; every occurrence independently respects the creation cap. */
export async function seedRetainedUpdateFixture(
  schema: typeof DbModule,
  childCount: number,
  dates: readonly string[] = ['2026-10-14', '2026-10-15'],
): Promise<RetainedUpdateFixture> {
  const seed = await seedMcpUpdateOrg(schema.db, schema, ['manage']);
  const caller = await loadCreationActor(schema.db, seed.orgId, seed.actorId);
  const draft = await createWorkTemplate(caller, {
    targetType: 'task',
    scope: 'personal',
    offeredTeamIds: [],
    definition: childTemplate(childCount),
  });
  const selected = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  const source = await createPublishedProcessDefinition(schema.db, {
    organizationId: seed.orgId,
    actorId: seed.actorId,
    definition: ProcessDefinitionCreate.parse({
      name: 'Completion follow-up',
      creationMode: 'all_at_once',
      tasks: [
        { key: 'first', title: 'First', teamId: seed.teamId },
        {
          key: 'second',
          title: 'Second',
          teamId: seed.teamId,
          workTypeId: selected.id,
          workTypeVersionId: selected.latestPublishedVersionId,
          timing: { kind: 'after_step_completion', stepKey: 'first', offsetDays: 2 },
        },
      ],
    }),
  });
  const series = await createRecurrenceSeries(schema.db, {
    organizationId: seed.orgId,
    actorId: seed.actorId,
    series: RecurrenceSeriesCreate.parse({
      name: 'Completion follow-up',
      processDefinitionId: source.definitionId,
      effectiveFrom: dates[0],
      trigger: { kind: 'manual' },
    }),
  });
  const revision = one(
    await schema.db
      .select()
      .from(schema.recurrenceSeriesRevision)
      .where(eq(schema.recurrenceSeriesRevision.seriesId, series.id)),
  );
  const firstIds: string[] = [],
    secondIds: string[] = [];
  for (const date of dates) {
    const result = await materializeOccurrence(schema.db, {
      organizationId: seed.orgId,
      actorId: seed.actorId,
      seriesId: series.id,
      seriesRevisionId: revision.id,
      scheduledFor: date,
    });
    const first = result.taskIdsByKey['first'],
      second = result.taskIdsByKey['second'];
    if (!first || !second) throw new Error('Missing original retained Tasks');
    firstIds.push(first);
    secondIds.push(second);
  }
  return { seed, firstIds, secondIds };
}
