/** Existence and capability checks for every reference a command points an object at. */
import {
  actor,
  cycle,
  initiative,
  label,
  milestone,
  program,
  project,
  task,
  team,
} from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { ObjectCommandIn } from '../../contracts/object-command';
import { NotFoundError } from '../../error';
import { assertResourceCapability } from './capabilities';
import { ownedValidation } from './receipt-validator';
import type { CommandScope, Dbh } from './types';

type TaskRow = typeof task.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type TaskOperation = Extract<ObjectCommandIn, { objectKind: 'task' }>['operation'];
type ProjectOperation = Extract<ObjectCommandIn, { objectKind: 'project' }>['operation'];
type TaskPropertyOperation = Extract<TaskOperation, { type: 'replace_property' }>;
type ProjectPropertyOperation = Extract<ProjectOperation, { type: 'replace_property' }>;

/** Require that a Project exists in the organization and is not in the trash. */
export async function assertActiveProject(
  database: Dbh,
  orgId: string,
  id: string | null,
): Promise<void> {
  if (id === null) return;
  const rows = await database
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.organizationId, orgId), eq(project.id, id), isNull(project.archivedAt)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Project not found');
}

/** Require that a Task exists in the organization and is not in the trash. */
export async function assertActiveTask(
  database: Dbh,
  orgId: string,
  id: string | null,
): Promise<void> {
  if (id === null) return;
  const rows = await database
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Task not found');
}

/** Require that a Milestone exists and belongs to the Project the Task will sit in. */
export async function assertMilestoneForProject(
  database: Dbh,
  orgId: string,
  milestoneId: string | null,
  projectId: string | null,
): Promise<void> {
  if (milestoneId === null) return;
  const rows = await database
    .select({ projectId: milestone.projectId })
    .from(milestone)
    .innerJoin(project, eq(milestone.projectId, project.id))
    .where(
      and(
        eq(milestone.id, milestoneId),
        eq(project.organizationId, orgId),
        isNull(project.archivedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Milestone not found');
  if (rows[0].projectId !== projectId) {
    throw ownedValidation("Milestone must belong to the task's project", ['operation', 'value']);
  }
}

/** Require that every Milestone already on the moving Tasks belongs to their destination Project. */
export async function assertMilestonesRemainInProject(
  database: Dbh,
  orgId: string,
  milestoneIds: readonly string[],
  projectId: string | null,
): Promise<void> {
  const ids = [...new Set(milestoneIds)];
  if (ids.length === 0) return;
  const rows = await database
    .select({ id: milestone.id, projectId: milestone.projectId })
    .from(milestone)
    .innerJoin(project, eq(milestone.projectId, project.id))
    .where(
      and(
        inArray(milestone.id, ids),
        eq(project.organizationId, orgId),
        isNull(project.archivedAt),
      ),
    );
  if (rows.length !== ids.length) throw new NotFoundError('Milestone not found');
  if (rows.some((row) => row.projectId !== projectId)) {
    throw ownedValidation("Milestone must belong to the task's project", ['operation', 'value']);
  }
}

/** Require that a referenced row exists in the organization. */
export async function assertReference(
  database: Dbh,
  table: typeof actor | typeof program | typeof cycle | typeof team,
  orgId: string,
  id: string | null,
  message: string,
): Promise<void> {
  if (id === null) return;
  const rows = await database
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, orgId), eq(table.id, id)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError(message);
}

/** Require that a Project lead resolves to an active human Actor in the organization. */
export async function assertActiveHumanProjectLead(
  database: Dbh,
  orgId: string,
  id: string | null,
): Promise<void> {
  if (id === null) return;
  const rows = await database
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, orgId),
        eq(actor.id, id),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Lead not found');
}

/** Require that a Task assignee resolves to an active human or agent Actor. */
export async function assertActiveTaskAssignee(
  database: Dbh,
  orgId: string,
  id: string | null,
): Promise<void> {
  if (id === null) return;
  const rows = await database
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, orgId),
        eq(actor.id, id),
        inArray(actor.kind, ['human', 'agent']),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Assignee not found');
}

/** Require contribute access to a destination container, skipping a cleared reference. */
async function assertContributable(
  scope: CommandScope,
  kind: 'project' | 'program' | 'team',
  id: string | null,
): Promise<void> {
  if (id === null) return;
  await assertResourceCapability(scope, kind, id, 'contribute');
}

/** Require that every moving Task shares one Project before a Milestone can be assigned. */
async function assertMilestoneTarget(
  scope: CommandScope,
  milestoneId: string | null,
  rows: readonly TaskRow[],
): Promise<void> {
  if (milestoneId === null) return;
  const projectIds = new Set(rows.map((row) => row.projectId));
  if (projectIds.size !== 1) {
    throw ownedValidation("Milestone must belong to the task's project", ['operation', 'value']);
  }
  await assertMilestoneForProject(
    scope.database,
    scope.orgId,
    milestoneId,
    projectIds.values().next().value ?? null,
  );
}

async function validateTaskPropertyReferences(
  scope: CommandScope,
  op: TaskPropertyOperation,
  rows: readonly TaskRow[],
): Promise<void> {
  const { database, orgId } = scope;
  switch (op.property) {
    case 'assigneeId':
      await assertActiveTaskAssignee(database, orgId, op.value);
      return;
    case 'projectId':
      await assertActiveProject(database, orgId, op.value);
      await assertContributable(scope, 'project', op.value);
      await assertMilestonesRemainInProject(
        database,
        orgId,
        rows.map((row) => row.milestoneId).filter((id): id is string => id !== null),
        op.value,
      );
      return;
    case 'programId':
      await assertReference(database, program, orgId, op.value, 'Program not found');
      await assertContributable(scope, 'program', op.value);
      return;
    case 'cycleId':
      await assertReference(database, cycle, orgId, op.value, 'Cycle not found');
      return;
    case 'milestoneId':
      await assertMilestoneTarget(scope, op.value, rows);
      return;
    default:
      return;
  }
}

async function validateProjectPropertyReferences(
  scope: CommandScope,
  op: ProjectPropertyOperation,
): Promise<void> {
  const { database, orgId } = scope;
  switch (op.property) {
    case 'leadId':
      await assertActiveHumanProjectLead(database, orgId, op.value);
      return;
    case 'teamId':
      await assertReference(database, team, orgId, op.value, 'Team not found');
      await assertContributable(scope, 'team', op.value);
      return;
    case 'programId':
      await assertReference(database, program, orgId, op.value, 'Program not found');
      await assertContributable(scope, 'program', op.value);
      return;
    default:
      return;
  }
}

async function validateAssociationReferences(
  database: Dbh,
  orgId: string,
  association: 'label' | 'initiative',
  associationIds: readonly string[],
): Promise<void> {
  const table = association === 'label' ? label : initiative;
  const rows = await database
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, orgId), inArray(table.id, associationIds as string[])));
  if (rows.length !== new Set(associationIds).size) {
    throw new NotFoundError(association === 'label' ? 'Label not found' : 'Initiative not found');
  }
}

/** Reject a command whose destination reference is missing, archived, or out of the actor's reach. */
export async function validateReferences(
  scope: CommandScope,
  command: ObjectCommandIn,
  rows: readonly (TaskRow | ProjectRow)[],
): Promise<void> {
  const op = command.operation;
  if (op.type === 'replace_property') {
    if (command.objectKind === 'task') {
      await validateTaskPropertyReferences(
        scope,
        op as TaskPropertyOperation,
        rows as readonly TaskRow[],
      );
    } else {
      await validateProjectPropertyReferences(scope, op as ProjectPropertyOperation);
    }
  }
  if (op.type === 'add_association' || op.type === 'remove_association') {
    await validateAssociationReferences(
      scope.database,
      scope.orgId,
      op.association,
      op.associationIds,
    );
  }
}
