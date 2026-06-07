/**
 * `@docket/api` — Hub aggregation surface tests (cross-org, user-scoped).
 *
 * @remarks
 * Exercises the enriched/added Hub read surfaces beyond the basics in `group-d`:
 * `GET /activity` (cross-org audit feed + paging + ordering + isolation), the richer
 * `GET /today` cockpit (approvals/blocked/dueToday/calendar/inbox), `GET /portfolio`
 * swimlanes (program lanes, unassigned, milestone diamonds, the date window, isolation),
 * and `GET /search` typed org-chipped hits (limit + isolation). Mirrors the pglite
 * harness: a session is injected via {@link appWithSession}; the user is made an active
 * human Actor in each org so the cross-org scope resolves.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithSession, fakeSession, getDb, seedBaseOrg } from './harness.test';
import type hubRouter from '../../src/routes/hub';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let hub!: typeof hubRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  hub = (await import('../../src/routes/hub')).default;
});

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Insert a user + its hub; returns ids. */
async function seedUserWithHub(): Promise<{ userId: string; hubId: string }> {
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `hub-${Math.random().toString(36).slice(2)}@e.com` })
    .returning({ id: schema.user.id });
  const [h] = await db
    .insert(schema.hub)
    .values({ userId: user!.id })
    .returning({ id: schema.hub.id });
  return { userId: user!.id, hubId: h!.id };
}

/** Make `userId` an active human Actor in `orgId`; returns the actor id. */
async function joinOrg(userId: string, orgId: string, status: 'active' | 'suspended' = 'active') {
  const [a] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId, status })
    .returning({ id: schema.actor.id });
  return a!.id;
}

describe('hub /activity (cross-org audit feed)', () => {
  it('401 without a session', async () => {
    const noSession = appWithSession(hub, null);
    expect((await noSession.request('/activity')).status).toBe(401);
  });

  it('aggregates events across the caller orgs, paginates, and respects order', async () => {
    const { userId } = await seedUserWithHub();
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    await joinOrg(userId, a.orgId);
    await joinOrg(userId, b.orgId);

    // Three events in org A, one in org B — all in the caller's scope.
    for (let i = 0; i < 3; i++) {
      await db.insert(schema.auditEvent).values({
        organizationId: a.orgId,
        actorId: a.humanActorId,
        subjectType: 'task',
        subjectId: `task-a-${i}`,
        type: 'created',
      });
    }
    await db.insert(schema.auditEvent).values({
      organizationId: b.orgId,
      actorId: b.humanActorId,
      subjectType: 'project',
      subjectId: 'proj-b',
      type: 'updated',
    });

    const app = appWithSession(hub, fakeSession(userId));

    // Full feed: both orgs aggregated, org-chipped.
    const full = await body<{ items: { organizationId: string }[]; nextCursor?: string }>(
      await app.request('/activity'),
    );
    const orgIds = new Set(full.items.map((e) => e.organizationId));
    expect(orgIds.has(a.orgId)).toBe(true);
    expect(orgIds.has(b.orgId)).toBe(true);
    expect(full.items.length).toBeGreaterThanOrEqual(4);

    // Paging: a small limit yields a nextCursor.
    const paged = await body<{ items: unknown[]; nextCursor?: string }>(
      await app.request('/activity?limit=2'),
    );
    expect(paged.items).toHaveLength(2);
    expect(typeof paged.nextCursor).toBe('string');

    // Ascending order is honored (oldest first).
    const asc = await body<{ items: { createdAt: string }[] }>(
      await app.request('/activity?order=asc'),
    );
    const first = asc.items[0]?.createdAt ?? '';
    const last = asc.items[asc.items.length - 1]?.createdAt ?? '';
    expect(first <= last).toBe(true);
  });

  it('tenant isolation: never surfaces events from an org the caller is not in', async () => {
    const { userId } = await seedUserWithHub();
    const mine = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    await joinOrg(userId, mine.orgId);
    // The caller is NOT a member of `foreign`.

    await db.insert(schema.auditEvent).values({
      organizationId: foreign.orgId,
      actorId: foreign.humanActorId,
      subjectType: 'task',
      subjectId: 'secret',
      type: 'created',
    });

    const app = appWithSession(hub, fakeSession(userId));
    const feed = await body<{ items: { organizationId: string }[] }>(
      await app.request('/activity'),
    );
    expect(feed.items.every((e) => e.organizationId !== foreign.orgId)).toBe(true);
  });

  it('a suspended membership does not grant cross-org scope', async () => {
    const { userId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinOrg(userId, org.orgId, 'suspended');
    await db.insert(schema.auditEvent).values({
      organizationId: org.orgId,
      subjectType: 'task',
      subjectId: 'x',
      type: 'created',
    });
    const app = appWithSession(hub, fakeSession(userId));
    expect((await body<{ items: unknown[] }>(await app.request('/activity'))).items).toHaveLength(
      0,
    );
  });

  it('rejects an invalid limit (422)', async () => {
    const { userId } = await seedUserWithHub();
    const app = appWithSession(hub, fakeSession(userId));
    expect((await app.request('/activity?limit=0')).status).toBe(422);
    expect((await app.request('/activity?limit=500')).status).toBe(422);
  });
});

describe('hub /today (needs-attention cockpit)', () => {
  it('surfaces approvals, blocked, dueToday, calendar, and the unread inbox count', async () => {
    const { userId, hubId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    const myActorId = await joinOrg(userId, org.orgId);
    const date = '2026-08-01';

    // dueToday task.
    const [due] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Due today',
        teamId: org.teamId,
        state: 'todo',
        dueDate: new Date(date),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });

    // A planned task that is ALSO due on the date (exercises the sameDay branch so it
    // appears in both `plan` and `needsAttention.dueToday`) and carries a timebox window.
    const [planned] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Planned',
        teamId: org.teamId,
        state: 'todo',
        dueDate: new Date(date),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    await db.insert(schema.dailyPlanItem).values({
      hubId,
      refOrganizationId: org.orgId,
      refTaskId: planned!.id,
      date,
      timeboxStartsAt: new Date(`${date}T09:00:00.000Z`),
      timeboxEndsAt: new Date(`${date}T10:00:00.000Z`),
    });

    // An agent session awaiting approval, tied to a task → approvals.
    const [agentActor] = await db
      .insert(schema.actor)
      .values({ organizationId: org.orgId, kind: 'agent', displayName: 'Athena' })
      .returning({ id: schema.actor.id });
    const [ag] = await db
      .insert(schema.agent)
      .values({ organizationId: org.orgId, actorId: agentActor!.id, createdBy: org.humanActorId })
      .returning({ id: schema.agent.id });
    const [approvalTask] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Needs approval',
        teamId: org.teamId,
        state: 'todo',
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    await db.insert(schema.agentSession).values({
      organizationId: org.orgId,
      agentId: ag!.id,
      taskId: approvalTask!.id,
      trigger: 'assignment',
      status: 'awaiting_approval',
      initiatorId: org.humanActorId,
    });

    // A blocked task assigned to the caller (blocking task is incomplete).
    const [blockingTask] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Blocker',
        teamId: org.teamId,
        state: 'todo',
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    const [blockedTask] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Blocked mine',
        teamId: org.teamId,
        state: 'todo',
        assigneeId: myActorId,
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    await db.insert(schema.taskDependency).values({
      organizationId: org.orgId,
      blockingTaskId: blockingTask!.id,
      blockedTaskId: blockedTask!.id,
    });

    // Two notifications, one unread → inbox count = 1.
    await db
      .insert(schema.notification)
      .values({ userId, organizationId: org.orgId, type: 'mention', body: { title: 'unread' } });
    await db.insert(schema.notification).values({
      userId,
      organizationId: org.orgId,
      type: 'mention',
      body: { title: 'read' },
      readAt: new Date(),
    });

    const app = appWithSession(hub, fakeSession(userId));
    const today = await body<{
      date: string;
      plan: { id: string }[];
      calendar: { taskId: string; startsAt: string }[];
      needsAttention: {
        approvals: { id: string }[];
        blocked: { id: string }[];
        dueToday: { id: string }[];
        inbox: number;
      };
    }>(await app.request(`/today?date=${date}`));

    expect(today.date).toBe(date);
    expect(today.plan.map((t) => t.id)).toEqual(expect.arrayContaining([planned!.id, due!.id]));
    expect(today.calendar.some((b) => b.taskId === planned!.id)).toBe(true);
    expect(today.needsAttention.approvals.map((t) => t.id)).toContain(approvalTask!.id);
    expect(today.needsAttention.blocked.map((t) => t.id)).toContain(blockedTask!.id);
    expect(today.needsAttention.dueToday.map((t) => t.id)).toEqual(
      expect.arrayContaining([due!.id, planned!.id]),
    );
    expect(today.needsAttention.inbox).toBe(1);
  });

  it('a completed blocker does not mark the dependent task as blocked', async () => {
    const { userId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    const myActorId = await joinOrg(userId, org.orgId);

    const [blocker] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Done blocker',
        teamId: org.teamId,
        state: 'done',
        completedAt: new Date(),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    const [dependent] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Now free',
        teamId: org.teamId,
        state: 'todo',
        assigneeId: myActorId,
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    await db.insert(schema.taskDependency).values({
      organizationId: org.orgId,
      blockingTaskId: blocker!.id,
      blockedTaskId: dependent!.id,
    });

    const app = appWithSession(hub, fakeSession(userId));
    const today = await body<{ needsAttention: { blocked: { id: string }[] } }>(
      await app.request('/today?date=2026-08-02'),
    );
    expect(today.needsAttention.blocked.map((t) => t.id)).not.toContain(dependent!.id);
  });

  it('rejects a malformed date (422)', async () => {
    const { userId } = await seedUserWithHub();
    const app = appWithSession(hub, fakeSession(userId));
    expect((await app.request('/today?date=not-a-date')).status).toBe(422);
  });
});

describe('hub /portfolio (org swimlanes → program lanes → project bars)', () => {
  it('builds swimlanes with program lanes, unassigned bars, and milestone diamonds', async () => {
    const { userId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinOrg(userId, org.orgId);

    const [prog] = await db
      .insert(schema.program)
      .values({
        organizationId: org.orgId,
        name: 'Customer Success',
        status: 'active',
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.program.id });

    const [inProgram] = await db
      .insert(schema.project)
      .values({
        organizationId: org.orgId,
        name: 'Onboarding',
        teamId: org.teamId,
        programId: prog!.id,
        status: 'active',
        startDate: new Date('2026-09-01'),
        targetDate: new Date('2026-10-01'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.project.id });

    // A project with no program → swimlane.unassigned.
    const [unassigned] = await db
      .insert(schema.project)
      .values({
        organizationId: org.orgId,
        name: 'Standalone',
        teamId: org.teamId,
        status: 'planned',
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.project.id });

    // A completed project is excluded (not in flight).
    await db.insert(schema.project).values({
      organizationId: org.orgId,
      name: 'Old Done',
      teamId: org.teamId,
      status: 'completed',
      createdBy: org.humanActorId,
    });

    // A milestone diamond on the in-program project.
    await db.insert(schema.milestone).values({
      organizationId: org.orgId,
      projectId: inProgram!.id,
      name: 'Beta',
      targetDate: new Date('2026-09-20'),
    });

    const app = appWithSession(hub, fakeSession(userId));
    const portfolio = await body<{
      swimlanes: {
        organization: { id: string; name: string; slug: string };
        programs: {
          program: { id: string };
          projects: { id: string; name: string; milestones: { name: string }[] }[];
        }[];
        unassigned: { id: string; name: string }[];
      }[];
    }>(await app.request('/portfolio'));

    const lane = portfolio.swimlanes.find((s) => s.organization.id === org.orgId);
    expect(lane).toBeDefined();
    expect(lane!.organization.slug).toBeTruthy();

    const programLane = lane!.programs.find((p) => p.program.id === prog!.id);
    expect(programLane).toBeDefined();
    const bar = programLane!.projects.find((p) => p.id === inProgram!.id);
    expect(bar).toBeDefined();
    expect(bar!.milestones.map((m) => m.name)).toContain('Beta');

    expect(lane!.unassigned.map((p) => p.id)).toContain(unassigned!.id);
    // The completed project is not anywhere in the lane.
    const allProjectNames = [
      ...lane!.unassigned.map((p) => p.name),
      ...lane!.programs.flatMap((pl) => pl.projects.map((p) => p.name)),
    ];
    expect(allProjectNames).not.toContain('Old Done');
  });

  it('the from/to window excludes projects entirely outside the range', async () => {
    const { userId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinOrg(userId, org.orgId);

    // A project that ends before the window opens.
    await db.insert(schema.project).values({
      organizationId: org.orgId,
      name: 'PastProject',
      teamId: org.teamId,
      status: 'active',
      startDate: new Date('2025-01-01'),
      targetDate: new Date('2025-02-01'),
      createdBy: org.humanActorId,
    });
    // A project inside the window.
    await db.insert(schema.project).values({
      organizationId: org.orgId,
      name: 'CurrentProject',
      teamId: org.teamId,
      status: 'active',
      startDate: new Date('2026-09-01'),
      targetDate: new Date('2026-10-01'),
      createdBy: org.humanActorId,
    });

    const app = appWithSession(hub, fakeSession(userId));
    const portfolio = await body<{
      swimlanes: { organization: { id: string }; unassigned: { id: string; name: string }[] }[];
    }>(await app.request('/portfolio?from=2026-08-01&to=2026-12-01'));
    const lane = portfolio.swimlanes.find((s) => s.organization.id === org.orgId);
    const names = lane?.unassigned.map((p) => p.name) ?? [];
    expect(names).toContain('CurrentProject');
    expect(names).not.toContain('PastProject');
  });

  it('tenant isolation: a foreign org never appears as a swimlane', async () => {
    const { userId } = await seedUserWithHub();
    const mine = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    await joinOrg(userId, mine.orgId);
    await db.insert(schema.project).values({
      organizationId: foreign.orgId,
      name: 'Hidden',
      teamId: foreign.teamId,
      status: 'active',
      createdBy: foreign.humanActorId,
    });
    const app = appWithSession(hub, fakeSession(userId));
    const portfolio = await body<{ swimlanes: { organization: { id: string } }[] }>(
      await app.request('/portfolio'),
    );
    expect(portfolio.swimlanes.every((s) => s.organization.id !== foreign.orgId)).toBe(true);
  });
});

describe('hub /search (cross-org typed hits)', () => {
  it('returns org-chipped task/project/program hits and honors the limit', async () => {
    const { userId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinOrg(userId, org.orgId);

    await db.insert(schema.task).values({
      organizationId: org.orgId,
      title: 'Zephyr Task',
      teamId: org.teamId,
      state: 'todo',
      createdBy: org.humanActorId,
    });
    await db.insert(schema.project).values({
      organizationId: org.orgId,
      name: 'Zephyr Project',
      teamId: org.teamId,
      status: 'active',
      createdBy: org.humanActorId,
    });
    await db.insert(schema.program).values({
      organizationId: org.orgId,
      name: 'Zephyr Program',
      status: 'active',
      createdBy: org.humanActorId,
    });

    const app = appWithSession(hub, fakeSession(userId));
    const search = await body<{
      query: string;
      results: { organizationId: string; type: string; id: string; title: string }[];
    }>(await app.request('/search?q=Zephyr'));
    expect(search.query).toBe('Zephyr');
    const types = new Set(search.results.map((r) => r.type));
    expect(types.has('task')).toBe(true);
    expect(types.has('project')).toBe(true);
    expect(types.has('program')).toBe(true);
    expect(search.results.every((r) => r.organizationId === org.orgId)).toBe(true);

    // A tiny limit caps the merged result set.
    const limited = await body<{ results: unknown[] }>(
      await app.request('/search?q=Zephyr&limit=1'),
    );
    expect(limited.results).toHaveLength(1);
  });

  it('tenant isolation: never matches entities in a non-member org', async () => {
    const { userId } = await seedUserWithHub();
    const mine = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    await joinOrg(userId, mine.orgId);
    await db.insert(schema.task).values({
      organizationId: foreign.orgId,
      title: 'Quasar Secret',
      teamId: foreign.teamId,
      state: 'todo',
      createdBy: foreign.humanActorId,
    });
    const app = appWithSession(hub, fakeSession(userId));
    const search = await body<{ results: unknown[] }>(await app.request('/search?q=Quasar'));
    expect(search.results).toHaveLength(0);
  });

  it('rejects an empty query (422)', async () => {
    const { userId } = await seedUserWithHub();
    const app = appWithSession(hub, fakeSession(userId));
    expect((await app.request('/search?q=')).status).toBe(422);
  });

  it('a deactivated membership row is excluded from search scope', async () => {
    const { userId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinOrg(userId, org.orgId, 'suspended');
    await db.insert(schema.task).values({
      organizationId: org.orgId,
      title: 'Nebula Item',
      teamId: org.teamId,
      state: 'todo',
      createdBy: org.humanActorId,
    });
    const app = appWithSession(hub, fakeSession(userId));
    const search = await body<{ results: unknown[] }>(await app.request('/search?q=Nebula'));
    expect(search.results).toHaveLength(0);
  });
});
