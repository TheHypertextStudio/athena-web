import type { db } from '@docket/db';
import { detachSourcePeople } from '../lib/identity/source-people';
import { assertTaskCapability, type TaskRow } from './task-helpers';

/** Authorize an explicit assignment and stop automatic source identity propagation. */
export async function assertTaskAssignmentEdit(
  orgId: string,
  actorId: string,
  row: TaskRow,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<void> {
  await assertTaskCapability(orgId, actorId, row, 'assign', tx);
  await detachSourcePeople(orgId, 'task', row.id, 'assignee', tx);
}

/** Stop source assignment propagation only when the assignee was explicitly edited. */
export async function detachTaskAssigneeEdit(
  orgId: string,
  id: string,
  value: unknown,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<void> {
  if (value !== undefined) await detachSourcePeople(orgId, 'task', id, 'assignee', tx);
}
