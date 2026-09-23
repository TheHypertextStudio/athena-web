/**
 * `@docket/api` — record the work one materialization pass created.
 *
 * @remarks
 * Every project and task a repeating series creates is the series' doing, whoever or whatever ran
 * the pass: the scheduled sweep, a person completing the step before it, or a rule starting the
 * process. So the change set always records `rule` / `recurrence` with the series as its cause,
 * and is written in the pass's own transaction. The authority is the member who ran the pass when
 * there is one, and otherwise the member who created the series.
 */
import { processInstance, processOccurrence, project, recurrenceSeries, task } from '@docket/db';
import { eq, inArray } from 'drizzle-orm';

import { ruleProvenance } from '../provenance/context';
import { countOf, recordCreated, type CreatedEntity } from '../provenance/record-created';
import type {
  MaterializedStepDelta,
  MaterializeInstanceStepsCommand,
  ProcessTransaction,
} from './materialize';

/** The entities one pass created, keyed by authored step key. */
export interface CreatedStepEntities {
  readonly projects: ReadonlyMap<string, string>;
  readonly milestones: ReadonlyMap<string, string>;
  readonly tasks: ReadonlyMap<string, string>;
}

/** The series behind a process instance, when the instance came from one. */
interface InstanceSeries {
  readonly id: string;
  readonly name: string;
  readonly createdBy: string | null;
}

/** Load the series a process instance was materialized for. */
async function seriesOf(
  tx: ProcessTransaction,
  instanceId: string,
): Promise<InstanceSeries | undefined> {
  const [row] = await tx
    .select({
      id: recurrenceSeries.id,
      name: recurrenceSeries.name,
      createdBy: recurrenceSeries.createdBy,
    })
    .from(processInstance)
    .innerJoin(processOccurrence, eq(processOccurrence.id, processInstance.occurrenceId))
    .innerJoin(recurrenceSeries, eq(recurrenceSeries.id, processOccurrence.seriesId))
    .where(eq(processInstance.id, instanceId))
    .limit(1);
  return row;
}

/** Load the created projects and tasks as full rows, projects first. */
async function createdRows(
  tx: ProcessTransaction,
  created: CreatedStepEntities,
): Promise<CreatedEntity[]> {
  const projectIds = [...created.projects.values()];
  const taskIds = [...created.tasks.values()];
  const projects =
    projectIds.length === 0
      ? []
      : await tx.select().from(project).where(inArray(project.id, projectIds));
  const tasks =
    taskIds.length === 0 ? [] : await tx.select().from(task).where(inArray(task.id, taskIds));
  return [
    ...projects.map((row): CreatedEntity => ({ kind: 'project', row })),
    ...tasks.map((row): CreatedEntity => ({ kind: 'task', row })),
  ];
}

/**
 * Record the projects and tasks a pass created, and return the pass's delta.
 *
 * @param tx - The pass's transaction, holding the instance lock.
 * @param command - The pass being run.
 * @param created - What the pass created, keyed by step key.
 * @returns the delta the pass reports.
 */
export async function recordMaterializedWork(
  tx: ProcessTransaction,
  command: MaterializeInstanceStepsCommand,
  created: CreatedStepEntities,
): Promise<MaterializedStepDelta> {
  const delta: MaterializedStepDelta = {
    createdProjectIdsByKey: Object.fromEntries(created.projects),
    createdMilestoneIdsByKey: Object.fromEntries(created.milestones),
    createdTaskIdsByKey: Object.fromEntries(created.tasks),
  };
  if (created.projects.size + created.tasks.size === 0) return delta;
  const series = await seriesOf(tx, command.instanceId);
  const entities = await createdRows(tx, created);
  await recordCreated({
    orgId: command.organizationId,
    actorId: command.actorId ?? series?.createdBy,
    tool: 'recurrence_materialize',
    summary: `Created ${countOf(entities.length, 'item')} from "${series?.name ?? 'a process'}"`,
    created: entities,
    base: ruleProvenance('recurrence', series ? { seriesId: series.id } : undefined),
    executor: tx,
  });
  return delta;
}
