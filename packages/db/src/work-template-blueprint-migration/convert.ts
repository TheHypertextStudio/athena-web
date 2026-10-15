import { sql } from 'drizzle-orm';
import type {
  BlueprintInvocationManifest,
  BlueprintInvocationOverride,
} from '../blueprint-invocation';
import { genId } from '../id';
import { required, type RetainedGraph } from './contracts';
import { convertLegacyRoots } from './definitions';
import { normalizeLegacyBlueprint } from './normalize';
import { migrationRows, type BlueprintMigrationConnection } from './query';
import { backfillBlueprintRecurrence } from './recurrence';
import { validateRetainedBlueprint } from './validate';
import { backfillGeneratedBlueprintWork } from './work';

/** One committed source revision's conversion result. */
export interface ConvertedRevisionResult {
  readonly publishedRoots: number;
  readonly preservedDrafts: number;
}

/** Convert one locked retained source and atomically persist its unique complete receipt. */
export async function convertRetainedRevision(
  connection: BlueprintMigrationConnection,
  revisionId: string,
): Promise<ConvertedRevisionResult> {
  const [source] = await migrationRows<{ graph: RetainedGraph; fingerprint: string }>(
    connection,
    sql`select docket_blueprint_retained_source(${revisionId}) as graph,docket_blueprint_source_fingerprint(${revisionId}) as fingerprint`,
  );
  if (!source) throw new Error('Retained blueprint source is missing.');
  const graph = source.graph;
  const steps = normalizeLegacyBlueprint(graph);
  await validateRetainedBlueprint(connection, graph, steps);
  const organizationId = required(graph.revision, 'organization_id');
  const published =
    typeof graph.revision['published_at'] === 'string' &&
    ['published', 'archived'].includes(required(graph.definition, 'status'));
  if (published && steps.length === 0)
    throw new Error('Published retained blueprint has no work roots.');
  const converted = await convertLegacyRoots(connection, graph, steps, published);
  const manifest: BlueprintInvocationManifest = {
    kind: published ? 'published' : 'pending_draft',
    legacyProcessRevisionId: revisionId,
    roots: converted.roots,
    steps: steps.map((step) => {
      const root = steps.find((candidate) => candidate.id === step.rootId);
      if (!root) throw new Error('Retained root is missing.');
      const projection = converted.projections.get(root.id);
      return {
        sourceStepId: step.id,
        sourceKey: required(step.row, 'key'),
        rootKey: root.key,
        path: step.path,
        blueprintStepId: step.path.length ? (projection?.ids[step.key] ?? null) : null,
        sourceVersionId: step.path.length ? (projection?.versionId ?? null) : null,
      };
    }),
    dependencies: graph.dependencies.map((edge) => ({
      blockerStepId: required(edge, 'blocking_step_id'),
      blockedStepId: required(edge, 'blocked_step_id'),
    })),
  };
  const overrides: BlueprintInvocationOverride[] = steps.map((step) => {
    const labels = (step.kind === 'project' ? graph.projectLabels : graph.taskLabels)
      .filter((label) => (label['project_step_id'] ?? label['task_step_id']) === step.id)
      .map((label) => required(label, 'label_id'));
    return {
      sourceStepId: step.id,
      kind: step.kind,
      fields: { ...step.spec, ...(labels.length ? { labelIds: labels } : {}) },
      timing: {
        kind: required(step.row, 'timing_kind') as BlueprintInvocationOverride['timing']['kind'],
        offsetDays: typeof step.row['offset_days'] === 'number' ? step.row['offset_days'] : null,
        afterStepId:
          typeof step.row['after_step_id'] === 'string' ? step.row['after_step_id'] : null,
      },
    };
  });
  const invocationId = genId();
  await connection.execute(
    sql`insert into work_template_blueprint_invocation(id,organization_id,owner_actor_id,manifest,overrides) values(${invocationId},${organizationId},${graph.definition['created_by']},${JSON.stringify(manifest)}::jsonb,${JSON.stringify(overrides)}::jsonb)`,
  );
  await backfillGeneratedBlueprintWork(connection, organizationId, manifest, converted.projections);
  await backfillBlueprintRecurrence(connection, organizationId, invocationId, manifest);
  await connection.execute(
    sql`insert into work_template_blueprint_conversion(organization_id,legacy_process_revision_id,invocation_id,source_fingerprint) values(${organizationId},${revisionId},${invocationId},${source.fingerprint})`,
  );
  return {
    publishedRoots: published ? manifest.roots.length : 0,
    preservedDrafts: published ? 0 : 1,
  };
}
