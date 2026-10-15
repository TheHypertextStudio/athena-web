import { sql } from 'drizzle-orm';
import { genId } from '../id';
import type { BlueprintInvocationRoot } from '../blueprint-invocation';
import {
  required,
  type ConvertedDefinition,
  type ConvertedStep,
  type FrozenDateRule,
  type RetainedGraph,
} from './contracts';
import type { NormalizedLegacyStep } from './normalize';
import { migrationRows, type BlueprintMigrationConnection } from './query';

function dateRule(
  step: NormalizedLegacyStep,
  value: number,
  parentOffset: unknown,
  prerequisite: NormalizedLegacyStep | undefined,
): FrozenDateRule | undefined {
  if (step.row['timing_kind'] === 'after_step_completion') {
    const days = value + Number(step.row['offset_days'] ?? 0);
    if (
      prerequisite?.kind === 'task' &&
      prerequisite.parentId === step.parentId &&
      days >= 0 &&
      days <= 36500
    )
      return {
        kind: 'after_completion',
        stepKeys: [prerequisite.key],
        offset: { days, unit: 'calendar' },
      };
    return undefined;
  }
  if (typeof parentOffset === 'number' && Math.abs(value - parentOffset) <= 36500)
    return {
      kind: 'anchor',
      anchor: { kind: 'parent' },
      offset: { days: value - parentOffset, unit: 'calendar' },
    };
  return undefined;
}

function dates(
  step: NormalizedLegacyStep,
  steps: readonly NormalizedLegacyStep[],
): Record<string, FrozenDateRule> {
  const result: Record<string, FrozenDateRule> = {};
  const fields =
    step.kind === 'task'
      ? { startDate: 'start_offset_days', dueDate: 'due_offset_days' }
      : { targetDate: 'target_offset_days' };
  const parent = steps.find((candidate) => candidate.id === step.parentId);
  const parentOffset =
    parent?.spec[parent.kind === 'task' ? 'due_offset_days' : 'target_offset_days'];
  const prerequisite = steps.find((candidate) => candidate.id === step.row['after_step_id']);
  for (const [field, key] of Object.entries(fields)) {
    const value = step.spec[key];
    if (typeof value !== 'number') continue;
    const rule = dateRule(step, value, parentOffset, prerequisite);
    if (rule) result[field] = rule;
  }
  return result;
}

function startingFields(
  step: NormalizedLegacyStep,
  graph: RetainedGraph,
): Record<string, string | number | readonly string[]> {
  const fields: Record<string, string | number | readonly string[]> = {};
  const nameKey = step.kind === 'task' ? 'title' : 'name';
  fields[nameKey] = required(step.spec, nameKey);
  for (const key of ['priority', 'status', 'health', 'estimate'])
    if (typeof step.spec[key] === 'string' || typeof step.spec[key] === 'number')
      fields[key] = step.spec[key];
  if (typeof step.spec['state'] === 'string') fields['state'] = step.spec['state'];
  if (typeof step.spec['estimate_minutes'] === 'number')
    fields['estimateMinutes'] = step.spec['estimate_minutes'];
  const labels = graph.taskLabels
    .filter((label) => label['task_step_id'] === step.id)
    .map((label) => required(label, 'label_id'));
  if (labels.length > 0) fields['labelIds'] = labels;
  return fields;
}

function convertedStep(
  step: NormalizedLegacyStep,
  steps: readonly NormalizedLegacyStep[],
  graph: RetainedGraph,
): ConvertedStep {
  const parent = steps.find((candidate) => candidate.id === step.parentId);
  const definition = step.spec['work_type_id'];
  const version = step.spec['work_type_version_id'];
  return {
    key: step.key,
    kind: step.kind,
    parentStepKey: parent?.path.length ? parent.key : null,
    sort: Number(step.row['sort']),
    optional: { enabled: false, selectedByDefault: true },
    template:
      step.kind === 'task' && typeof definition === 'string' && typeof version === 'string'
        ? { workTypeId: definition, selection: { kind: 'pinned', workTypeVersionId: version } }
        : null,
    teamRule: 'creation_team',
    actorRule: 'unassigned',
    ...(step.kind === 'task' ? { cycleRule: 'none' as const } : {}),
    fields: startingFields(step, graph),
    dates: dates(step, steps),
  };
}

async function rootPublication(
  connection: BlueprintMigrationConnection,
  graph: RetainedGraph,
  root: NormalizedLegacyStep,
  steps: readonly NormalizedLegacyStep[],
): Promise<{
  root: BlueprintInvocationRoot;
  ids: Readonly<Record<string, string>>;
  definition: ConvertedDefinition;
}> {
  const organizationId = required(graph.revision, 'organization_id');
  const workTypeId = genId();
  const versionId = genId();
  const children = steps.filter((step) => step.rootId === root.id && step.id !== root.id);
  const byId = new Map(children.map((step) => [step.id, step]));
  const edges = graph.dependencies.flatMap((edge) => {
    const blocker = byId.get(required(edge, 'blocking_step_id'));
    const blocked = byId.get(required(edge, 'blocked_step_id'));
    return blocker?.parentId === blocked?.parentId && blocker && blocked
      ? [{ blockerStepKey: blocker.key, blockedStepKey: blocked.key }]
      : [];
  });
  const definition: ConvertedDefinition = {
    name: `${required(graph.definition, 'name')} (${root.key}, revision ${graph.revision['number']})`,
    description: null,
    icon: null,
    defaultStatusKey: null,
    payload:
      root.kind === 'project'
        ? { targetType: 'project', name: required(root.spec, 'name') }
        : { targetType: 'task', title: required(root.spec, 'title') },
    blueprint: {
      steps: children.map((step) => convertedStep(step, steps, graph)),
      dependencies: edges,
    },
  };
  const owner = graph.definition['created_by'];
  await connection.execute(
    sql`insert into template(id,organization_id,target_type,name,scope,owner_actor_id,payload,is_base,publication_state,draft_definition,created_by) values(${workTypeId},${organizationId},${root.kind},${definition.name},'organization',${owner},${JSON.stringify(definition.payload)}::jsonb,false,'draft',${JSON.stringify(definition)}::jsonb,${owner})`,
  );
  await connection.execute(
    sql`insert into work_type_version(id,organization_id,work_type_id,number,definition,published_by_actor_id) values(${versionId},${organizationId},${workTypeId},1,${JSON.stringify(definition)}::jsonb,${owner})`,
  );
  await connection.execute(
    sql`update template set latest_published_version_id=${versionId},publication_state='published' where id=${workTypeId}`,
  );
  const ids = await insertFrozenProjection(connection, organizationId, versionId, definition);
  if (graph.definition['status'] === 'archived' || graph.definition['archived_at'] !== null)
    await connection.execute(
      sql`update template set publication_state='archived',archived_at=coalesce(${graph.definition['archived_at']}::timestamp,now()) where id=${workTypeId}`,
    );
  return {
    root: {
      sourceStepId: root.id,
      sourceKey: required(root.row, 'key'),
      key: root.key,
      kind: root.kind === 'project' ? 'project' : 'task',
      workTypeId,
      workTypeVersionId: versionId,
    },
    ids,
    definition,
  };
}

/** Insert only frozen0154 projection columns; never call an evolving runtime publication helper. */
export async function insertFrozenProjection(
  connection: BlueprintMigrationConnection,
  organizationId: string,
  versionId: string,
  definition: ConvertedDefinition,
): Promise<Readonly<Record<string, string>>> {
  const ids: Record<string, string> = {};
  for (const step of definition.blueprint.steps) {
    const id = genId();
    ids[step.key] = id;
    await connection.execute(
      sql`insert into blueprint_step(id,organization_id,version_id,key,kind,parent_step_key,sort,step) values(${id},${organizationId},${versionId},${step.key},${step.kind},${step.parentStepKey},${step.sort},${JSON.stringify(step)}::jsonb)`,
    );
  }
  for (const edge of definition.blueprint.dependencies)
    await connection.execute(
      sql`insert into blueprint_dependency(organization_id,version_id,blocker_step_id,blocked_step_id) values(${organizationId},${versionId},${ids[edge.blockerStepKey]},${ids[edge.blockedStepKey]})`,
    );
  return ids;
}

/** Convert each original root without creating any visible work or fabricating a forest wrapper. */
export async function convertLegacyRoots(
  connection: BlueprintMigrationConnection,
  graph: RetainedGraph,
  steps: readonly NormalizedLegacyStep[],
  published: boolean,
): Promise<{
  roots: BlueprintInvocationRoot[];
  projections: ReadonlyMap<
    string,
    { ids: Readonly<Record<string, string>>; versionId: string; definition: ConvertedDefinition }
  >;
}> {
  const roots: BlueprintInvocationRoot[] = [];
  const projections = new Map<
    string,
    { ids: Readonly<Record<string, string>>; versionId: string; definition: ConvertedDefinition }
  >();
  for (const root of steps.filter((step) => step.parentId === null)) {
    if (root.kind === 'milestone') throw new Error('Retained Milestone cannot be a root.');
    if (
      published &&
      (root.kind === 'project' ||
        steps.some((step) => step.rootId === root.id && step.id !== root.id))
    ) {
      const converted = await rootPublication(connection, graph, root, steps);
      roots.push(converted.root);
      const versionId = converted.root.workTypeVersionId;
      if (!versionId) throw new Error('Retained canonical root publication is missing.');
      projections.set(root.id, { ids: converted.ids, versionId, definition: converted.definition });
      continue;
    }
    const selection = published ? await taskRootSelection(connection, graph, root) : null;
    roots.push({
      sourceStepId: root.id,
      sourceKey: required(root.row, 'key'),
      key: root.key,
      kind: root.kind,
      workTypeId: selection?.id ?? null,
      workTypeVersionId: selection?.versionId ?? null,
    });
  }
  return { roots, projections };
}

async function taskRootSelection(
  connection: BlueprintMigrationConnection,
  graph: RetainedGraph,
  root: NormalizedLegacyStep,
): Promise<{ id: string; versionId: string }> {
  if (
    typeof root.spec['work_type_id'] === 'string' &&
    typeof root.spec['work_type_version_id'] === 'string'
  )
    return { id: root.spec['work_type_id'], versionId: root.spec['work_type_version_id'] };
  const [base] = await migrationRows<{ id: string; versionId: string }>(
    connection,
    sql`select id,latest_published_version_id as "versionId" from template where organization_id=${required(graph.revision, 'organization_id')} and target_type='task' and is_base and latest_published_version_id is not null`,
  );
  if (!base) throw new Error('Retained Task has no canonical base publication.');
  return base;
}
