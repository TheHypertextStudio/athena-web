import { and, eq, inArray } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['AGENT_MAX_TURNS'] = '8';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
});

import type * as DbModule from '@docket/db';
import type * as AgentRuntimeModule from '@docket/athena/turn';
import type * as AsyncRunnerModule from '../../src/agent/async-runner';

const runnerMocks = vi.hoisted(() => ({ admit: vi.fn() }));

vi.mock('../../src/agent/async-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof AsyncRunnerModule>();
  runnerMocks.admit.mockImplementation(actual.admitAthenaGeneration);
  return { ...actual, admitAthenaGeneration: runnerMocks.admit };
});

import type personalAthenaRouter from '../../src/routes/personal-athena';
import type {
  eventIsInAssignmentScope as EventIsInAssignmentScope,
  handleAthenaAssignmentEvent as HandleAthenaAssignmentEvent,
  sweepAthenaAssignmentTriggers as SweepAthenaAssignmentTriggers,
  resolveAssignmentAccess as ResolveAssignmentAccess,
  AthenaAssignmentRow,
} from '../../src/agent/assignments';
import type { getContainer as GetContainer } from '../../src/container';
import type { openToolbox as OpenToolbox } from '../../src/agent/toolbox';
import { enqueueRunGeneration } from '../../src/agent/run-generation';
import { appWithSession, fakeSession, getDb, one, seedStatuses } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

const JSON_HEADERS = { 'content-type': 'application/json' };

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let personalAthena!: typeof personalAthenaRouter;
let handleAthenaAssignmentEvent!: typeof HandleAthenaAssignmentEvent;
let sweepAthenaAssignmentTriggers!: typeof SweepAthenaAssignmentTriggers;
let eventIsInAssignmentScope!: typeof EventIsInAssignmentScope;
let resolveAssignmentAccess!: typeof ResolveAssignmentAccess;
let getContainer!: typeof GetContainer;
let openToolbox!: typeof OpenToolbox;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  personalAthena = (await import('../../src/routes/personal-athena')).default;
  ({
    handleAthenaAssignmentEvent,
    sweepAthenaAssignmentTriggers,
    eventIsInAssignmentScope,
    resolveAssignmentAccess,
  } = await import('../../src/agent/assignments'));
  ({ getContainer } = await import('../../src/container'));
  ({ openToolbox } = await import('../../src/agent/toolbox'));
});

beforeEach(() => {
  const turnRuntime: AgentRuntimeModule.AgentTurnRuntime = {
    async *streamTurn(): AsyncIterable<AgentRuntimeModule.TurnEvent> {
      yield {
        type: 'turn_end',
        stopReason: 'end_turn',
        message: { role: 'assistant', content: [{ type: 'text', text: 'I am on it.' }] },
      };
    },
  };
  vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) =>
    turnRuntime.streamTurn(input),
  );
});

interface Seed {
  readonly userId: string;
  readonly otherUserId: string;
  readonly orgId: string;
  readonly actorId: string;
  readonly otherActorId: string;
  readonly roleId: string;
  readonly teamId: string;
  readonly projectId: string;
  readonly taskId: string;
}

async function seed(): Promise<Seed> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const org = one(
    await db
      .insert(schema.organization)
      .values({
        name: `Assignment ${suffix}`,
        slug: `assignment-${suffix}`,
        lifecycleState: 'active',
      })
      .returning({ id: schema.organization.id }),
  );
  const statusId = await seedStatuses(db, schema, org.id);
  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: org.id,
      key: `member-${suffix}`,
      name: 'Member',
      capabilities: ['view', 'contribute'],
    })
    .returning({ id: schema.role.id });
  const [owner, other] = await db
    .insert(schema.user)
    .values([
      { name: 'Owner', email: `owner-${suffix}@example.com` },
      { name: 'Other', email: `other-${suffix}@example.com` },
    ])
    .returning({ id: schema.user.id });
  const [ownerActor, otherActor] = await db
    .insert(schema.actor)
    .values([
      {
        organizationId: org.id,
        kind: 'human',
        displayName: 'Owner',
        userId: assertDefined(owner).id,
        roleId: assertDefined(role).id,
      },
      {
        organizationId: org.id,
        kind: 'human',
        displayName: 'Other',
        userId: assertDefined(other).id,
        roleId: assertDefined(role).id,
      },
    ])
    .returning({ id: schema.actor.id });
  await db.insert(schema.grant).values({
    organizationId: org.id,
    subjectKind: 'role',
    subjectId: assertDefined(role).id,
    resourceKind: 'organization',
    resourceId: org.id,
    capabilities: ['view', 'contribute'],
  });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId: org.id, name: 'Core', key: `A${suffix.slice(0, 4)}` })
    .returning({ id: schema.team.id });
  const [project] = await db
    .insert(schema.project)
    .values({
      organizationId: org.id,
      name: 'Launch',
      status: 'active',
      statusId: statusId('project', 'active'),
      teamId: assertDefined(team).id,
      leadId: assertDefined(ownerActor).id,
      createdBy: assertDefined(ownerActor).id,
    })
    .returning({ id: schema.project.id });
  const [task] = await db
    .insert(schema.task)
    .values({
      organizationId: org.id,
      teamId: assertDefined(team).id,
      projectId: assertDefined(project).id,
      title: 'Ship it',
      state: 'todo',
      statusId: statusId('task', 'todo'),
      assigneeId: assertDefined(ownerActor).id,
      createdBy: assertDefined(ownerActor).id,
    })
    .returning({ id: schema.task.id });
  return {
    userId: assertDefined(owner).id,
    otherUserId: assertDefined(other).id,
    orgId: org.id,
    actorId: assertDefined(ownerActor).id,
    otherActorId: assertDefined(otherActor).id,
    roleId: assertDefined(role).id,
    teamId: assertDefined(team).id,
    projectId: assertDefined(project).id,
    taskId: assertDefined(task).id,
  };
}

async function createAssignment(seedData: Seed, entityType: 'project' | 'task' = 'task') {
  const app = appWithSession(personalAthena, fakeSession(seedData.userId));
  const response = await app.request('/assignments', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      organizationId: seedData.orgId,
      entityType,
      entityId: entityType === 'task' ? seedData.taskId : seedData.projectId,
      objective: 'Keep this moving and report meaningful changes.',
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; activeSessionId: string; status: string };
}

describe('personal Athena assignments', () => {
  it('does not resolve an archived Project as an assignment target', async () => {
    const seedData = await seed();
    await expect(
      resolveAssignmentAccess({
        ownerUserId: seedData.userId,
        organizationId: seedData.orgId,
        entityType: 'project',
        entityId: seedData.projectId,
      }),
    ).resolves.toMatchObject({ title: 'Launch' });
    await db
      .update(schema.project)
      .set({ archivedAt: new Date() })
      .where(eq(schema.project.id, seedData.projectId));
    await expect(
      resolveAssignmentAccess({
        ownerUserId: seedData.userId,
        organizationId: seedData.orgId,
        entityType: 'project',
        entityId: seedData.projectId,
      }),
    ).resolves.toBeNull();
  });
  it('keeps the human assignee and creates a personal notice plus durable owner run', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    expect(assignment.status).toBe('active');
    const [task] = await db.select().from(schema.task).where(eq(schema.task.id, seedData.taskId));
    expect(task?.assigneeId).toBe(seedData.actorId);
    expect(task?.delegateId).toBeNull();
    const [session] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, assignment.activeSessionId));
    expect(session).toMatchObject({
      executorKind: 'athena',
      ownerUserId: seedData.userId,
      contextOrganizationId: seedData.orgId,
      agentId: null,
      trigger: 'assignment',
    });
    expect(
      await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, assignment.activeSessionId)),
    ).toHaveLength(1);
    const notices = await db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.userId, seedData.userId),
          eq(schema.notification.type, 'assignment'),
        ),
      );
    const notice = notices.find((candidate) => candidate.body['assignmentId'] === assignment.id);
    expect(notice).toBeDefined();
    expect(notice?.body).toMatchObject({ assignmentId: assignment.id, url: '/athena' });
  });

  it('keeps assignment and trigger endpoints owner-only', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const ownerApp = appWithSession(personalAthena, fakeSession(seedData.userId));
    const otherApp = appWithSession(personalAthena, fakeSession(seedData.otherUserId));
    expect((await (await ownerApp.request('/assignments')).json()) as unknown[]).toHaveLength(1);
    expect((await (await otherApp.request('/assignments')).json()) as unknown[]).toHaveLength(0);
    expect((await otherApp.request(`/assignments/${assignment.id}`)).status).toBe(404);
    expect(
      (
        await otherApp.request(`/assignments/${assignment.id}/triggers`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
        })
      ).status,
    ).toBe(404);
  });

  it('fires project-subtree events, honors cooldown, and supports independent assignments', async () => {
    const seedData = await seed();
    const projectAssignment = await createAssignment(seedData, 'project');
    const taskAssignment = await createAssignment(seedData, 'task');
    expect(projectAssignment.id).not.toBe(taskAssignment.id);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const triggerResponse = await app.request(`/assignments/${projectAssignment.id}/triggers`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: 'event', eventKinds: ['status_change'], cooldownMinutes: 5 }),
    });
    expect(triggerResponse.status).toBe(201);
    const firedAt = new Date('2026-07-15T20:00:00.000Z');
    await handleAthenaAssignmentEvent(
      {
        organizationId: seedData.orgId,
        kind: 'status_change',
        subject: { type: 'task', id: seedData.taskId, title: 'Ship it' },
        title: 'Task changed',
      },
      firedAt,
    );
    await handleAthenaAssignmentEvent(
      {
        organizationId: seedData.orgId,
        kind: 'status_change',
        subject: { type: 'task', id: seedData.taskId, title: 'Ship it' },
        title: 'Duplicate change',
      },
      new Date(firedAt.getTime() + 60_000),
    );
    const assignmentSessions = await db
      .select()
      .from(schema.agentSession)
      .where(
        and(
          eq(schema.agentSession.ownerUserId, seedData.userId),
          eq(schema.agentSession.trigger, 'assignment'),
        ),
      );
    // Two initial assignment runs plus one event-triggered run; cooldown blocks the duplicate.
    expect(assignmentSessions).toHaveLength(3);
  });

  it('does not expose or fire for an inaccessible initiative-linked subject until exact access is granted', async () => {
    const seedData = await seed();
    const statusId = await seedStatuses(db, schema, seedData.orgId);
    const initiative = one(
      await db
        .insert(schema.initiative)
        .values({
          organizationId: seedData.orgId,
          name: 'Portfolio theme',
          ownerId: seedData.actorId,
          status: 'active',
          statusId: statusId('initiative', 'active'),
        })
        .returning({ id: schema.initiative.id }),
    );
    const linkedProgram = one(
      await db
        .insert(schema.program)
        .values({
          organizationId: seedData.orgId,
          name: 'Sensitive operations',
          ownerId: seedData.actorId,
          status: 'active',
          statusId: statusId('program', 'active'),
        })
        .returning({ id: schema.program.id }),
    );
    await db.insert(schema.initiativeProject).values({
      organizationId: seedData.orgId,
      initiativeId: initiative.id,
      projectId: seedData.projectId,
    });
    await db.insert(schema.initiativeProgram).values({
      organizationId: seedData.orgId,
      initiativeId: initiative.id,
      programId: linkedProgram.id,
    });
    await db.delete(schema.grant).where(eq(schema.grant.organizationId, seedData.orgId));
    await db.insert(schema.grant).values({
      organizationId: seedData.orgId,
      subjectKind: 'actor',
      subjectId: seedData.actorId,
      resourceKind: 'initiative',
      resourceId: initiative.id,
      capabilities: ['view', 'contribute'],
    });

    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const created = await app.request('/assignments', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        organizationId: seedData.orgId,
        entityType: 'initiative',
        entityId: initiative.id,
        objective: 'Watch this theme.',
      }),
    });
    expect(created.status).toBe(201);
    const assignment = (await created.json()) as { id: string };
    expect(
      (
        await app.request(`/assignments/${assignment.id}/triggers`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ type: 'event', eventKinds: ['status_change'] }),
        })
      ).status,
    ).toBe(201);

    const denied = await handleAthenaAssignmentEvent({
      organizationId: seedData.orgId,
      kind: 'status_change',
      subject: { type: 'project', id: seedData.projectId, title: 'Secret launch' },
      title: 'SECRET PROJECT TITLE MUST NOT LEAK',
    });
    expect(denied).toEqual({ triggered: 0, paused: 0, skipped: 1 });
    const activitiesAfterDenied = await db
      .select({ body: schema.sessionActivity.body })
      .from(schema.sessionActivity)
      .innerJoin(schema.agentSession, eq(schema.sessionActivity.sessionId, schema.agentSession.id))
      .where(eq(schema.agentSession.ownerUserId, seedData.userId));
    expect(JSON.stringify(activitiesAfterDenied)).not.toContain(
      'SECRET PROJECT TITLE MUST NOT LEAK',
    );
    expect(JSON.stringify(activitiesAfterDenied)).not.toContain('Secret launch');
    const deniedProgram = await handleAthenaAssignmentEvent({
      organizationId: seedData.orgId,
      kind: 'status_change',
      subject: { type: 'program', id: linkedProgram.id, title: 'Secret operations' },
      title: 'SECRET PROGRAM TITLE MUST NOT LEAK',
    });
    expect(deniedProgram).toEqual({ triggered: 0, paused: 0, skipped: 1 });

    await db.insert(schema.grant).values({
      organizationId: seedData.orgId,
      subjectKind: 'actor',
      subjectId: seedData.actorId,
      resourceKind: 'project',
      resourceId: seedData.projectId,
      capabilities: ['view', 'contribute'],
    });
    await db.insert(schema.grant).values({
      organizationId: seedData.orgId,
      subjectKind: 'actor',
      subjectId: seedData.actorId,
      resourceKind: 'program',
      resourceId: linkedProgram.id,
      capabilities: ['view', 'contribute'],
    });
    const allowed = await handleAthenaAssignmentEvent(
      {
        organizationId: seedData.orgId,
        kind: 'status_change',
        subject: { type: 'project', id: seedData.projectId, title: 'Spoofed title' },
        title: 'Spoofed event title',
      },
      new Date(Date.now() + 6 * 60_000),
    );
    expect(allowed.triggered).toBe(1);
    const activitiesAfterAllowed = await db
      .select({ body: schema.sessionActivity.body })
      .from(schema.sessionActivity)
      .innerJoin(schema.agentSession, eq(schema.sessionActivity.sessionId, schema.agentSession.id))
      .where(eq(schema.agentSession.ownerUserId, seedData.userId));
    expect(JSON.stringify(activitiesAfterAllowed)).toContain('Launch');
    expect(JSON.stringify(activitiesAfterAllowed)).not.toContain('Spoofed title');
    expect(JSON.stringify(activitiesAfterAllowed)).not.toContain('Spoofed event title');
    const allowedProgram = await handleAthenaAssignmentEvent(
      {
        organizationId: seedData.orgId,
        kind: 'status_change',
        subject: { type: 'program', id: linkedProgram.id, title: 'Spoofed operations' },
        title: 'Spoofed program event title',
      },
      new Date(Date.now() + 12 * 60_000),
    );
    expect(allowedProgram.triggered).toBe(1);
    const finalActivities = await db
      .select({ body: schema.sessionActivity.body })
      .from(schema.sessionActivity)
      .innerJoin(schema.agentSession, eq(schema.sessionActivity.sessionId, schema.agentSession.id))
      .where(eq(schema.agentSession.ownerUserId, seedData.userId));
    expect(JSON.stringify(finalActivities)).toContain('Sensitive operations');
    expect(JSON.stringify(finalActivities)).not.toContain('Spoofed operations');
    expect(JSON.stringify(finalActivities)).not.toContain('SECRET PROGRAM TITLE MUST NOT LEAK');
  });

  it('pauses work and disables triggers when the owner loses current access', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const scheduled = await app.request(`/assignments/${assignment.id}/triggers`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
    });
    expect(scheduled.status).toBe(201);
    await db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, seedData.actorId));

    const result = await sweepAthenaAssignmentTriggers(new Date(Date.now() + 10 * 60_000));
    expect(result.paused).toBeGreaterThanOrEqual(1);
    const [paused] = await db
      .select()
      .from(schema.athenaAssignment)
      .where(eq(schema.athenaAssignment.id, assignment.id));
    expect(paused).toMatchObject({ status: 'paused', pausedReason: 'access_lost' });
    const triggers = await db
      .select()
      .from(schema.athenaTrigger)
      .where(eq(schema.athenaTrigger.assignmentId, assignment.id));
    expect(triggers.every((trigger) => !trigger.enabled)).toBe(true);
  });

  it('lets Athena pause or remove only its owner-scoped assignment triggers', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const created = await app.request(`/assignments/${assignment.id}/triggers`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
    });
    const trigger = (await created.json()) as { id: string };
    const ownerToolbox = await openToolbox({ kind: 'athena', ownerUserId: seedData.userId });
    const otherToolbox = await openToolbox({ kind: 'athena', ownerUserId: seedData.otherUserId });
    try {
      const denied = await otherToolbox.callTool('pause_athena_assignment_trigger', {
        assignmentId: assignment.id,
        triggerId: trigger.id,
      });
      expect(denied.isError).toBe(true);

      const paused = await ownerToolbox.callTool('pause_athena_assignment_trigger', {
        assignmentId: assignment.id,
        triggerId: trigger.id,
      });
      expect(paused.isError).toBe(false);
      expect(
        one(
          await db
            .select()
            .from(schema.athenaTrigger)
            .where(eq(schema.athenaTrigger.id, trigger.id)),
        ).enabled,
      ).toBe(false);

      const removed = await ownerToolbox.callTool('remove_athena_assignment_trigger', {
        assignmentId: assignment.id,
        triggerId: trigger.id,
      });
      expect(removed.isError).toBe(false);
      expect(
        await db.select().from(schema.athenaTrigger).where(eq(schema.athenaTrigger.id, trigger.id)),
      ).toHaveLength(0);
    } finally {
      await ownerToolbox.close();
      await otherToolbox.close();
    }
  });

  it('queues initial, event-triggered, and scheduled assignment work through async admission', async () => {
    runnerMocks.admit.mockClear().mockImplementation(async (session, options) => ({
      mode: 'async',
      queued: await enqueueRunGeneration(session, options),
    }));
    const seedData = await seed();
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const assignmentResponse = await app.request('/assignments', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        organizationId: seedData.orgId,
        entityType: 'task',
        entityId: seedData.taskId,
        objective: 'Keep this queued through the durable runner.',
      }),
    });
    expect(assignmentResponse.status, await assignmentResponse.clone().text()).toBe(201);
    const assignment = (await assignmentResponse.json()) as {
      id: string;
      activeSessionId: string;
    };

    const eventTriggerResponse = await app.request(`/assignments/${assignment.id}/triggers`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: 'event', eventKinds: ['status_change'] }),
    });
    const eventTrigger = (await eventTriggerResponse.json()) as { id: string };
    const scheduledTriggerResponse = await app.request(`/assignments/${assignment.id}/triggers`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
    });
    const scheduledTrigger = (await scheduledTriggerResponse.json()) as { id: string };
    expect(eventTrigger.id).not.toBe(scheduledTrigger.id);

    const [scheduledRow] = await db
      .select({ nextRunAt: schema.athenaTrigger.nextRunAt })
      .from(schema.athenaTrigger)
      .where(eq(schema.athenaTrigger.id, scheduledTrigger.id));
    const scheduledAt = scheduledRow?.nextRunAt;
    if (!scheduledAt) throw new Error('scheduled trigger is missing its next run');
    expect(scheduledAt).toBeInstanceOf(Date);
    const firedAt = new Date();
    await handleAthenaAssignmentEvent(
      {
        organizationId: seedData.orgId,
        kind: 'status_change',
        subject: { type: 'task', id: seedData.taskId, title: 'untrusted title' },
        title: 'untrusted event',
      },
      firedAt,
    );
    const [afterEvent] = await db
      .select({ activeSessionId: schema.athenaAssignment.activeSessionId })
      .from(schema.athenaAssignment)
      .where(eq(schema.athenaAssignment.id, assignment.id));
    expect(afterEvent?.activeSessionId).not.toBe(assignment.activeSessionId);

    await sweepAthenaAssignmentTriggers(new Date(scheduledAt.getTime() + 1));
    const [afterSchedule] = await db
      .select({ activeSessionId: schema.athenaAssignment.activeSessionId })
      .from(schema.athenaAssignment)
      .where(eq(schema.athenaAssignment.id, assignment.id));
    expect(afterSchedule?.activeSessionId).not.toBe(afterEvent?.activeSessionId);

    const sessionIds = [
      assignment.activeSessionId,
      assertDefined(assertDefined(afterEvent).activeSessionId),
      assertDefined(assertDefined(afterSchedule).activeSessionId),
    ];
    const sessions = await db
      .select({ id: schema.agentSession.id, status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(inArray(schema.agentSession.id, sessionIds));
    const runs = await db
      .select({
        sessionId: schema.agentSessionRun.sessionId,
        status: schema.agentSessionRun.status,
      })
      .from(schema.agentSessionRun)
      .where(inArray(schema.agentSessionRun.sessionId, sessionIds));
    expect(sessions).toHaveLength(3);
    expect(sessions.every((session) => session.status === 'running')).toBe(true);
    expect(runs).toHaveLength(3);
    expect(runs.every((run) => run.status === 'queued')).toBe(true);
    expect(runnerMocks.admit).toHaveBeenCalledTimes(3);
  });
});

describe('personal Athena assignment and trigger management routes', () => {
  it('reads one owner-matched assignment by id', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const response = await app.request(`/assignments/${assignment.id}`);
    expect(response.status).toBe(200);
    expect((await response.json()) as { id: string }).toMatchObject({ id: assignment.id });
  });

  it('pauses an assignment, disabling its triggers, then resumes it without reviving them', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const triggerResponse = await app.request(`/assignments/${assignment.id}/triggers`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
    });
    const trigger = (await triggerResponse.json()) as { id: string; enabled: boolean };
    expect(trigger.enabled).toBe(true);

    const paused = await app.request(`/assignments/${assignment.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: 'paused' }),
    });
    expect(paused.status).toBe(200);
    expect((await paused.json()) as { status: string; pausedReason: string | null }).toMatchObject({
      status: 'paused',
      pausedReason: 'owner_paused',
    });
    const [afterPause] = await db
      .select({ enabled: schema.athenaTrigger.enabled })
      .from(schema.athenaTrigger)
      .where(eq(schema.athenaTrigger.id, trigger.id));
    expect(afterPause?.enabled).toBe(false);

    const resumed = await app.request(`/assignments/${assignment.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: 'active' }),
    });
    expect((await resumed.json()) as { status: string; pausedReason: string | null }).toMatchObject(
      {
        status: 'active',
        pausedReason: null,
      },
    );
    const [afterResume] = await db
      .select({ enabled: schema.athenaTrigger.enabled })
      .from(schema.athenaTrigger)
      .where(eq(schema.athenaTrigger.id, trigger.id));
    // Resuming never silently revives a trigger the owner (or the pause above) disabled.
    expect(afterResume?.enabled).toBe(false);
  });

  it('completing an assignment also disables its triggers', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const triggerResponse = await app.request(`/assignments/${assignment.id}/triggers`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: 'event', eventKinds: ['status_change'] }),
    });
    const trigger = (await triggerResponse.json()) as { id: string };

    const completed = await app.request(`/assignments/${assignment.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: 'completed' }),
    });
    expect((await completed.json()) as { status: string }).toMatchObject({ status: 'completed' });
    const [row] = await db
      .select({ enabled: schema.athenaTrigger.enabled })
      .from(schema.athenaTrigger)
      .where(eq(schema.athenaTrigger.id, trigger.id));
    expect(row?.enabled).toBe(false);
  });

  it('hides another user’s assignment behind not-found for read, edit, and delete', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const otherApp = appWithSession(personalAthena, fakeSession(seedData.otherUserId));
    expect((await otherApp.request(`/assignments/${assignment.id}`)).status).toBe(404);
    expect(
      (
        await otherApp.request(`/assignments/${assignment.id}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ status: 'paused' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await otherApp.request(`/assignments/${assignment.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('deletes an assignment and cascades its triggers', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const trigger = (await (
      await app.request(`/assignments/${assignment.id}/triggers`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
      })
    ).json()) as { id: string };

    const deleted = await app.request(`/assignments/${assignment.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect(
      await db
        .select()
        .from(schema.athenaAssignment)
        .where(eq(schema.athenaAssignment.id, assignment.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.athenaTrigger).where(eq(schema.athenaTrigger.id, trigger.id)),
    ).toHaveLength(0);
  });

  it('lists an assignment’s own triggers, newest last, excluding another assignment’s', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const otherAssignment = await createAssignment(seedData, 'project');
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const first = (await (
      await app.request(`/assignments/${assignment.id}/triggers`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
      })
    ).json()) as { id: string };
    const second = (await (
      await app.request(`/assignments/${assignment.id}/triggers`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: 'event', eventKinds: ['status_change'] }),
      })
    ).json()) as { id: string };
    await app.request(`/assignments/${otherAssignment.id}/triggers`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
    });

    const response = await app.request(`/assignments/${assignment.id}/triggers`);
    expect(response.status).toBe(200);
    const triggers = (await response.json()) as { id: string }[];
    expect(triggers.map((row) => row.id)).toEqual([first.id, second.id]);
  });

  it('hides another user’s assignment triggers behind not-found', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const otherApp = appWithSession(personalAthena, fakeSession(seedData.otherUserId));
    expect((await otherApp.request(`/assignments/${assignment.id}/triggers`)).status).toBe(404);
  });

  it('pauses and resumes one trigger directly through its HTTP route', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const trigger = (await (
      await app.request(`/assignments/${assignment.id}/triggers`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
      })
    ).json()) as { id: string; enabled: boolean };
    expect(trigger.enabled).toBe(true);

    const paused = await app.request(`/assignments/${assignment.id}/triggers/${trigger.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ enabled: false }),
    });
    expect(paused.status).toBe(200);
    expect((await paused.json()) as { enabled: boolean }).toMatchObject({ enabled: false });

    const resumed = await app.request(`/assignments/${assignment.id}/triggers/${trigger.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ enabled: true }),
    });
    expect((await resumed.json()) as { enabled: boolean }).toMatchObject({ enabled: true });
  });

  it('hides another user’s trigger behind not-found for edit and delete', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const trigger = (await (
      await app.request(`/assignments/${assignment.id}/triggers`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
      })
    ).json()) as { id: string };
    const otherApp = appWithSession(personalAthena, fakeSession(seedData.otherUserId));
    expect(
      (
        await otherApp.request(`/assignments/${assignment.id}/triggers/${trigger.id}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ enabled: false }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await otherApp.request(`/assignments/${assignment.id}/triggers/${trigger.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(404);
    // Untouched by the other user's refused attempts.
    const [row] = await db
      .select({ enabled: schema.athenaTrigger.enabled })
      .from(schema.athenaTrigger)
      .where(eq(schema.athenaTrigger.id, trigger.id));
    expect(row?.enabled).toBe(true);
  });

  it('removes one trigger directly through its HTTP route without touching its assignment', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const trigger = (await (
      await app.request(`/assignments/${assignment.id}/triggers`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
      })
    ).json()) as { id: string };

    const deleted = await app.request(`/assignments/${assignment.id}/triggers/${trigger.id}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);
    expect(
      await db.select().from(schema.athenaTrigger).where(eq(schema.athenaTrigger.id, trigger.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.athenaAssignment.id })
        .from(schema.athenaAssignment)
        .where(eq(schema.athenaAssignment.id, assignment.id)),
    ).toHaveLength(1);
  });

  it('refuses a trigger id paired with the wrong (but owner-matched) assignment id', async () => {
    const seedData = await seed();
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const assignmentA = await createAssignment(seedData, 'task');
    const assignmentB = await createAssignment(seedData, 'project');
    const trigger = (await (
      await app.request(`/assignments/${assignmentA.id}/triggers`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
      })
    ).json()) as { id: string };

    // The trigger genuinely belongs to `assignmentA`, and both assignments genuinely belong to
    // this owner — only the (assignment, trigger) pairing itself is wrong, which must still
    // refuse rather than resolve on ownership alone.
    const response = await app.request(`/assignments/${assignmentB.id}/triggers/${trigger.id}`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(404);
  });

  it('hides an assignment edit that lost a race with its own deletion', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));

    const [patchResponse, deleteResponse] = await Promise.all([
      app.request(`/assignments/${assignment.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ status: 'paused' }),
      }),
      app.request(`/assignments/${assignment.id}`, { method: 'DELETE' }),
    ]);

    const statuses = [patchResponse.status, deleteResponse.status].sort();
    expect(statuses).toEqual([200, 404].sort());
  });

  it('hides a trigger edit that lost a race with its own removal', async () => {
    const seedData = await seed();
    const assignment = await createAssignment(seedData);
    const app = appWithSession(personalAthena, fakeSession(seedData.userId));
    const trigger = (await (
      await app.request(`/assignments/${assignment.id}/triggers`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: 'scheduled', scheduleMinutes: 5 }),
      })
    ).json()) as { id: string };

    const [patchResponse, deleteResponse] = await Promise.all([
      app.request(`/assignments/${assignment.id}/triggers/${trigger.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ enabled: false }),
      }),
      app.request(`/assignments/${assignment.id}/triggers/${trigger.id}`, { method: 'DELETE' }),
    ]);

    const statuses = [patchResponse.status, deleteResponse.status].sort();
    expect(statuses).toEqual([200, 404].sort());
  });

  it.each(['task', 'project', 'initiative'] as const)(
    'hides a %s assignment target that does not exist as not found',
    async (entityType) => {
      const seedData = await seed();
      const app = appWithSession(personalAthena, fakeSession(seedData.userId));
      const response = await app.request('/assignments', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          organizationId: seedData.orgId,
          entityType,
          // Well-formed ULID (so it clears Zod), but no such row exists.
          entityId: '00000000000000000000000000',
          objective: 'Work on something that was never created.',
        }),
      });
      expect(response.status).toBe(404);
    },
  );

  describe('eventIsInAssignmentScope', () => {
    function assignmentRow(
      overrides: Pick<AthenaAssignmentRow, 'entityType' | 'entityId' | 'organizationId'>,
    ): AthenaAssignmentRow {
      return {
        id: 'assignment-fixture',
        ownerUserId: 'owner-fixture',
        objective: 'fixture',
        status: 'active',
        activeSessionId: null,
        pausedReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
    }

    it('is out of scope when a task-scoped assignment receives a non-task subject', async () => {
      const seedData = await seed();
      const assignment = assignmentRow({
        entityType: 'task',
        entityId: seedData.taskId,
        organizationId: seedData.orgId,
      });
      await expect(
        eventIsInAssignmentScope(assignment, { type: 'project', id: seedData.projectId }),
      ).resolves.toBe(false);
    });

    it('is out of scope when a project-scoped assignment receives a non-task subject', async () => {
      const seedData = await seed();
      const assignment = assignmentRow({
        entityType: 'project',
        entityId: seedData.projectId,
        organizationId: seedData.orgId,
      });
      await expect(
        eventIsInAssignmentScope(assignment, { type: 'program', id: 'some-program' }),
      ).resolves.toBe(false);
    });

    it('is out of scope when an initiative-scoped assignment receives a subject that is not task/project/program', async () => {
      const seedData = await seed();
      const assignment = assignmentRow({
        entityType: 'initiative',
        entityId: 'some-initiative',
        organizationId: seedData.orgId,
      });
      await expect(
        eventIsInAssignmentScope(assignment, { type: 'agent_session', id: 'some-session' }),
      ).resolves.toBe(false);
    });
  });
});
