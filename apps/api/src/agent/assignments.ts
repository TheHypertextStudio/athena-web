/**
 * User-owned Athena assignment execution and trigger orchestration.
 *
 * @remarks
 * An assignment points at existing Docket work but does not mutate its owner, lead, assignee, or
 * delegate. Every run restores the persisted Better Auth owner, resolves that user's current
 * human Actor, and rechecks current access. Trigger scope is derived from the assigned entity's
 * live subtree, so no stored trigger can widen authority.
 */
import {
  actor,
  agentSession,
  athenaAssignment,
  athenaTrigger,
  db,
  initiative,
  initiativeProgram,
  initiativeProject,
  notification,
  program,
  project,
  sessionActivity,
  task,
} from '@docket/db';
import { canActor } from '@docket/authz';
import type { AthenaAssignmentEntityType, EventKind } from '@docket/types';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';

import { NotFoundError } from '../error';
import type { EmitEventInput } from '../routes/event-emit';
import { runSession } from '../routes/agent-session-runner';
import { admitAthenaGeneration } from './async-runner';

/** Assignment row used by route serializers and trigger workers. */
export type AthenaAssignmentRow = typeof athenaAssignment.$inferSelect;
/** Assignment trigger row used by route serializers and trigger workers. */
export type AthenaTriggerRow = typeof athenaTrigger.$inferSelect;

/** Current human Actor and target title resolved for an assignment owner. */
interface AssignmentAccess {
  readonly actorId: string;
  readonly title: string;
}

/** Resolve the target row and confirm it belongs to the assignment workspace. */
async function targetTitle(
  organizationId: string,
  entityType: AthenaAssignmentEntityType,
  entityId: string,
): Promise<string | null> {
  if (entityType === 'initiative') {
    const [row] = await db
      .select({ title: initiative.name })
      .from(initiative)
      .where(and(eq(initiative.id, entityId), eq(initiative.organizationId, organizationId)))
      .limit(1);
    return row?.title ?? null;
  }
  if (entityType === 'project') {
    const [row] = await db
      .select({ title: project.name })
      .from(project)
      .where(and(eq(project.id, entityId), eq(project.organizationId, organizationId)))
      .limit(1);
    return row?.title ?? null;
  }
  const [row] = await db
    .select({ title: task.title })
    .from(task)
    .where(and(eq(task.id, entityId), eq(task.organizationId, organizationId)))
    .limit(1);
  return row?.title ?? null;
}

/** Resolve an active owner Actor and require current contribute access to the target. */
export async function resolveAssignmentAccess(input: {
  readonly ownerUserId: string;
  readonly organizationId: string;
  readonly entityType: AthenaAssignmentEntityType;
  readonly entityId: string;
}): Promise<AssignmentAccess | null> {
  const [member] = await db
    .select({ actorId: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, input.ownerUserId),
        eq(actor.organizationId, input.organizationId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
      ),
    )
    .limit(1);
  if (!member) return null;
  const permission = await canActor(
    member.actorId,
    'contribute',
    { kind: input.entityType, id: input.entityId, orgId: input.organizationId },
    db,
  );
  if (!permission.allow) return null;
  const title = await targetTitle(input.organizationId, input.entityType, input.entityId);
  return title ? { actorId: member.actorId, title } : null;
}

type TriggerEventSubject = EmitEventInput['subject'];

/** Resolve an emitted subject's canonical title only after exact-subject authorization. */
async function resolveEventSubjectTitle(
  actorId: string,
  organizationId: string,
  subject: TriggerEventSubject,
): Promise<string | null> {
  if (!['initiative', 'project', 'program', 'task'].includes(subject.type)) return null;
  const resource = {
    kind: subject.type as 'initiative' | 'project' | 'program' | 'task',
    id: subject.id,
    orgId: organizationId,
  };
  const visible = await canActor(actorId, 'view', resource, db);
  if (!visible.allow) return null;
  const actionable = await canActor(actorId, 'contribute', resource, db);
  if (!actionable.allow) return null;

  if (subject.type === 'initiative') {
    const [row] = await db
      .select({ title: initiative.name })
      .from(initiative)
      .where(and(eq(initiative.id, subject.id), eq(initiative.organizationId, organizationId)))
      .limit(1);
    return row?.title ?? null;
  }
  if (subject.type === 'project') {
    const [row] = await db
      .select({ title: project.name })
      .from(project)
      .where(and(eq(project.id, subject.id), eq(project.organizationId, organizationId)))
      .limit(1);
    return row?.title ?? null;
  }
  if (subject.type === 'program') {
    const [row] = await db
      .select({ title: program.name })
      .from(program)
      .where(and(eq(program.id, subject.id), eq(program.organizationId, organizationId)))
      .limit(1);
    return row?.title ?? null;
  }
  const [row] = await db
    .select({ title: task.title })
    .from(task)
    .where(and(eq(task.id, subject.id), eq(task.organizationId, organizationId)))
    .limit(1);
  return row?.title ?? null;
}

/** Disable every trigger and pause an assignment after current access is lost. */
async function pauseForAccessLoss(assignment: AthenaAssignmentRow): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(athenaAssignment)
      .set({ status: 'paused', pausedReason: 'access_lost' })
      .where(
        and(
          eq(athenaAssignment.id, assignment.id),
          eq(athenaAssignment.ownerUserId, assignment.ownerUserId),
        ),
      );
    await tx
      .update(athenaTrigger)
      .set({ enabled: false })
      .where(
        and(
          eq(athenaTrigger.assignmentId, assignment.id),
          eq(athenaTrigger.ownerUserId, assignment.ownerUserId),
        ),
      );
  });
}

/**
 * Create and run one owner-attributed assignment session without changing target ownership.
 */
export async function startAssignmentRun(
  assignment: AthenaAssignmentRow,
  actorId: string,
  prompt: string,
  externalRunRef: string,
): Promise<string> {
  const session = await db.transaction(async (tx) => {
    const [session] = await tx
      .insert(agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: assignment.ownerUserId,
        contextOrganizationId: assignment.organizationId,
        taskId: assignment.entityType === 'task' ? assignment.entityId : null,
        trigger: 'assignment',
        status: 'pending',
        initiatorId: actorId,
        externalRunRef,
      })
      .returning();
    if (!session) throw new Error('assignment session insert returned no row');
    await tx.insert(sessionActivity).values({
      sessionId: session.id,
      organizationId: null,
      type: 'response',
      body: { text: prompt, author: 'user', assignmentId: assignment.id },
    });
    await tx
      .update(athenaAssignment)
      .set({ activeSessionId: session.id, pausedReason: null })
      .where(
        and(
          eq(athenaAssignment.id, assignment.id),
          eq(athenaAssignment.ownerUserId, assignment.ownerUserId),
        ),
      );
    return session;
  });
  const admission = await admitAthenaGeneration(session, { runnableStatuses: ['pending'] });
  if (admission.mode === 'sync') {
    await runSession(assignment.organizationId, session.id);
  }
  return session.id;
}

/** Create a user-owned assignment, personal notice, and initial durable run. */
export async function createAthenaAssignment(input: {
  readonly ownerUserId: string;
  readonly organizationId: string;
  readonly entityType: AthenaAssignmentEntityType;
  readonly entityId: string;
  readonly objective: string;
}): Promise<AthenaAssignmentRow> {
  const access = await resolveAssignmentAccess(input);
  if (!access) throw new NotFoundError('Work not found');
  const created = await db.transaction(async (tx) => {
    const [assignment] = await tx.insert(athenaAssignment).values(input).returning();
    if (!assignment) throw new Error('assignment insert returned no row');
    await tx.insert(notification).values({
      userId: input.ownerUserId,
      organizationId: input.organizationId,
      type: 'assignment',
      body: {
        title: `Athena started work on ${access.title}`,
        summary: input.objective,
        url: `/athena/work/${assignment.id}`,
        assignmentId: assignment.id,
      },
    });
    return assignment;
  });
  const sessionId = await startAssignmentRun(
    created,
    access.actorId,
    input.objective,
    `athena-assignment:${created.id}:initial`,
  );
  return { ...created, activeSessionId: sessionId };
}

/** Whether an emitted Docket subject is inside an assignment's current entity subtree. */
export async function eventIsInAssignmentScope(
  assignment: AthenaAssignmentRow,
  subject: EmitEventInput['subject'],
): Promise<boolean> {
  if (subject.type === assignment.entityType && subject.id === assignment.entityId) return true;
  if (assignment.entityType === 'task') {
    if (subject.type !== 'task') return false;
    const [descendant] = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.id, subject.id),
          eq(task.organizationId, assignment.organizationId),
          sql`${assignment.entityId} = any(${task.ancestorPath})`,
        ),
      )
      .limit(1);
    return Boolean(descendant);
  }
  if (assignment.entityType === 'project') {
    if (subject.type !== 'task') return false;
    const [child] = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.id, subject.id),
          eq(task.organizationId, assignment.organizationId),
          eq(task.projectId, assignment.entityId),
        ),
      )
      .limit(1);
    return Boolean(child);
  }
  if (subject.type === 'project') {
    const [linked] = await db
      .select({ id: initiativeProject.projectId })
      .from(initiativeProject)
      .where(
        and(
          eq(initiativeProject.initiativeId, assignment.entityId),
          eq(initiativeProject.projectId, subject.id),
          eq(initiativeProject.organizationId, assignment.organizationId),
        ),
      )
      .limit(1);
    return Boolean(linked);
  }
  if (subject.type === 'program') {
    const [linked] = await db
      .select({ id: initiativeProgram.programId })
      .from(initiativeProgram)
      .where(
        and(
          eq(initiativeProgram.initiativeId, assignment.entityId),
          eq(initiativeProgram.programId, subject.id),
          eq(initiativeProgram.organizationId, assignment.organizationId),
        ),
      )
      .limit(1);
    return Boolean(linked);
  }
  if (subject.type !== 'task') return false;
  const [child] = await db
    .select({ id: task.id })
    .from(task)
    .leftJoin(initiativeProject, eq(initiativeProject.projectId, task.projectId))
    .leftJoin(initiativeProgram, eq(initiativeProgram.programId, task.programId))
    .where(
      and(
        eq(task.id, subject.id),
        eq(task.organizationId, assignment.organizationId),
        or(
          eq(initiativeProject.initiativeId, assignment.entityId),
          eq(initiativeProgram.initiativeId, assignment.entityId),
        ),
      ),
    )
    .limit(1);
  return Boolean(child);
}

/** Outcome counts for a scheduled trigger sweep. */
export interface AthenaTriggerSweepResult {
  /** Triggered assignment runs. */
  readonly triggered: number;
  /** Assignments paused because current access was lost. */
  readonly paused: number;
  /** Rows skipped after a concurrent claim or cooldown. */
  readonly skipped: number;
}

/** Claim and execute one trigger, restoring and re-authorizing its persisted owner. */
async function fireTrigger(
  trigger: AthenaTriggerRow,
  assignment: AthenaAssignmentRow,
  promptOrSubject: string | TriggerEventSubject,
  now: Date,
): Promise<'triggered' | 'paused' | 'skipped'> {
  const access = await resolveAssignmentAccess({
    ownerUserId: assignment.ownerUserId,
    organizationId: assignment.organizationId,
    entityType: assignment.entityType,
    entityId: assignment.entityId,
  });
  if (!access) {
    await pauseForAccessLoss(assignment);
    return 'paused';
  }
  let prompt: string;
  if (typeof promptOrSubject === 'string') {
    prompt = promptOrSubject;
  } else {
    const subjectTitle = await resolveEventSubjectTitle(
      access.actorId,
      assignment.organizationId,
      promptOrSubject,
    );
    if (!subjectTitle) return 'skipped';
    prompt = `A Docket event on ${subjectTitle} needs attention in your assigned work.`;
  }

  const cooldownCutoff = new Date(now.getTime() - trigger.cooldownMinutes * 60_000);
  const nextRunAt =
    trigger.type === 'scheduled' && trigger.scheduleMinutes
      ? new Date(now.getTime() + trigger.scheduleMinutes * 60_000)
      : trigger.nextRunAt;
  const [claimed] = await db
    .update(athenaTrigger)
    .set({ lastTriggeredAt: now, nextRunAt })
    .where(
      and(
        eq(athenaTrigger.id, trigger.id),
        eq(athenaTrigger.ownerUserId, assignment.ownerUserId),
        eq(athenaTrigger.enabled, true),
        or(
          isNull(athenaTrigger.lastTriggeredAt),
          lte(athenaTrigger.lastTriggeredAt, cooldownCutoff),
        ),
      ),
    )
    .returning({ id: athenaTrigger.id });
  if (!claimed) return 'skipped';
  await startAssignmentRun(
    assignment,
    access.actorId,
    prompt,
    `athena-trigger:${trigger.id}:${now.getTime()}`,
  );
  return 'triggered';
}

/** Run every event trigger whose assignment subtree contains the emitted subject. */
export async function handleAthenaAssignmentEvent(
  input: Pick<EmitEventInput, 'organizationId' | 'kind' | 'subject' | 'title'>,
  now: Date = new Date(),
): Promise<AthenaTriggerSweepResult> {
  const rows = await db
    .select({ trigger: athenaTrigger, assignment: athenaAssignment })
    .from(athenaTrigger)
    .innerJoin(athenaAssignment, eq(athenaTrigger.assignmentId, athenaAssignment.id))
    .where(
      and(
        eq(athenaTrigger.type, 'event'),
        eq(athenaTrigger.enabled, true),
        eq(athenaAssignment.status, 'active'),
        eq(athenaAssignment.organizationId, input.organizationId),
      ),
    );
  const result = { triggered: 0, paused: 0, skipped: 0 };
  for (const row of rows) {
    if (!(row.trigger.eventKinds as EventKind[]).includes(input.kind)) continue;
    if (!(await eventIsInAssignmentScope(row.assignment, input.subject))) continue;
    const outcome = await fireTrigger(row.trigger, row.assignment, input.subject, now);
    result[outcome] += 1;
  }
  return result;
}

/** Run every due scheduled assignment trigger. Safe to retry and concurrency-claimed. */
export async function sweepAthenaAssignmentTriggers(
  now: Date = new Date(),
): Promise<AthenaTriggerSweepResult> {
  const rows = await db
    .select({ trigger: athenaTrigger, assignment: athenaAssignment })
    .from(athenaTrigger)
    .innerJoin(athenaAssignment, eq(athenaTrigger.assignmentId, athenaAssignment.id))
    .where(
      and(
        eq(athenaTrigger.type, 'scheduled'),
        eq(athenaTrigger.enabled, true),
        eq(athenaAssignment.status, 'active'),
        lte(athenaTrigger.nextRunAt, now),
      ),
    );
  const result = { triggered: 0, paused: 0, skipped: 0 };
  for (const row of rows) {
    const outcome = await fireTrigger(
      row.trigger,
      row.assignment,
      'Review the assigned work and continue any action that is currently useful.',
      now,
    );
    result[outcome] += 1;
  }
  return result;
}
