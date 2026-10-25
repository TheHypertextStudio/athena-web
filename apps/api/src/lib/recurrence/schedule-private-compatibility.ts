import {
  blueprintInvocation,
  invocationRevision,
  type BlueprintOccurrenceRoot,
  type Database,
  type InvocationRevisionProjection,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { ConflictError } from '../../error';
import type { MaterializedOccurrence } from './materialize';

/** Read exact immutable authored aliases without querying normalized definitions or physical instance maps. */
export async function privateScheduleCompatibilityProjection(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly invocationId: string | null;
    readonly revisionId: string | null;
  },
): Promise<InvocationRevisionProjection | null> {
  if (!input.invocationId) return null;
  const [invocation] = await database
    .select({ manifest: blueprintInvocation.manifest })
    .from(blueprintInvocation)
    .where(
      and(
        eq(blueprintInvocation.id, input.invocationId),
        eq(blueprintInvocation.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!invocation) throw new ConflictError('The private schedule publication is unavailable.');
  if (invocation.manifest.kind !== 'private_definition') return null;
  const [alias] = await database
    .select({ projection: invocationRevision.projection })
    .from(invocationRevision)
    .where(
      and(
        eq(invocationRevision.id, input.revisionId ?? ''),
        eq(invocationRevision.invocationId, input.invocationId),
        eq(invocationRevision.organizationId, input.organizationId),
        eq(invocationRevision.origin, 'authored'),
      ),
    )
    .limit(1);
  if (!alias) throw new ConflictError('The private schedule aliases are unavailable.');
  return alias.projection;
}

/** Project the actual accepted qualified work through exact original source keys; no physical identity is invented. */
export function authoredScheduleCompatibilityIdentity(
  result: { readonly occurrenceId: string; readonly roots: readonly BlueprintOccurrenceRoot[] },
  projection: InvocationRevisionProjection,
): MaterializedOccurrence {
  const projects: Record<string, string> = {},
    milestones: Record<string, string> = {},
    tasks: Record<string, string> = {};
  for (const step of projection.steps) {
    const root = result.roots.find((entry) => entry.key === step.rootKey);
    const work =
      root?.selectedWork?.find(
        (entry) =>
          entry.kind === step.kind && JSON.stringify(entry.path) === JSON.stringify(step.path),
      ) ?? (root && step.path.length === 0 && root.kind === step.kind ? root : undefined);
    if (!work) throw new ConflictError('The private schedule work identities are unavailable.');
    if (step.kind === 'project') projects[step.key] = work.id;
    else if (step.kind === 'milestone') milestones[step.key] = work.id;
    else tasks[step.key] = work.id;
  }
  return {
    occurrenceId: result.occurrenceId,
    instanceId: result.occurrenceId,
    projectIdsByKey: projects,
    milestoneIdsByKey: milestones,
    taskIdsByKey: tasks,
  };
}
