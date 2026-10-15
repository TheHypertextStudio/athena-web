import { sql } from 'drizzle-orm';
import { required, type RetainedGraph, type RetainedRow } from './contracts';
import type { NormalizedLegacyStep } from './normalize';
import { migrationRows, type BlueprintMigrationConnection } from './query';

const REFERENCE_TABLES: Readonly<Record<string, string>> = {
  created_by: 'actor',
  lead_id: 'actor',
  assignee_id: 'actor',
  team_id: 'team',
  program_id: 'program',
  project_id: 'project',
  milestone_id: 'milestone',
  cycle_id: 'cycle',
  parent_task_id: 'task',
  label_id: 'label',
  work_type_id: 'template',
};

async function validateReferences(
  connection: BlueprintMigrationConnection,
  organizationId: string,
  rows: readonly RetainedRow[],
): Promise<void> {
  for (const [field, table] of Object.entries(REFERENCE_TABLES)) {
    const ids = [
      ...new Set(rows.flatMap((row) => (typeof row[field] === 'string' ? [row[field]] : []))),
    ];
    if (ids.length === 0) continue;
    const existing = await migrationRows<{ id: string; organization_id: string }>(
      connection,
      sql`select id,organization_id from ${sql.identifier(table)} where id in(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`,
    );
    if (
      existing.length !== ids.length ||
      existing.some((row) => row.organization_id !== organizationId)
    )
      throw new Error(`Retained blueprint has a missing or foreign ${table} reference.`);
  }
}

function validateOwnership(graph: RetainedGraph, organizationId: string): void {
  const rows = [
    graph.definition,
    graph.revision,
    ...graph.steps,
    ...graph.projects,
    ...graph.milestones,
    ...graph.tasks,
    ...graph.taskLabels,
    ...graph.projectLabels,
    ...graph.dependencies,
  ];
  if (rows.some((row) => row['organization_id'] !== organizationId))
    throw new Error('Retained blueprint rows cross workspace boundaries.');
  if (graph.revision['definition_id'] !== graph.definition['id'])
    throw new Error('Retained blueprint definition does not own its revision.');
  if (graph.steps.some((row) => row['revision_id'] !== graph.revision['id']))
    throw new Error('Retained blueprint step has a foreign revision.');
}

function validateOffsets(spec: RetainedRow): void {
  for (const key of Object.keys(spec).filter((key) => key.endsWith('_offset_days'))) {
    const value = spec[key];
    if (
      value !== null &&
      (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > 36500)
    )
      throw new Error('Retained date offset exceeds the supported range.');
  }
}

function validateMilestone(
  step: NormalizedLegacyStep,
  byId: ReadonlyMap<string, NormalizedLegacyStep>,
): void {
  const milestoneId = step.spec['milestone_step_id'];
  if (typeof milestoneId !== 'string') return;
  const milestone = byId.get(milestoneId);
  const projectId = step.spec['project_step_id'];
  if (
    milestone?.kind !== 'milestone' ||
    (projectId && milestone.spec['project_step_id'] !== projectId)
  )
    throw new Error('Retained Milestone does not belong to its Project.');
}

function validateStepReferences(steps: readonly NormalizedLegacyStep[]): void {
  const byId = new Map(steps.map((step) => [step.id, step]));
  for (const step of steps) {
    const projectId = step.spec['project_step_id'];
    if (typeof projectId === 'string' && byId.get(projectId)?.kind !== 'project')
      throw new Error('Retained Project reference is outside its graph.');
    const parent = step.spec['parent_task_step_id'];
    if (typeof parent === 'string' && byId.get(parent)?.kind !== 'task')
      throw new Error('Retained parent Task is outside its graph.');
    validateMilestone(step, byId);
    validateOffsets(step.spec);
  }
}

async function validateTaskSelections(
  connection: BlueprintMigrationConnection,
  graph: RetainedGraph,
  organizationId: string,
): Promise<void> {
  for (const task of graph.tasks) {
    const definition = task['work_type_id'];
    const version = task['work_type_version_id'];
    if ((definition === null) !== (version === null))
      throw new Error('Retained Task template selection is incomplete.');
    if (typeof definition !== 'string' || typeof version !== 'string') continue;
    const rows = await migrationRows<{ id: string }>(
      connection,
      sql`select v.id from work_type_version v join template t on t.id=v.work_type_id and t.organization_id=v.organization_id where v.id=${version} and v.work_type_id=${definition} and v.organization_id=${organizationId} and t.target_type='task' and t.scope='organization' and t.publication_state in('published','archived')`,
    );
    if (rows.length !== 1)
      throw new Error('Retained Task has a foreign or wrong-kind template version.');
  }
}

async function validateLiteralPlacement(
  connection: BlueprintMigrationConnection,
  graph: RetainedGraph,
): Promise<void> {
  for (const task of graph.tasks) {
    if (typeof task['cycle_id'] === 'string') {
      const [cycle] = await migrationRows<{ team_id: string }>(
        connection,
        sql`select team_id from cycle where id=${task['cycle_id']}`,
      );
      if (cycle?.team_id !== task['team_id'])
        throw new Error('Retained cycle belongs to another team.');
    }
    if (typeof task['milestone_id'] === 'string' && typeof task['project_id'] === 'string') {
      const [milestone] = await migrationRows<{ project_id: string }>(
        connection,
        sql`select project_id from milestone where id=${task['milestone_id']}`,
      );
      if (milestone?.project_id !== task['project_id'])
        throw new Error('Retained literal Milestone belongs to another Project.');
    }
  }
}

/** Fail closed on legacy loose foreign keys before copying any body or allocating publications. */
export async function validateRetainedBlueprint(
  connection: BlueprintMigrationConnection,
  graph: RetainedGraph,
  steps: readonly NormalizedLegacyStep[],
): Promise<void> {
  const organizationId = required(graph.revision, 'organization_id');
  validateOwnership(graph, organizationId);
  validateStepReferences(steps);
  await validateReferences(connection, organizationId, [
    graph.definition,
    ...graph.projects,
    ...graph.tasks,
    ...graph.taskLabels,
    ...graph.projectLabels,
  ]);
  await validateTaskSelections(connection, graph, organizationId);
  await validateLiteralPlacement(connection, graph);
  const taskIds = new Set(steps.filter((step) => step.kind === 'task').map((step) => step.id));
  if (
    graph.dependencies.some(
      (edge) =>
        !taskIds.has(required(edge, 'blocking_step_id')) ||
        !taskIds.has(required(edge, 'blocked_step_id')),
    )
  )
    throw new Error('Retained dependency needs two Task endpoints.');
}
