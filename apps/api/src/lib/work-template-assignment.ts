import { db, type task } from '@docket/db';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type {
  WorkTemplateAssignment,
  WorkTemplateIdentity,
  WorkTemplateChangeRequest,
  WorkTemplateChangePreview,
  WorkTemplateChangeField,
} from '@docket/work/work-template-reference';
import { and, eq } from 'drizzle-orm';
import type { ActorCtx } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import type { TemplateTransaction } from './templates/persistence';
import { workTemplateIdentityOut } from './work-template-creation';
import {
  lockTemplateWork,
  requireWorkAccess,
  selectedVersion,
  workTables,
} from './work-template-selection';
import { prepareTemplateChange, type PreparedTemplateChange } from './work-template-change-preview';
import { replaceLabels } from './labels';
import { resolveContainerStatus, resolveTaskStatus } from './work-status';
import {
  writeTaskStateTransition,
  finishTaskStateTransition,
  applySubtaskCompletionPolicy,
  closeCompletingUserTaskTimers,
  emitCompletedTaskTimerStops,
} from './task-state';

/** Load one work-authorized, publication-pinned preview of optional starting changes. */
export async function previewWorkTemplateAssignment(
  caller: ActorCtx,
  kind: TemplateTargetType,
  id: string,
  selection: WorkTemplateChangeRequest,
): Promise<WorkTemplateChangePreview> {
  return db.transaction(async (tx) => {
    const current = await lockTemplateWork(tx, caller.orgId, kind, id);
    await requireWorkAccess(tx, caller, kind, id);
    const publication = await selectedVersion(tx, caller.orgId, kind, selection, current.teamId);
    return (
      await prepareTemplateChange(tx, kind, current.row, {
        teamId: current.teamId,
        selection,
        publication,
      })
    ).preview;
  });
}

/**
 * Change the pinned identity and only explicitly reviewed starting values in one transaction.
 * @throws {NotFoundError} For unavailable work or a foreign, archived, draft, wrong-kind or mismatched template.
 * @throws {ConflictError} When work or resolved starting values changed since the reviewed preview.
 * @throws {ValidationError} For starting choices absent from the preview or an unavailable offering team.
 */
export async function assignWorkTemplate(
  caller: ActorCtx,
  kind: TemplateTargetType,
  id: string,
  selection: WorkTemplateAssignment,
): Promise<WorkTemplateIdentity> {
  const result = await db.transaction(async (tx) => {
    const current = await lockTemplateWork(tx, caller.orgId, kind, id);
    await requireWorkAccess(tx, caller, kind, id);
    const publication = await selectedVersion(tx, caller.orgId, kind, selection, current.teamId);
    const fields = selection.applyFields ?? [];
    const prepared =
      fields.length > 0 || selection.previewToken
        ? await prepareTemplateChange(tx, kind, current.row, {
            teamId: current.teamId,
            selection,
            publication,
          })
        : null;
    requireReviewedChanges(selection, fields, prepared);
    const patch = pickedStartingFields(fields, prepared);
    const table = workTables[kind];
    const [row] = await tx
      .update(table)
      .set({
        ...patch,
        workTypeId: selection.workTypeId,
        workTypeVersionId: publication.id,
        workTypeAssignedAt: new Date(),
        workTypeAssignmentSource: 'changed',
      })
      .where(and(eq(table.id, id), eq(table.organizationId, caller.orgId)))
      .returning();
    if (!row) throw new NotFoundError('Work not found');
    if (fields.includes('labels') && prepared)
      await replaceLabels(tx, kind, id, caller.orgId, prepared.labels);
    const effects =
      fields.includes('status') && prepared
        ? await applyStartingStatus(tx, caller, kind, current.row, prepared.values['status'])
        : null;
    return { identity: workTemplateIdentityOut(row), effects };
  });
  if (result.effects) await result.effects();
  return result.identity;
}

function requireReviewedChanges(
  selection: WorkTemplateAssignment,
  fields: readonly WorkTemplateChangeField[],
  prepared: PreparedTemplateChange | null,
): void {
  if (fields.length > 0 && !selection.previewToken)
    throw new ValidationError([
      { path: ['previewToken'], message: 'Review starting changes before applying them.' },
    ]);
  if (selection.previewToken && prepared?.preview.previewToken !== selection.previewToken)
    throw new ConflictError(
      'Work changed since this preview. Review the current starting changes.',
    );
  if (fields.some((field) => !prepared?.preview.changes.some((change) => change.field === field)))
    throw new ValidationError([
      { path: ['applyFields'], message: 'Choose only starting changes in this preview.' },
    ]);
}

function pickedStartingFields(
  fields: readonly WorkTemplateChangeField[],
  prepared: PreparedTemplateChange | null,
): Record<string, unknown> {
  return Object.fromEntries(
    fields
      .filter((field) => field !== 'labels' && field !== 'status')
      .map((field) => [field, prepared?.values[field]]),
  );
}

async function applyStartingStatus(
  tx: TemplateTransaction,
  caller: ActorCtx,
  kind: TemplateTargetType,
  before: Parameters<typeof prepareTemplateChange>[2],
  status: unknown,
): Promise<(() => Promise<void>) | null> {
  if (typeof status !== 'string') return null;
  if (kind !== 'task') {
    const transition = await resolveContainerStatus(caller.orgId, kind, status, 'status', tx);
    const table = workTables[kind];
    await tx
      .update(table)
      .set({ status: transition.status, statusId: transition.statusId })
      .where(and(eq(table.id, before.id), eq(table.organizationId, caller.orgId)));
    return null;
  }
  if (!('title' in before)) throw new NotFoundError('Task not found');
  return applyStartingTaskStatus(tx, caller, before, status);
}

async function applyStartingTaskStatus(
  tx: TemplateTransaction,
  caller: ActorCtx,
  before: typeof task.$inferSelect,
  status: string,
): Promise<(() => Promise<void>) | null> {
  const transition = await resolveTaskStatus(caller.orgId, before.teamId, status, 'status', tx);
  const mutation = await writeTaskStateTransition(tx, { before, ...transition });
  if (!mutation) throw new NotFoundError('Task not found');
  const timerStops = await closeCompletingUserTaskTimers(tx, caller.actorId, mutation);
  const cascades = await applySubtaskCompletionPolicy(tx, mutation);
  return async () => {
    await finishTaskStateTransition({ actorId: caller.actorId, enqueueSearch: false }, mutation);
    await emitCompletedTaskTimerStops(timerStops);
    for (const cascade of cascades) await finishTaskStateTransition({ actorId: null }, cascade);
  };
}
