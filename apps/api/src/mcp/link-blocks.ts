/**
 * `@docket/api` — the `blocks` relation: a dependency between two tasks or two projects.
 *
 * @remarks
 * Tasks and projects keep separate dependency graphs (`task_dependency`, `project_dependency`), so
 * an edge joins two of the same kind. Which graph a call writes is read off its endpoints rather
 * than asked for, because "the migration project blocks the launch" never names a table. The
 * duplicate check, the cycle check, and the write share one SERIALIZABLE transaction, as the REST
 * routes do: two concurrent inserts of A→B and B→A must not both pass the guard.
 */
import { projectDependency, taskDependency } from '@docket/db';
import { and, eq } from 'drizzle-orm';

import { CycleError } from '../error';
import { serializableTx } from '../lib/serializable-tx';
import { wouldCreateProjectCycle } from '../routes/project-dependency-routes';
import { wouldCreateCycle as wouldCreateTaskCycle } from '../routes/task-helpers';
import type { RelationKind, Tx as SerializableTx } from './change-set';
import { resolveBlocksEndpoint } from './link-endpoints';
import {
  rejectKind,
  rejectSelf,
  unchanged,
  type RelationRequest,
  type RelationResult,
} from './link-types';

/** One directed edge to assert or take back. */
interface EdgeWrite {
  readonly orgId: string;
  readonly from: string;
  readonly to: string;
  readonly remove: boolean;
}

/** Write or delete a task edge; returns whether anything changed. */
async function writeTaskEdge(tx: SerializableTx, edge: EdgeWrite): Promise<boolean> {
  const where = and(
    eq(taskDependency.organizationId, edge.orgId),
    eq(taskDependency.blockingTaskId, edge.from),
    eq(taskDependency.blockedTaskId, edge.to),
  );
  const existing = await tx
    .select({ id: taskDependency.blockedTaskId })
    .from(taskDependency)
    .where(where)
    .limit(1);
  if (edge.remove) {
    if (!existing[0]) return false;
    await tx.delete(taskDependency).where(where);
    return true;
  }
  if (existing[0]) return false;
  if (await wouldCreateTaskCycle(tx, edge.orgId, edge.from, edge.to)) throw new CycleError();
  await tx
    .insert(taskDependency)
    .values({ organizationId: edge.orgId, blockingTaskId: edge.from, blockedTaskId: edge.to });
  return true;
}

/** Write or delete a project edge; returns whether anything changed. */
async function writeProjectEdge(tx: SerializableTx, edge: EdgeWrite): Promise<boolean> {
  const where = and(
    eq(projectDependency.organizationId, edge.orgId),
    eq(projectDependency.blockingProjectId, edge.from),
    eq(projectDependency.blockedProjectId, edge.to),
  );
  const existing = await tx
    .select({ id: projectDependency.blockedProjectId })
    .from(projectDependency)
    .where(where)
    .limit(1);
  if (edge.remove) {
    if (!existing[0]) return false;
    await tx.delete(projectDependency).where(where);
    return true;
  }
  if (existing[0]) return false;
  if (await wouldCreateProjectCycle(tx, edge.orgId, edge.from, edge.to)) throw new CycleError();
  await tx.insert(projectDependency).values({
    organizationId: edge.orgId,
    blockingProjectId: edge.from,
    blockedProjectId: edge.to,
  });
  return true;
}

/** The change-set relation each graph records under. */
const RECORDED_AS: Record<'task' | 'project', RelationKind> = {
  task: 'blocks',
  project: 'project_blocks',
};

/**
 * `blocks`: the first must finish before the second.
 *
 * @param request - The call; `from` blocks `to`.
 * @returns what was written.
 * @throws {ValidationError} When the ends are different kinds, the same item, or not tasks or projects.
 * @throws {CycleError} When the edge would close a cycle in its graph.
 */
export async function applyBlocks(request: RelationRequest): Promise<RelationResult> {
  const { orgId, remove } = request;
  const from = await resolveBlocksEndpoint(orgId, request.from, 'from');
  const to = await resolveBlocksEndpoint(orgId, request.to, 'to');
  if (from.kind !== to.kind) rejectKind('to', request.to, [from.kind]);
  if (from.id === to.id) rejectSelf('to', request.to);
  await request.guard(from.kind, from.id);
  await request.guard(to.kind, to.id);

  const edge = { orgId, from: from.id, to: to.id, remove };
  const changed = await serializableTx((tx) =>
    from.kind === 'task' ? writeTaskEdge(tx, edge) : writeProjectEdge(tx, edge),
  );
  const ends = { from: from.id, to: to.id, fromKind: from.kind, toKind: to.kind };
  if (!changed) return unchanged(ends);
  return {
    ...ends,
    changed: true,
    changes: [{ kind: RECORDED_AS[from.kind], from: from.id, to: to.id, linked: !remove }],
    reindex: [],
  };
}
