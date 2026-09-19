/**
 * `@docket/api` — applying the group a work item was dropped into.
 *
 * @remarks
 * A board drop says two things at once: where the item sits in its column, and which column that
 * is. `./order` owns the first — the contextual fractional rank — and this module owns the second.
 * Each group field is a different write against a different table, so they are stated one per
 * function here rather than as one long branch inside the reorder.
 *
 * Every path returns an after-commit callback rather than publishing inline, because the domain
 * write and the rank write share one transaction and neither event nor search index should be told
 * about a move that has not committed.
 */
import { initiative, program, project, projectTeam, task } from '@docket/db';
import type { WorkViewOrderRequest } from '@docket/work/work-view-contract';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../../error';
import { labelsForSubject, replaceLabels, resolveLabelSet } from '../labels';
import { diffTaskFields, recordTaskChanges, resolveTaskChangeLabels } from '../task-audit';
import * as taskState from '../task-state';
import {
  landingStatus,
  resolveContainerStatus,
  resolveTaskStatus,
  terminalStampsFor,
} from '../work-status';
import { enqueueSearchUpsert } from '../../search/write-through';
import { emitEvent } from '../../routes/event-emit';
import { compileProjectTeamMembershipSql } from './project-team-sql';
import {
  countRow,
  executeOne,
  executeRows,
  noAfterCommit,
  nullableStringValue,
  stringValue,
  type AfterCommit,
  type ReorderWorkViewInput,
  type WorkViewTransaction,
} from './order-runtime';

/** Refuse a group value that names a row this organization does not have. */
async function assertReference(
  database: WorkViewTransaction,
  tableName: string,
  organizationId: string,
  id: string,
  message: string,
): Promise<void> {
  const found = await executeOne(
    database,
    sql`select count(*)::int count from ${sql.raw(tableName)}
      where id=${id} and organization_id=${organizationId}`,
    countRow,
  );
  if (found.count !== 1) throw new NotFoundError(message);
}

/** One label swap: which label the item leaves, and which it joins. */
interface LabelSwap {
  readonly tx: WorkViewTransaction;
  readonly target: WorkViewOrderRequest['target'];
  readonly itemId: string;
  readonly organizationId: string;
  readonly sourceLabelId: string | null;
  readonly destinationLabelId: string | null;
}

/**
 * The teams whose team-scoped labels this item may carry.
 *
 * @param swap - The label swap being applied.
 * @returns The team ids to resolve labels against.
 */
async function labelScopeTeamIds(swap: LabelSwap): Promise<readonly string[]> {
  const { tx, target, itemId, organizationId } = swap;
  if (target === 'task') {
    const owner = await executeOne(
      tx,
      sql`select (select owned_team.id from task subject
          join team owned_team on owned_team.id=subject.team_id
            and owned_team.organization_id=subject.organization_id
          where subject.id=${itemId} and subject.organization_id=${organizationId}) id`,
      z.object({ id: z.string().nullable() }).loose(),
    );
    return owner.id ? [owner.id] : [];
  }
  if (target !== 'project') return [];
  const memberships = await executeRows(
    tx,
    sql`select project_teams.team_id from project e
      cross join lateral (${compileProjectTeamMembershipSql(
        sql`e.id`,
        sql`e.organization_id`,
        sql`e.team_id`,
      )}) project_teams
      where e.id=${itemId} and e.organization_id=${organizationId}`,
    z.object({ team_id: z.string() }).loose(),
  );
  return memberships.map((membership) => membership.team_id);
}

/**
 * Move an item between two label columns, leaving its other labels untouched.
 *
 * @param swap - The label swap being applied.
 */
async function replaceOneLabel(swap: LabelSwap): Promise<void> {
  const { tx, target, itemId, organizationId, sourceLabelId, destinationLabelId } = swap;
  const existing = await labelsForSubject(target, organizationId, itemId, tx);
  const teamIds = await labelScopeTeamIds(swap);
  const retained = existing
    .map((label) => label.id)
    .filter((labelId) => labelId !== sourceLabelId && labelId !== destinationLabelId);
  const next = await resolveLabelSet(
    organizationId,
    [...retained, ...(destinationLabelId === null ? [] : [destinationLabelId])],
    { teamIds, dbh: tx },
  );
  await replaceLabels(tx, { kind: target, subjectId: itemId, orgId: organizationId }, next);
}

/**
 * Resolve a group value that may name an actor symbolically.
 *
 * @param value - The raw group value.
 * @param actorId - The acting person's actor id, for `current-actor`.
 * @param field - The group field, used in the type error.
 * @returns The resolved id, or `null` for the unset column.
 */
function actorGroupValue(value: unknown, actorId: string, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'object' || !('kind' in value)) return stringValue(value, field);
  const symbolic = value as { readonly kind: unknown; readonly actorId?: unknown };
  return symbolic.kind === 'current-actor' ? actorId : stringValue(symbolic.actorId, field);
}

async function taskTransitionAfterCommit(
  tx: WorkViewTransaction,
  actorId: string,
  mutation: taskState.TaskStateMutation,
): Promise<AfterCommit> {
  const timerStops = await taskState.closeCompletingUserTaskTimers(tx, actorId, mutation);
  const cascades = await taskState.applySubtaskCompletionPolicy(tx, mutation);
  return async () => {
    await taskState.finishTaskStateTransition({ actorId }, mutation);
    await taskState.emitCompletedTaskTimerStops(timerStops);
    for (const cascade of cascades) {
      await taskState.finishTaskStateTransition({ actorId: null }, cascade);
    }
  };
}

/** Load the live task a group mutation targets, or refuse the whole drop. */
async function loadLiveTask(
  tx: WorkViewTransaction,
  organizationId: string,
  itemId: string,
  requireUnarchived = true,
) {
  const rows = await tx
    .select()
    .from(task)
    .where(
      and(
        eq(task.id, itemId),
        eq(task.organizationId, organizationId),
        ...(requireUnarchived ? [isNull(task.archivedAt)] : []),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Work item not found');
  return row;
}

/** Move a task into the workflow status its new column names. */
async function mutateTaskStatus(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
): Promise<AfterCommit> {
  const { request, organizationId, actorId } = input;
  const before = await loadLiveTask(tx, organizationId, request.itemId);
  const transition = await resolveTaskStatus(
    organizationId,
    before.teamId,
    stringValue(request.groupValue, 'status'),
    'status',
    tx,
  );
  const mutation = await taskState.writeTaskStateTransition(tx, {
    before,
    statusId: transition.statusId,
    state: transition.state,
    completedAt: transition.completedAt,
    canceledAt: transition.canceledAt,
  });
  if (!mutation) throw new NotFoundError('Work item not found');
  return taskTransitionAfterCommit(tx, actorId, mutation);
}

/** Move a project, program, or initiative into the status its new column names. */
async function mutateContainerStatus(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
): Promise<AfterCommit> {
  const { request, organizationId, actorId } = input;
  if (request.target === 'task') throw new TypeError('A task status is not a container status.');
  const status = await resolveContainerStatus(
    organizationId,
    request.target,
    stringValue(request.groupValue, 'status'),
    'status',
    tx,
  );
  const table = { project, program, initiative }[request.target];
  const updated = await tx
    .update(table)
    .set({ status: status.status, statusId: status.statusId })
    .where(and(eq(table.id, request.itemId), eq(table.organizationId, organizationId)))
    .returning();
  const changed = updated[0];
  if (!changed) throw new NotFoundError('Work item not found');
  const title = 'name' in changed ? changed.name : request.itemId;
  return async () => {
    await emitEvent({
      organizationId,
      kind: 'status_change',
      actorId,
      title,
      subject: { type: request.target, id: request.itemId, title },
      detail: { schema: 'docket.state_change', fromState: null, toState: status.status },
    });
    await enqueueSearchUpsert(organizationId, request.target, request.itemId);
  };
}

/**
 * Move a project between team columns, keeping its primary team consistent.
 *
 * @remarks
 * A project belongs to many teams and has one primary. Dropping it out of its primary team's
 * column has to promote another, or the project would be left with a primary it no longer belongs
 * to — so the primary is recomputed from what remains rather than simply cleared.
 *
 * @param tx - The open transaction.
 * @param input - The reorder request.
 * @param move - The team columns the project moves between.
 * @returns The after-commit callback.
 */
async function mutateProjectTeams(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  move: { readonly sourceTeamId: string | null; readonly destinationTeamId: string | null },
): Promise<AfterCommit> {
  const { request, organizationId } = input;
  const { sourceTeamId, destinationTeamId } = move;
  if (destinationTeamId !== null) {
    await assertReference(tx, 'team', organizationId, destinationTeamId, 'Team not found');
  }
  const current = (
    await tx
      .select({ teamId: project.teamId })
      .from(project)
      .where(and(eq(project.id, request.itemId), eq(project.organizationId, organizationId)))
      .limit(1)
  )[0];
  if (!current) throw new NotFoundError('Work item not found');
  if (sourceTeamId === destinationTeamId) return noAfterCommit;

  if (sourceTeamId !== null) {
    await tx
      .delete(projectTeam)
      .where(
        and(
          eq(projectTeam.organizationId, organizationId),
          eq(projectTeam.projectId, request.itemId),
          eq(projectTeam.teamId, sourceTeamId),
        ),
      );
  }
  if (destinationTeamId !== null) {
    await tx
      .insert(projectTeam)
      .values({
        organizationId,
        projectId: request.itemId,
        teamId: destinationTeamId,
        isPrimary: false,
      })
      .onConflictDoUpdate({
        target: [projectTeam.projectId, projectTeam.teamId],
        set: { isPrimary: false },
      });
  }

  const primaryTeamId = await resolvePrimaryTeam(tx, input, {
    currentTeamId: current.teamId,
    sourceTeamId,
    destinationTeamId,
  });
  await tx
    .update(projectTeam)
    .set({ isPrimary: false })
    .where(
      and(
        eq(projectTeam.organizationId, organizationId),
        eq(projectTeam.projectId, request.itemId),
        eq(projectTeam.isPrimary, true),
      ),
    );
  if (primaryTeamId !== null) {
    await tx
      .insert(projectTeam)
      .values({ organizationId, projectId: request.itemId, teamId: primaryTeamId, isPrimary: true })
      .onConflictDoUpdate({
        target: [projectTeam.projectId, projectTeam.teamId],
        set: { isPrimary: true },
      });
  }
  await tx
    .update(project)
    .set({ teamId: primaryTeamId })
    .where(and(eq(project.id, request.itemId), eq(project.organizationId, organizationId)));
  return () => enqueueSearchUpsert(organizationId, 'project', request.itemId);
}

/** The team columns a project team move moves between. */
interface TeamMove {
  readonly currentTeamId: string | null;
  readonly sourceTeamId: string | null;
  readonly destinationTeamId: string | null;
}

/**
 * Decide which team stays primary after a project team move.
 *
 * @param tx - The open transaction.
 * @param input - The reorder request.
 * @param move - The team columns involved.
 * @returns The team to mark primary, or `null` when the project belongs to none.
 */
async function resolvePrimaryTeam(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  move: TeamMove,
): Promise<string | null> {
  const keepsCurrent = move.currentTeamId !== null && move.currentTeamId !== move.sourceTeamId;
  if (keepsCurrent) return move.currentTeamId;
  if (move.destinationTeamId !== null) return move.destinationTeamId;
  const remaining = (
    await tx
      .select({ teamId: projectTeam.teamId })
      .from(projectTeam)
      .where(
        and(
          eq(projectTeam.organizationId, input.organizationId),
          eq(projectTeam.projectId, input.request.itemId),
        ),
      )
      .orderBy(projectTeam.teamId)
      .limit(1)
  )[0];
  return remaining?.teamId ?? null;
}

/** Move a task between team columns, landing it in the destination team's first status. */
async function mutateTaskTeam(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  actorValue: string | null,
): Promise<AfterCommit> {
  const { request, organizationId, actorId } = input;
  const teamId = stringValue(actorValue, 'team');
  await assertReference(tx, 'team', organizationId, teamId, 'Team not found');
  const before = await loadLiveTask(tx, organizationId, request.itemId);
  if (before.teamId === teamId) return noAfterCommit;
  const destination = await landingStatus(organizationId, 'task', teamId, tx);
  const stamps = terminalStampsFor(destination.category);
  await tx
    .update(task)
    .set({ teamId })
    .where(
      and(
        eq(task.id, request.itemId),
        eq(task.organizationId, organizationId),
        isNull(task.archivedAt),
      ),
    );
  const mutation = await taskState.writeTaskStateTransition(tx, {
    before,
    statusId: destination.id,
    state: destination.key,
    ...stamps,
  });
  if (!mutation) throw new NotFoundError('Work item not found');
  return taskTransitionAfterCommit(tx, actorId, mutation);
}

/** The task column each scalar group field writes, and the row it must name. */
const TASK_SCALAR_FIELDS = {
  priority: { column: 'priority', reference: null, message: '' },
  assignee: { column: 'assigneeId', reference: 'actor', message: 'Assignee not found' },
  delegate: { column: 'delegateId', reference: 'actor', message: 'Delegate not found' },
  project: { column: 'projectId', reference: 'project', message: 'Project not found' },
  program: { column: 'programId', reference: 'program', message: 'Program not found' },
  cycle: { column: 'cycleId', reference: 'cycle', message: 'Cycle not found' },
  milestone: { column: 'milestoneId', reference: 'milestone', message: 'Milestone not found' },
} as const;

/** Set one scalar column on a task from the column it was dropped into. */
async function mutateTaskScalar(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  actorValue: string | null,
): Promise<AfterCommit> {
  const { request, organizationId, actorId } = input;
  const field = request.groupField as keyof typeof TASK_SCALAR_FIELDS;
  const scalar = TASK_SCALAR_FIELDS[field];
  const nextValue =
    field === 'priority'
      ? stringValue(request.groupValue, 'priority')
      : nullableStringValue(actorValue, field);
  if (scalar.reference && nextValue !== null) {
    await assertReference(tx, scalar.reference, organizationId, nextValue, scalar.message);
  }
  const before = await loadLiveTask(tx, organizationId, request.itemId, false);
  const after = (
    await tx
      .update(task)
      .set({ [scalar.column]: nextValue })
      .where(and(eq(task.id, request.itemId), eq(task.organizationId, organizationId)))
      .returning()
  )[0];
  if (!after) throw new NotFoundError('Work item not found');
  return async () => {
    if (field === 'assignee' && nextValue !== null) {
      await emitEvent({
        organizationId,
        kind: 'assignment',
        actorId,
        title: after.title,
        subject: { type: 'task', id: after.id, title: after.title },
      });
    }
    await recordTaskChanges({
      organizationId,
      taskId: after.id,
      title: after.title,
      actorId,
      changes: await resolveTaskChangeLabels(organizationId, diffTaskFields(before, after)),
    });
    await enqueueSearchUpsert(organizationId, 'task', after.id);
  };
}

/** Set a container's priority from the column it was dropped into. */
async function mutateContainerPriority(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
): Promise<AfterCommit> {
  const { request, organizationId } = input;
  const table = request.target === 'project' ? project : initiative;
  const updated = await tx
    .update(table)
    .set({ priority: stringValue(request.groupValue, 'priority') as never })
    .where(and(eq(table.id, request.itemId), eq(table.organizationId, organizationId)))
    .returning({ id: table.id });
  if (!updated[0]) throw new NotFoundError('Work item not found');
  return () => enqueueSearchUpsert(organizationId, request.target, request.itemId);
}

/** Set a container's lead, lead team, or owner from the column it was dropped into. */
async function mutateContainerOwner(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  actorValue: string | null,
): Promise<AfterCommit> {
  const { request, organizationId } = input;
  const scalar = containerOwnerColumn(request);
  if (actorValue !== null) {
    await assertReference(tx, scalar.reference, organizationId, actorValue, scalar.message);
  }
  const updated = await tx
    .update(scalar.table)
    .set({ [scalar.column]: actorValue })
    .where(
      and(eq(scalar.table.id, request.itemId), eq(scalar.table.organizationId, organizationId)),
    )
    .returning({ id: scalar.table.id });
  if (!updated[0]) throw new NotFoundError('Work item not found');
  return () => enqueueSearchUpsert(organizationId, request.target, request.itemId);
}

/** The table and column one container-owner group field writes. */
function containerOwnerColumn(request: WorkViewOrderRequest) {
  if (request.groupField === 'lead') {
    return { table: project, column: 'leadId', reference: 'actor', message: 'Lead not found' };
  }
  if (request.groupField === 'leadTeam') {
    return {
      table: initiative,
      column: 'leadTeamId',
      reference: 'team',
      message: 'Team not found',
    };
  }
  return {
    table: request.target === 'program' ? program : initiative,
    column: 'ownerId',
    reference: 'actor',
    message: 'Owner not found',
  };
}

/**
 * Apply the group a drop moved an item into.
 *
 * @param tx - The open transaction, shared with the rank write.
 * @param input - Database, authenticated scope, and validated reorder request.
 * @returns The after-commit callback that publishes the move.
 */
export async function mutateGroup(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
): Promise<AfterCommit> {
  const { request, organizationId, actorId } = input;
  if (request.groupField === null) return noAfterCommit;
  if (request.target === 'initiative') {
    const owned = await executeOne(
      tx,
      sql`select count(*)::int count from initiative
        where id=${request.itemId} and organization_id=${organizationId}`,
      countRow,
    );
    if (owned.count !== 1) throw new NotFoundError('Work item not found');
  }

  if (request.groupField === 'labels') {
    await replaceOneLabel({
      tx,
      target: request.target,
      itemId: request.itemId,
      organizationId,
      sourceLabelId: nullableStringValue(request.sourceGroupValue, 'labels'),
      destinationLabelId: nullableStringValue(request.groupValue, 'labels'),
    });
    return () => enqueueSearchUpsert(organizationId, request.target, request.itemId);
  }
  if (request.groupField === 'status') {
    return request.target === 'task'
      ? mutateTaskStatus(tx, input)
      : mutateContainerStatus(tx, input);
  }
  if (request.groupField === 'teams') {
    return mutateProjectTeams(tx, input, {
      sourceTeamId: nullableStringValue(request.sourceGroupValue, 'teams'),
      destinationTeamId: nullableStringValue(request.groupValue, 'teams'),
    });
  }

  const actorValue = actorGroupValue(request.groupValue, actorId, request.groupField);
  if (request.target === 'task') {
    return request.groupField === 'team'
      ? mutateTaskTeam(tx, input, actorValue)
      : mutateTaskScalar(tx, input, actorValue);
  }
  if (request.groupField === 'priority') return mutateContainerPriority(tx, input);
  return mutateContainerOwner(tx, input, actorValue);
}
