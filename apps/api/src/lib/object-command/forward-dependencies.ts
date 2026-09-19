/** Forward handlers for the operations that create or drop a blocking edge. */
import { project, projectDependency, task, taskDependency } from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { ObjectCommandIn } from '../../contracts/object-command';
import { ConflictError, NotFoundError } from '../../error';
import { projectCycleWouldClose, taskCycleWouldClose } from './graph-cycles';
import { ownedValidation } from './receipt-validator';
import type { ForwardContext, Tx } from './types';

type DependencyOperation = Extract<
  ObjectCommandIn['operation'],
  { type: 'add_dependency' | 'remove_dependency' }
>;

/** Both endpoints must be distinct and must be exactly the objects the command selected. */
function assertEndpointsMatchSelection(
  objectIds: readonly string[],
  op: DependencyOperation,
): void {
  if (op.blockingId === op.blockedId) {
    throw ownedValidation('An object cannot depend on itself');
  }
  const endpointIds = [op.blockingId, op.blockedId];
  const selectedIds = new Set<string>(objectIds);
  if (
    selectedIds.size !== new Set(endpointIds).size ||
    endpointIds.some((id) => !selectedIds.has(id))
  ) {
    throw ownedValidation('Dependency endpoints must match the selected objects');
  }
}

async function assertEndpointsLive(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  op: DependencyOperation,
): Promise<void> {
  const endpointIds = [op.blockingId, op.blockedId];
  const rows =
    objectKind === 'task'
      ? await tx
          .select({ id: task.id })
          .from(task)
          .where(
            and(
              eq(task.organizationId, orgId),
              inArray(task.id, endpointIds),
              isNull(task.archivedAt),
            ),
          )
      : await tx
          .select({ id: project.id })
          .from(project)
          .where(
            and(
              eq(project.organizationId, orgId),
              inArray(project.id, endpointIds),
              isNull(project.archivedAt),
            ),
          );
  if (rows.length !== 2) {
    throw new NotFoundError(`${objectKind === 'task' ? 'Task' : 'Project'} not found`);
  }
}

async function dependencyEdgeExists(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  op: DependencyOperation,
): Promise<boolean> {
  const rows =
    objectKind === 'task'
      ? await tx
          .select({ id: taskDependency.blockingTaskId })
          .from(taskDependency)
          .where(
            and(
              eq(taskDependency.organizationId, orgId),
              eq(taskDependency.blockingTaskId, op.blockingId),
              eq(taskDependency.blockedTaskId, op.blockedId),
            ),
          )
          .limit(1)
      : await tx
          .select({ id: projectDependency.blockingProjectId })
          .from(projectDependency)
          .where(
            and(
              eq(projectDependency.organizationId, orgId),
              eq(projectDependency.blockingProjectId, op.blockingId),
              eq(projectDependency.blockedProjectId, op.blockedId),
            ),
          )
          .limit(1);
  return rows.length > 0;
}

async function dependencyWouldCycle(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  op: DependencyOperation,
): Promise<boolean> {
  return objectKind === 'task'
    ? taskCycleWouldClose(tx, orgId, op.blockingId, op.blockedId)
    : projectCycleWouldClose(tx, orgId, op.blockingId, op.blockedId);
}

async function writeDependencyEdge(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  op: DependencyOperation,
): Promise<void> {
  const shouldExist = op.type === 'add_dependency';
  if (objectKind === 'task') {
    if (shouldExist) {
      await tx.insert(taskDependency).values({
        organizationId: orgId,
        blockingTaskId: op.blockingId,
        blockedTaskId: op.blockedId,
      });
      return;
    }
    await tx
      .delete(taskDependency)
      .where(
        and(
          eq(taskDependency.blockingTaskId, op.blockingId),
          eq(taskDependency.blockedTaskId, op.blockedId),
        ),
      );
    return;
  }
  if (shouldExist) {
    await tx.insert(projectDependency).values({
      organizationId: orgId,
      blockingProjectId: op.blockingId,
      blockedProjectId: op.blockedId,
    });
    return;
  }
  await tx
    .delete(projectDependency)
    .where(
      and(
        eq(projectDependency.blockingProjectId, op.blockingId),
        eq(projectDependency.blockedProjectId, op.blockedId),
      ),
    );
}

/** Apply an add_dependency or remove_dependency command to the selected pair. */
export async function applyDependencyOperation(context: ForwardContext): Promise<void> {
  const { scope, command, entries, audit } = context;
  const { database: tx, orgId } = scope;
  const objectKind = command.objectKind;
  const op = command.operation as DependencyOperation;
  const shouldExist = op.type === 'add_dependency';
  assertEndpointsMatchSelection(command.objectIds, op);
  await assertEndpointsLive(tx, orgId, objectKind, op);
  const exists = await dependencyEdgeExists(tx, orgId, objectKind, op);
  if (shouldExist && exists) throw new ConflictError('Dependency edge already exists');
  if (!shouldExist && !exists) throw new NotFoundError('Dependency edge not found');
  if (shouldExist && (await dependencyWouldCycle(tx, orgId, objectKind, op))) {
    throw new ConflictError('Dependency would contain a cycle');
  }
  await writeDependencyEdge(tx, orgId, objectKind, op);
  entries.push({
    kind: 'relation',
    objectId: op.blockingId,
    relation: 'dependency',
    relatedId: op.blockedId,
    before: !shouldExist,
    after: shouldExist,
  });
  audit.push({
    kind: objectKind === 'task' ? 'blocks' : 'project_blocks',
    from: op.blockingId,
    to: op.blockedId,
    linked: shouldExist,
  });
}
