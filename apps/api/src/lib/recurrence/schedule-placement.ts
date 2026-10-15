import { project, task } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import type { OrdinaryWorkCommand, PreparedOrdinaryWork } from '../work-creation/types';

async function projectProgram(
  tx: TemplateTransaction,
  organizationId: string,
  projectId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ programId: project.programId })
    .from(project)
    .where(
      and(
        eq(project.id, projectId),
        eq(project.organizationId, organizationId),
        isNull(project.archivedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Schedule destination not found');
  return row.programId;
}
/** Check actual live Task ancestry against an owning Program before ordinary creation preflight. */
export async function validateSchedulePlacement(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
): Promise<void> {
  const owner = command.invocation.placement?.programId;
  if (!command.invocation.scheduleContext || !owner || command.kind !== 'task') return;
  if (
    command.body.projectId &&
    (await projectProgram(tx, command.caller.orgId, command.body.projectId)) !== owner
  )
    throw new ConflictError('The schedule destination must match its owning Program.');
  await validateParentPlacement(tx, command, owner);
}
async function validateParentPlacement(
  tx: TemplateTransaction,
  command: Extract<OrdinaryWorkCommand, { kind: 'task' }>,
  owner: string,
): Promise<void> {
  if (!command.body.parentTaskId) return;
  const [parent] = await tx
    .select({ programId: task.programId, projectId: task.projectId })
    .from(task)
    .where(
      and(
        eq(task.id, command.body.parentTaskId),
        eq(task.organizationId, command.caller.orgId),
        isNull(task.archivedAt),
      ),
    )
    .limit(1);
  if (!parent) throw new NotFoundError('Schedule destination not found');
  const actual =
    parent.programId ??
    (parent.projectId ? await projectProgram(tx, command.caller.orgId, parent.projectId) : null);
  if (actual !== owner || (command.body.projectId && command.body.projectId !== parent.projectId))
    throw new ConflictError('The schedule destination must match its owning Program.');
}
/** Apply explicit private root null clears that the ordinary public creation DTO represents by omission. */
export function applyScheduleRootClears(
  command: OrdinaryWorkCommand,
  root: PreparedOrdinaryWork,
): void {
  const draft = command.invocation.scheduleContext?.draft;
  if (!draft || root.insert.kind === 'milestone') return;
  if (draft.root.fields.summary === null) root.insert.values.summary = null;
}
