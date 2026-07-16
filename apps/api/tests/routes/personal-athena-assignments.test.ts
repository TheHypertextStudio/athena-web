import { and, eq } from 'drizzle-orm';
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
import type * as AgentRuntimeModule from '@docket/agent-runtime';

import type personalAthenaRouter from '../../src/routes/personal-athena';
import type {
  handleAthenaAssignmentEvent as HandleAthenaAssignmentEvent,
  sweepAthenaAssignmentTriggers as SweepAthenaAssignmentTriggers,
} from '../../src/agent/assignments';
import type { getContainer as GetContainer } from '../../src/container';
import type { openToolbox as OpenToolbox } from '../../src/agent/toolbox';
import { appWithSession, fakeSession, getDb, one } from '../support/routes-harness';

const JSON_HEADERS = { 'content-type': 'application/json' };

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let personalAthena!: typeof personalAthenaRouter;
let handleAthenaAssignmentEvent!: typeof HandleAthenaAssignmentEvent;
let sweepAthenaAssignmentTriggers!: typeof SweepAthenaAssignmentTriggers;
let getContainer!: typeof GetContainer;
let openToolbox!: typeof OpenToolbox;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  personalAthena = (await import('../../src/routes/personal-athena')).default;
  ({ handleAthenaAssignmentEvent, sweepAthenaAssignmentTriggers } =
    await import('../../src/agent/assignments'));
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
  const [org] = await db
    .insert(schema.organization)
    .values({
      name: `Assignment ${suffix}`,
      slug: `assignment-${suffix}`,
      lifecycleState: 'active',
    })
    .returning({ id: schema.organization.id });
  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: org!.id,
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
        organizationId: org!.id,
        kind: 'human',
        displayName: 'Owner',
        userId: owner!.id,
        roleId: role!.id,
      },
      {
        organizationId: org!.id,
        kind: 'human',
        displayName: 'Other',
        userId: other!.id,
        roleId: role!.id,
      },
    ])
    .returning({ id: schema.actor.id });
  await db.insert(schema.grant).values({
    organizationId: org!.id,
    subjectKind: 'role',
    subjectId: role!.id,
    resourceKind: 'organization',
    resourceId: org!.id,
    capabilities: ['view', 'contribute'],
  });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId: org!.id, name: 'Core', key: `A${suffix.slice(0, 4)}` })
    .returning({ id: schema.team.id });
  const [project] = await db
    .insert(schema.project)
    .values({
      organizationId: org!.id,
      name: 'Launch',
      status: 'active',
      teamId: team!.id,
      leadId: ownerActor!.id,
      createdBy: ownerActor!.id,
    })
    .returning({ id: schema.project.id });
  const [task] = await db
    .insert(schema.task)
    .values({
      organizationId: org!.id,
      teamId: team!.id,
      projectId: project!.id,
      title: 'Ship it',
      state: 'todo',
      assigneeId: ownerActor!.id,
      createdBy: ownerActor!.id,
    })
    .returning({ id: schema.task.id });
  return {
    userId: owner!.id,
    otherUserId: other!.id,
    orgId: org!.id,
    actorId: ownerActor!.id,
    otherActorId: otherActor!.id,
    roleId: role!.id,
    teamId: team!.id,
    projectId: project!.id,
    taskId: task!.id,
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
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; activeSessionId: string; status: string };
}

describe('personal Athena assignments', () => {
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
    expect(notices.some((notice) => notice.body['assignmentId'] === assignment.id)).toBe(true);
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
    expect(triggerResponse.status).toBe(200);
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
    const initiative = one(
      await db
        .insert(schema.initiative)
        .values({
          organizationId: seedData.orgId,
          name: 'Portfolio theme',
          ownerId: seedData.actorId,
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
    expect(created.status).toBe(200);
    const assignment = (await created.json()) as { id: string };
    expect(
      (
        await app.request(`/assignments/${assignment.id}/triggers`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ type: 'event', eventKinds: ['status_change'] }),
        })
      ).status,
    ).toBe(200);

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
    expect(scheduled.status).toBe(200);
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
});
