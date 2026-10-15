import { actor, project, team, task } from '@docket/db';
import { TaskCreate } from '@docket/work/task-model';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { NotFoundError } from '../../error';
import {
  assertMilestoneInOrg,
  assertRefInOrg,
  assertTaskCapability,
  loadTask,
} from '../../routes/task-helpers';
import { assertTeamCycle } from '../../services/task-hierarchy';
import { guardsInOrder } from '../guards-in-order';
import { resolveLabelSet } from '../labels';
import { landingTaskTransition, resolveTaskStatus } from '../work-status';
import type { TemplateTransaction } from '../templates/persistence';
import { ordinaryCreationDefaults } from './ordinary-defaults';
import { assertTaskTemplate } from './ordinary-references';
import { prospectiveWorkReference } from './ordinary-prospective';
import type {
  OrdinaryWorkCommand,
  PreparedOrdinaryWork,
  OrdinaryPreparationContext,
} from './types';

/** Resolve a Task's ordinary validation/status/labels without inserting any work. */
export async function prepareOrdinaryTask(
  tx: TemplateTransaction,
  command: Extract<OrdinaryWorkCommand, { kind: 'task' }>,
  context?: OrdinaryPreparationContext,
): Promise<PreparedOrdinaryWork> {
  const { orgId, actorId } = command.caller;
  const body = TaskCreate.parse(await ordinaryCreationDefaults(tx, command, context));
  const relatedTaskIds = await taskReferences(tx, command, body, context);
  const transitionRead =
    body.state === undefined
      ? landingTaskTransition(orgId, body.teamId, tx)
      : resolveTaskStatus(orgId, body.teamId, body.state, 'state', tx);
  const labelsRead = resolveLabelSet(orgId, body.labels, { teamId: body.teamId, dbh: tx });
  await guardsInOrder([transitionRead, labelsRead]);
  const [transition, labels] = await Promise.all([transitionRead, labelsRead]);
  await assertTeamCycle(tx, orgId, body.cycleId, body.teamId);
  return {
    command,
    labels,
    initiativeIds: [],
    relatedTaskIds,
    milestones: [],
    insert: {
      kind: 'task',
      values: {
        workTypeId: body.workTypeId,
        workTypeVersionId: body.workTypeVersionId,
        organizationId: orgId,
        title: body.title,
        description: body.description,
        summary: body.summary ?? null,
        teamId: body.teamId,
        ...transition,
        priority: body.priority ?? 'none',
        assigneeId: body.assigneeId,
        projectId: body.projectId,
        milestoneId: body.milestoneId,
        cycleId: body.cycleId,
        templateId: body.templateId,
        parentTaskId: body.parentTaskId,
        estimate: body.estimate,
        estimateMinutes: body.estimateMinutes,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        programId: command.invocation.placement?.programId,
        visibility:
          context?.rootVisibility === 'private'
            ? 'private'
            : command.invocation.placement?.visibility,
        source: 'native',
        createdBy: actorId,
      },
    },
  };
}

async function taskReferences(
  tx: TemplateTransaction,
  command: Extract<OrdinaryWorkCommand, { kind: 'task' }>,
  body: TaskCreate,
  context?: OrdinaryPreparationContext,
): Promise<string[]> {
  const { orgId, actorId } = command.caller;
  const [teamRow] = await tx
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, body.teamId), eq(team.organizationId, orgId)))
    .limit(1);
  if (!teamRow) throw new NotFoundError('Team not found');
  await guardsInOrder([
    assertRefInOrg(actor, orgId, body.assigneeId, 'Assignee not found', tx),
    ...(prospectiveWorkReference(tx, command, context, 'project', body.projectId)
      ? []
      : [assertRefInOrg(project, orgId, body.projectId, 'Project not found', tx)]),
    validateMilestone(tx, command, body, context),
    ...(actorId ? [assertTaskTemplate(orgId, actorId, body.templateId, tx)] : []),
  ]);
  if (
    body.parentTaskId &&
    !prospectiveWorkReference(tx, command, context, 'task', body.parentTaskId)
  ) {
    const parent = await loadTask(orgId, body.parentTaskId, tx);
    if (actorId) await assertTaskCapability(orgId, actorId, parent, 'contribute', tx);
  }
  const relatedTaskIds = [...(body.relatedTaskIds ?? [])].sort();
  if (relatedTaskIds.length) {
    const related = await tx
      .select()
      .from(task)
      .where(
        and(
          eq(task.organizationId, orgId),
          isNull(task.archivedAt),
          inArray(task.id, relatedTaskIds),
        ),
      )
      .orderBy(asc(task.id));
    if (related.length !== relatedTaskIds.length) throw new NotFoundError('Task not found');
    if (actorId)
      await guardsInOrder(
        related.map((row) => assertTaskCapability(orgId, actorId, row, 'contribute', tx)),
      );
  }
  return relatedTaskIds;
}

async function validateMilestone(
  tx: TemplateTransaction,
  command: Extract<OrdinaryWorkCommand, { kind: 'task' }>,
  body: TaskCreate,
  context?: OrdinaryPreparationContext,
): Promise<void> {
  const planned = prospectiveWorkReference(tx, command, context, 'milestone', body.milestoneId);
  if (planned?.kind === 'milestone') {
    if (planned.projectId !== body.projectId) throw new NotFoundError('Milestone not found');
    return;
  }
  await assertMilestoneInOrg(command.caller.orgId, body.milestoneId, body.projectId, tx);
}
