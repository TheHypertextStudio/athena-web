import { project, task } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import type {
  OrdinaryWorkCommand,
  PreparedOrdinaryWork,
  OrdinaryPreparationContext,
} from '../work-creation/types';
import { prospectiveWorkReference } from '../work-creation/ordinary-prospective';

async function projectProgram(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  projectId: string,
  context: OrdinaryPreparationContext | undefined,
): Promise<string | null> {
  const prospective = prospectiveWorkReference(tx, command, context, 'project', projectId);
  if (prospective?.kind === 'project') return prospective.programId ?? null;
  const [row] = await tx
    .select({ programId: project.programId })
    .from(project)
    .where(
      and(
        eq(project.id, projectId),
        eq(project.organizationId, command.caller.orgId),
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
  context?: OrdinaryPreparationContext,
): Promise<void> {
  const owner = command.invocation.placement?.programId;
  if (!command.invocation.scheduleContext || !owner || command.kind !== 'task') return;
  if (
    command.body.projectId &&
    (await projectProgram(tx, command, command.body.projectId, context)) !== owner
  )
    throw new ConflictError('The schedule destination must match its owning Program.');
  await validateParentPlacement(tx, command, owner, context);
}
async function validateParentPlacement(
  tx: TemplateTransaction,
  command: Extract<OrdinaryWorkCommand, { kind: 'task' }>,
  owner: string,
  context: OrdinaryPreparationContext | undefined,
): Promise<void> {
  if (!command.body.parentTaskId) return;
  const prospective = prospectiveWorkReference(
    tx,
    command,
    context,
    'task',
    command.body.parentTaskId,
  );
  const [stored] = prospective
    ? []
    : await tx
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
  const parent = prospective?.kind === 'task' ? prospective : stored;
  if (!parent) throw new NotFoundError('Schedule destination not found');
  const actual =
    parent.programId ??
    (parent.projectId ? await projectProgram(tx, command, parent.projectId, context) : null);
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
