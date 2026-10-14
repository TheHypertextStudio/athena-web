/**
 * `@docket/api` — resolving the two ends of a `link` relation.
 *
 * @remarks
 * Tasks are named by id; containers by id or name (see `descriptors.ts`). An id that names work of
 * the wrong kind is refused with the kinds that would fit rather than reported as missing, because
 * "that item could not be found" sends the caller looking for an item that plainly exists.
 */
import { db, task } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

import { NotFoundError } from '../error';
import { isUlid, resolveAcross, resolveDescriptor } from './descriptors';
import { rejectKind, rejectTaskName } from './link-types';

/** The container kinds an id might name instead of a task. */
const CONTAINER_KINDS = ['project', 'program', 'initiative'] as const;

/** The active task with this id in the organization, if there is one. */
async function activeTaskId(orgId: string, id: string): Promise<string | undefined> {
  const rows = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
    .limit(1);
  return rows[0]?.id;
}

/** The container an id names, or undefined when it names none in this organization. */
async function containerFor(
  orgId: string,
  id: string,
  field: string,
): Promise<{ id: string; kind: (typeof CONTAINER_KINDS)[number] } | undefined> {
  try {
    return await resolveAcross(orgId, CONTAINER_KINDS, id, field);
  } catch (error) {
    if (error instanceof NotFoundError) return undefined;
    throw error;
  }
}

/**
 * Resolve an endpoint that must be a task.
 *
 * @param orgId - The organization the task must belong to.
 * @param value - The caller's task id.
 * @param field - The tool parameter it came from.
 * @returns the task id.
 * @throws {ValidationError} When the value is not an id, or names a container instead.
 * @throws {NotFoundError} When no active task or container has that id.
 */
export async function resolveTaskEndpoint(
  orgId: string,
  value: string,
  field: string,
): Promise<string> {
  if (!isUlid(value)) rejectTaskName(field, value);
  const id = await activeTaskId(orgId, value);
  if (id !== undefined) return id;
  if (await containerFor(orgId, value, field)) rejectKind(field, value, ['task']);
  throw new NotFoundError('No task with that id in this organization');
}

/** One end of a `blocks` edge: a task or a project. */
export interface BlocksEndpoint {
  readonly kind: 'task' | 'project';
  readonly id: string;
}

/**
 * Resolve one end of a `blocks` edge, which may be a task (by id) or a project (by id or name).
 *
 * @param orgId - The organization the endpoint must belong to.
 * @param value - The caller's id or project name.
 * @param field - The tool parameter it came from.
 * @returns the endpoint and its kind.
 * @throws {ValidationError} When the id names a program or initiative, or a name matches no project.
 * @throws {NotFoundError} When no active task or container has that id.
 */
export async function resolveBlocksEndpoint(
  orgId: string,
  value: string,
  field: string,
): Promise<BlocksEndpoint> {
  if (!isUlid(value)) {
    return { kind: 'project', id: await resolveDescriptor(orgId, 'project', value, field) };
  }
  const taskId = await activeTaskId(orgId, value);
  if (taskId !== undefined) return { kind: 'task', id: taskId };
  const container = await containerFor(orgId, value, field);
  if (!container) throw new NotFoundError('No task or project with that id in this organization');
  if (container.kind !== 'project') rejectKind(field, value, ['task', 'project']);
  return { kind: 'project', id: container.id };
}
