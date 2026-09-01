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
import { ProcessDefinitionId } from '@docket/work/ids';
import { TeamId } from '@docket/identity-access/ids';
import { type ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { eq } from 'drizzle-orm';

import { appWithSession, fakeSession, getDb, seedBaseOrg } from '../support/routes-harness';
import type hubRouter from '../../src/routes/hub';
import { assertDefined } from '@docket/test-utils';
import { materializeOccurrence } from '../../src/lib/recurrence/materialize';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import { createRecurrenceSeries } from '../../src/lib/recurrence/series';

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

/**
 * The next Monday (`YYYY-MM-DD`, UTC), never today.
 *
 * @remarks
 * `selectMomentum`'s capacity check needs a day with real desk-hours to draw on — the default
 * availability model (`defaultAvailabilityWindows`) protects Saturday evenings and all of Sunday,
 * so a target day computed as merely "tomorrow" intermittently landed on a day with zero
 * suggestable capacity, one day in seven. It also has to stay strictly in the future: capacity
 * is clipped to spans that have not yet ended relative to the real clock, so a past date always
 * reads as zero capacity too.
 */
function nextMonday(): string {
  const now = new Date();
  const daysUntilMonday = (1 - now.getUTCDay() + 7) % 7 || 7;
  return new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

/** Insert a user + its hub; returns ids. */
async function seedUserWithHub(): Promise<{ userId: string; hubId: string }> {
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `hub-${Math.random().toString(36).slice(2)}@e.com` })
    .returning({ id: schema.user.id });
  const [h] = await db
    .insert(schema.hub)
    .values({ userId: assertDefined(user).id })
    .returning({ id: schema.hub.id });
  return { userId: assertDefined(user).id, hubId: assertDefined(h).id };
}

/** Make `userId` an active human Actor in `orgId`; returns the actor id. */
async function joinOrg(
  userId: string,
  orgId: string,
  status: 'active' | 'suspended' = 'active',
  roleId: string | null = null,
) {
  const [a] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId, status, roleId })
    .returning({ id: schema.actor.id });
  return assertDefined(a).id;
}

/** Join through a role that matches the normal Member write capability. */
async function joinContributingOrg(userId: string, orgId: string): Promise<string> {
  const [memberRole] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: `member-${Math.random().toString(36).slice(2)}`,
      name: `Member ${Math.random().toString(36).slice(2)}`,
      capabilities: ['contribute'],
    })
    .returning({ id: schema.role.id });
  return joinOrg(userId, orgId, 'active', assertDefined(memberRole).id);
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
        subjectType: 'organization',
        subjectId: a.orgId,
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

describe('hub /today (daily operating projection)', () => {
  it('separates accepted plan work from attention and grounds focus in larger work', async () => {
    const { userId, hubId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    const myActorId = await joinOrg(userId, org.orgId);
    const date = nextMonday();

    // dueToday task.
    const [due] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Due today',
        teamId: org.teamId,
        state: 'todo',
        statusId: org.statusId('task', 'todo'),
        assigneeId: myActorId,
        estimateMinutes: 20,
        dueDate: new Date(date),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });

    const [initiative] = await db
      .insert(schema.initiative)
      .values({
        organizationId: org.orgId,
        name: 'Reliable launch',
        status: 'active',
        statusId: org.statusId('initiative', 'active'),
        health: 'on_track',
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.initiative.id });
    const [project] = await db
      .insert(schema.project)
      .values({
        organizationId: org.orgId,
        name: 'Ship Today',
        teamId: org.teamId,
        status: 'active',
        statusId: org.statusId('project', 'active'),
        health: 'at_risk',
        targetDate: new Date('2026-08-03T00:00:00.000Z'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.project.id });
    await db.insert(schema.initiativeProject).values({
      organizationId: org.orgId,
      initiativeId: assertDefined(initiative).id,
      projectId: assertDefined(project).id,
    });
    await db.insert(schema.update).values({
      organizationId: org.orgId,
      subjectType: 'project',
      subjectId: assertDefined(project).id,
      body: 'Final review is underway.',
      health: 'at_risk',
      createdBy: org.humanActorId,
    });
    await db.insert(schema.milestone).values({
      organizationId: org.orgId,
      projectId: assertDefined(project).id,
      name: 'Launch',
      targetDate: new Date('2026-08-02T00:00:00.000Z'),
      createdBy: org.humanActorId,
    });

    // A planned task that is also due on the date and carries a current timebox.
    const [planned] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Planned',
        teamId: org.teamId,
        state: 'todo',
        statusId: org.statusId('task', 'todo'),
        projectId: assertDefined(project).id,
        assigneeId: myActorId,
        estimateMinutes: 45,
        dueDate: new Date(date),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    await db.insert(schema.dailyPlanItem).values({
      hubId,
      refOrganizationId: org.orgId,
      refTaskId: assertDefined(planned).id,
      date,
      timeboxStartsAt: new Date(`${date}T09:00:00.000Z`),
      timeboxEndsAt: new Date(`${date}T10:00:00.000Z`),
    });
    await db.insert(schema.task).values({
      organizationId: org.orgId,
      title: 'Already shipped',
      teamId: org.teamId,
      state: 'done',
      statusId: org.statusId('task', 'done'),
      projectId: assertDefined(project).id,
      completedAt: new Date(),
      createdBy: org.humanActorId,
    });

    // An agent session awaiting approval, tied to a task → approvals.
    const [agentActor] = await db
      .insert(schema.actor)
      .values({ organizationId: org.orgId, kind: 'agent', displayName: 'Athena' })
      .returning({ id: schema.actor.id });
    const [ag] = await db
      .insert(schema.agent)
      .values({
        organizationId: org.orgId,
        actorId: assertDefined(agentActor).id,
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.agent.id });
    const [approvalTask] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Needs approval',
        teamId: org.teamId,
        state: 'todo',
        statusId: org.statusId('task', 'todo'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    await db.insert(schema.agentSession).values({
      organizationId: org.orgId,
      agentId: assertDefined(ag).id,
      taskId: assertDefined(approvalTask).id,
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
        statusId: org.statusId('task', 'todo'),
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
        statusId: org.statusId('task', 'todo'),
        assigneeId: myActorId,
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    await db.insert(schema.taskDependency).values({
      organizationId: org.orgId,
      blockingTaskId: assertDefined(blockingTask).id,
      blockedTaskId: assertDefined(blockedTask).id,
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
      planState: string;
      brief: { text: string; attentionCount: number };
      plan: { id: string; planItemId: string; reason: string }[];
      focus: { now: { id: string } | null; after: { id: string } | null };
      statusCards: { id: string; kind: string; latestUpdate: { excerpt: string } | null }[];
      suggestions: { id: string }[];
      calendar: { taskId: string; startsAt: string }[];
      needsAttention: {
        approvals: { id: string }[];
        blocked: { id: string }[];
        dueToday: { id: string }[];
        inbox: number;
      };
    }>(await app.request(`/today?date=${date}`));

    expect(today.date).toBe(date);
    expect(today.planState).toBe('active');
    expect(today.plan.map((t) => t.id)).toEqual([assertDefined(planned).id]);
    expect(today.focus.now?.id).toBe(assertDefined(planned).id);
    expect(today.focus.after).toBeNull();
    expect(today.statusCards.map((card) => card.id)).toEqual(
      expect.arrayContaining([assertDefined(project).id, assertDefined(initiative).id]),
    );
    expect(
      today.statusCards.find((card) => card.id === assertDefined(project).id)?.latestUpdate
        ?.excerpt,
    ).toContain('Final review');
    expect(today.suggestions.map((task) => task.id)).toContain(assertDefined(due).id);
    expect(today.calendar.some((b) => b.taskId === assertDefined(planned).id)).toBe(true);
    expect(today.needsAttention.approvals.map((t) => t.id)).toContain(
      assertDefined(approvalTask).id,
    );
    expect(today.needsAttention.blocked.map((t) => t.id)).toContain(assertDefined(blockedTask).id);
    expect(today.needsAttention.dueToday.map((t) => t.id)).toEqual(
      expect.arrayContaining([assertDefined(due).id, assertDefined(planned).id]),
    );
    expect(today.needsAttention.inbox).toBe(1);
    expect(today.brief.attentionCount).toBeGreaterThan(0);
  });

  it('filters private tasks and larger work with the shared resource resolver', async () => {
    const { userId, hubId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinOrg(userId, org.orgId);
    const date = '2026-08-04';

    const [privateProject] = await db
      .insert(schema.project)
      .values({
        organizationId: org.orgId,
        name: 'Private project',
        teamId: org.teamId,
        status: 'active',
        statusId: org.statusId('project', 'active'),
        visibility: 'private',
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.project.id });
    const [visibleTask] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Visible task',
        teamId: org.teamId,
        state: 'todo',
        statusId: org.statusId('task', 'todo'),
        projectId: assertDefined(privateProject).id,
        visibility: 'public',
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    const [privateTask] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Private task',
        teamId: org.teamId,
        state: 'todo',
        statusId: org.statusId('task', 'todo'),
        visibility: 'private',
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    await db.insert(schema.dailyPlanItem).values([
      {
        hubId,
        refOrganizationId: org.orgId,
        refTaskId: assertDefined(visibleTask).id,
        date,
        sort: 0,
      },
      {
        hubId,
        refOrganizationId: org.orgId,
        refTaskId: assertDefined(privateTask).id,
        date,
        sort: 1,
      },
    ]);

    const app = appWithSession(hub, fakeSession(userId));
    const today = await body<{
      plan: { id: string }[];
      focus: { now: { id: string } | null };
      statusCards: { id: string }[];
      suggestions: { id: string }[];
    }>(await app.request(`/today?date=${date}`));

    expect(today.plan.map((item) => item.id)).toEqual([assertDefined(visibleTask).id]);
    expect(today.focus.now?.id).toBe(assertDefined(visibleTask).id);
    expect(today.statusCards.map((card) => card.id)).not.toContain(
      assertDefined(privateProject).id,
    );
    expect(today.suggestions.map((item) => item.id)).not.toContain(assertDefined(privateTask).id);
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
        statusId: org.statusId('task', 'done'),
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
        statusId: org.statusId('task', 'todo'),
        assigneeId: myActorId,
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    await db.insert(schema.taskDependency).values({
      organizationId: org.orgId,
      blockingTaskId: assertDefined(blocker).id,
      blockedTaskId: assertDefined(dependent).id,
    });

    const app = appWithSession(hub, fakeSession(userId));
    const today = await body<{ needsAttention: { blocked: { id: string }[] } }>(
      await app.request('/today?date=2026-08-02'),
    );
    expect(today.needsAttention.blocked.map((t) => t.id)).not.toContain(
      assertDefined(dependent).id,
    );
  });

  it('rejects a malformed date (422)', async () => {
    const { userId } = await seedUserWithHub();
    const app = appWithSession(hub, fakeSession(userId));
    expect((await app.request('/today?date=not-a-date')).status).toBe(422);
  });

  it('normalizes tied plan sort values into one honest Now and After sequence', async () => {
    const { userId, hubId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinOrg(userId, org.orgId);
    const date = '2026-08-06';
    const work = await db
      .insert(schema.task)
      .values([
        {
          organizationId: org.orgId,
          title: 'First accepted task',
          teamId: org.teamId,
          state: 'todo',
          statusId: org.statusId('task', 'todo'),
          createdBy: org.humanActorId,
        },
        {
          organizationId: org.orgId,
          title: 'Second accepted task',
          teamId: org.teamId,
          state: 'todo',
          statusId: org.statusId('task', 'todo'),
          createdBy: org.humanActorId,
        },
      ])
      .returning({ id: schema.task.id });
    await db.insert(schema.dailyPlanItem).values(
      work.map((item) => ({
        hubId,
        refOrganizationId: org.orgId,
        refTaskId: item.id,
        date,
        sort: 0,
      })),
    );

    const app = appWithSession(hub, fakeSession(userId));
    const today = await body<{
      plan: { id: string; position: number; reason: string }[];
      focus: {
        now: { id: string; reason: string } | null;
        after: { id: string; reason: string } | null;
      };
    }>(await app.request(`/today?date=${date}`));

    expect(today.plan.map((item) => item.position)).toEqual([0, 1]);
    expect(today.focus.now?.reason).toBeNull();
    expect(today.focus.after?.reason).toBeNull();
  });

  it('treats work completed outside Today as cleared instead of offering it as Now', async () => {
    const { userId, hubId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinOrg(userId, org.orgId);
    const date = '2026-08-06';
    const [work] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Already finished elsewhere',
        teamId: org.teamId,
        state: 'done',
        statusId: org.statusId('task', 'done'),
        completedAt: new Date(),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    await db.insert(schema.dailyPlanItem).values({
      hubId,
      refOrganizationId: org.orgId,
      refTaskId: assertDefined(work).id,
      date,
      status: 'planned',
    });

    const app = appWithSession(hub, fakeSession(userId));
    const today = await body<{
      planState: string;
      plan: { planStatus: string }[];
      focus: { now: { id: string } | null; after: { id: string } | null };
    }>(await app.request(`/today?date=${date}`));

    expect(today.planState).toBe('cleared');
    expect(today.plan[0]?.planStatus).toBe('done');
    expect(today.focus).toEqual({ now: null, after: null });
  });

  it('completes the real task workflow and personal plan row together', async () => {
    const { userId, hubId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinContributingOrg(userId, org.orgId);
    const [work] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Finish this',
        teamId: org.teamId,
        state: 'todo',
        statusId: org.statusId('task', 'todo'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    const [planItem] = await db
      .insert(schema.dailyPlanItem)
      .values({
        hubId,
        refOrganizationId: org.orgId,
        refTaskId: assertDefined(work).id,
        date: '2026-08-05',
      })
      .returning({ id: schema.dailyPlanItem.id });

    const app = appWithSession(hub, fakeSession(userId));
    const response = await app.request(`/today/items/${assertDefined(planItem).id}/complete`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);

    const [taskAfter] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(work).id));
    const [planAfter] = await db
      .select()
      .from(schema.dailyPlanItem)
      .where(eq(schema.dailyPlanItem.id, assertDefined(planItem).id));
    const auditRows = await db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.subjectId, assertDefined(work).id));
    expect(taskAfter?.state).toBe('done');
    expect(taskAfter?.completedAt).toBeInstanceOf(Date);
    expect(planAfter?.status).toBe('done');
    expect(auditRows).toEqual([
      expect.objectContaining({
        actorId: expect.any(String),
        subjectType: 'task',
        type: 'updated',
        metadata: expect.objectContaining({ field: 'state', from: 'Todo', to: 'Done' }),
      }),
    ]);
  });

  it.each([
    ['free', null, 'product_required'],
    ['canceled', 'canceled', 'product_required'],
    ['expired grace', 'past_due', 'billing_grace_expired'],
  ] as const)(
    'keeps a shared %s workspace readable but refuses Today completion',
    async (_label, status, expectedCode) => {
      const { userId, hubId } = await seedUserWithHub();
      const org = await seedBaseOrg(db, schema, false);
      await joinContributingOrg(userId, org.orgId);
      if (status !== null) {
        await db.insert(schema.organizationProductEntitlement).values({
          organizationId: org.orgId,
          productKey: 'docket_pro',
          status,
          source: 'stripe',
          ...(status === 'past_due' ? { graceEndsAt: new Date('2000-01-01T00:00:00.000Z') } : {}),
        });
      }
      const [work] = await db
        .insert(schema.task)
        .values({
          organizationId: org.orgId,
          title: 'Read only work',
          teamId: org.teamId,
          state: 'todo',
          statusId: org.statusId('task', 'todo'),
          createdBy: org.humanActorId,
        })
        .returning({ id: schema.task.id });
      const [planItem] = await db
        .insert(schema.dailyPlanItem)
        .values({
          hubId,
          refOrganizationId: org.orgId,
          refTaskId: assertDefined(work).id,
          date: '2026-08-05',
        })
        .returning({ id: schema.dailyPlanItem.id });

      const app = appWithSession(hub, fakeSession(userId));
      const response = await app.request(`/today/items/${assertDefined(planItem).id}/complete`, {
        method: 'POST',
      });

      expect(response.status).toBe(402);
      expect(await body<{ code: string }>(response)).toMatchObject({ code: expectedCode });
      expect(
        (
          await db
            .select({ state: schema.task.state })
            .from(schema.task)
            .where(eq(schema.task.id, assertDefined(work).id))
        )[0]?.state,
      ).toBe('todo');
      expect(
        (
          await db
            .select({ status: schema.dailyPlanItem.status })
            .from(schema.dailyPlanItem)
            .where(eq(schema.dailyPlanItem.id, assertDefined(planItem).id))
        )[0]?.status,
      ).toBe('planned');
    },
  );

  it('keeps Today completion writable in a free personal workspace', async () => {
    const { userId, hubId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema, false);
    await db
      .update(schema.organization)
      .set({ isPersonal: true })
      .where(eq(schema.organization.id, org.orgId));
    await joinContributingOrg(userId, org.orgId);
    const [work] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Personal work',
        teamId: org.teamId,
        state: 'todo',
        statusId: org.statusId('task', 'todo'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    const [planItem] = await db
      .insert(schema.dailyPlanItem)
      .values({
        hubId,
        refOrganizationId: org.orgId,
        refTaskId: assertDefined(work).id,
        date: '2026-08-05',
      })
      .returning({ id: schema.dailyPlanItem.id });

    const app = appWithSession(hub, fakeSession(userId));
    expect(
      (await app.request(`/today/items/${assertDefined(planItem).id}/complete`, { method: 'POST' }))
        .status,
    ).toBe(200);
  });

  it('advances completion-driven process work when Today completes a generated task', async () => {
    const { userId, hubId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinContributingOrg(userId, org.orgId);
    const definition: ProcessDefinitionCreate = {
      name: 'Today process advancement',
      creationMode: 'when_ready',
      milestones: [],
      tasks: [
        {
          key: 'first',
          title: 'Complete from Today',
          teamId: TeamId.parse(org.teamId),
          priority: 'none',
          labelIds: [],
          timing: { kind: 'on_trigger' },
        },
        {
          key: 'follow-up',
          title: 'Released follow-up',
          teamId: TeamId.parse(org.teamId),
          priority: 'none',
          labelIds: [],
          timing: { kind: 'after_step_completion', stepKey: 'first', offsetDays: 1 },
        },
      ],
      dependencies: [{ blockingStepKey: 'first', blockedStepKey: 'follow-up' }],
    };
    const authored = await createPublishedProcessDefinition(db, {
      organizationId: org.orgId,
      actorId: org.humanActorId,
      definition,
    });
    const series = await createRecurrenceSeries(db, {
      organizationId: org.orgId,
      actorId: org.humanActorId,
      series: {
        processDefinitionId: ProcessDefinitionId.parse(authored.definitionId),
        name: definition.name,
        trigger: {
          kind: 'calendar',
          schedule: {
            kind: 'daily',
            interval: 1,
            startDate: '2026-08-05',
            timezone: 'America/Los_Angeles',
            end: { kind: 'after_count', count: 2 },
          },
          missedPolicy: 'skip',
          materialization: { horizonDays: 2, minimumOccurrences: 1 },
        },
      },
    });
    const [revision] = await db
      .select({ id: schema.recurrenceSeriesRevision.id })
      .from(schema.recurrenceSeriesRevision)
      .where(eq(schema.recurrenceSeriesRevision.seriesId, series.id));
    const occurrence = await materializeOccurrence(db, {
      organizationId: org.orgId,
      actorId: org.humanActorId,
      seriesId: series.id,
      seriesRevisionId: assertDefined(revision).id,
      scheduledFor: '2026-08-05',
    });
    const [planItem] = await db
      .insert(schema.dailyPlanItem)
      .values({
        hubId,
        refOrganizationId: org.orgId,
        refTaskId: assertDefined(occurrence.taskIdsByKey['first']),
        date: '2026-08-05',
      })
      .returning({ id: schema.dailyPlanItem.id });

    const app = appWithSession(hub, fakeSession(userId));
    const response = await app.request(`/today/items/${assertDefined(planItem).id}/complete`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);

    const instanceTasks = await db
      .select({ title: schema.task.title })
      .from(schema.processInstanceTask)
      .innerJoin(schema.task, eq(schema.task.id, schema.processInstanceTask.taskId))
      .where(eq(schema.processInstanceTask.instanceId, occurrence.instanceId));
    expect(instanceTasks.map((row) => row.title).sort()).toEqual([
      'Complete from Today',
      'Released follow-up',
    ]);
  });

  it('cannot complete another user plan row, and completing your own lands in the workspace’s Done', async () => {
    const owner = await seedUserWithHub();
    const caller = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinContributingOrg(owner.userId, org.orgId);
    await joinOrg(caller.userId, org.orgId);
    const [work] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Owner task',
        teamId: org.teamId,
        state: 'todo',
        statusId: org.statusId('task', 'todo'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    const [planItem] = await db
      .insert(schema.dailyPlanItem)
      .values({
        hubId: owner.hubId,
        refOrganizationId: org.orgId,
        refTaskId: assertDefined(work).id,
        date: '2026-08-05',
      })
      .returning({ id: schema.dailyPlanItem.id });

    const app = appWithSession(hub, fakeSession(caller.userId));
    expect(
      (await app.request(`/today/items/${assertDefined(planItem).id}/complete`, { method: 'POST' }))
        .status,
    ).toBe(404);

    // This test used to end by stripping the team's completed workflow state and asserting a 409.
    // That scenario is now unreachable: a status set is required to keep a way to finish work, and
    // the route that would remove the last one refuses (see `tests/routes/work-statuses.test.ts`).
    // What is worth pinning here instead is the other half of that guarantee — the owner's own
    // completion succeeds, and it lands on the workspace's completed status.
    const ownerApp = appWithSession(hub, fakeSession(owner.userId));
    expect(
      (
        await ownerApp.request(`/today/items/${assertDefined(planItem).id}/complete`, {
          method: 'POST',
        })
      ).status,
    ).toBe(200);

    const [taskAfter] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(work).id));
    const [planAfter] = await db
      .select()
      .from(schema.dailyPlanItem)
      .where(eq(schema.dailyPlanItem.id, assertDefined(planItem).id));
    expect(taskAfter?.statusId).toBe(org.statusId('task', 'done'));
    expect(taskAfter?.completedAt).not.toBeNull();
    expect(planAfter?.status).toBe('done');
  });

  it('requires contribute capability to complete a visible task from a personal plan', async () => {
    const { userId, hubId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    const [viewerRole] = await db
      .insert(schema.role)
      .values({
        organizationId: org.orgId,
        key: `viewer-${Math.random().toString(36).slice(2)}`,
        name: 'Viewer',
        capabilities: ['view'],
      })
      .returning({ id: schema.role.id });
    await joinOrg(userId, org.orgId, 'active', assertDefined(viewerRole).id);
    const [work] = await db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        title: 'Visible but not editable',
        teamId: org.teamId,
        state: 'todo',
        statusId: org.statusId('task', 'todo'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.task.id });
    const [planItem] = await db
      .insert(schema.dailyPlanItem)
      .values({
        hubId,
        refOrganizationId: org.orgId,
        refTaskId: assertDefined(work).id,
        date: '2026-08-07',
      })
      .returning({ id: schema.dailyPlanItem.id });

    const app = appWithSession(hub, fakeSession(userId));
    expect(
      (await app.request(`/today/items/${assertDefined(planItem).id}/complete`, { method: 'POST' }))
        .status,
    ).toBe(403);

    const [taskAfter] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(work).id));
    const [planAfter] = await db
      .select()
      .from(schema.dailyPlanItem)
      .where(eq(schema.dailyPlanItem.id, assertDefined(planItem).id));
    expect(taskAfter?.state).toBe('todo');
    expect(planAfter?.status).toBe('planned');
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
        statusId: org.statusId('program', 'active'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.program.id });

    const [inProgram] = await db
      .insert(schema.project)
      .values({
        organizationId: org.orgId,
        name: 'Onboarding',
        teamId: org.teamId,
        programId: assertDefined(prog).id,
        status: 'active',
        statusId: org.statusId('project', 'active'),
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
        statusId: org.statusId('project', 'planned'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.project.id });

    // A completed project is excluded (not in flight).
    await db.insert(schema.project).values({
      organizationId: org.orgId,
      name: 'Old Done',
      teamId: org.teamId,
      status: 'completed',
      statusId: org.statusId('project', 'completed'),
      createdBy: org.humanActorId,
    });

    // A milestone diamond on the in-program project.
    await db.insert(schema.milestone).values({
      organizationId: org.orgId,
      projectId: assertDefined(inProgram).id,
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
    expect(assertDefined(lane).organization.slug).toBeTruthy();

    const programLane = assertDefined(lane).programs.find(
      (p) => p.program.id === assertDefined(prog).id,
    );
    expect(programLane).toBeDefined();
    const bar = assertDefined(programLane).projects.find(
      (p) => p.id === assertDefined(inProgram).id,
    );
    expect(bar).toBeDefined();
    expect(assertDefined(bar).milestones.map((m) => m.name)).toContain('Beta');

    expect(assertDefined(lane).unassigned.map((p) => p.id)).toContain(assertDefined(unassigned).id);
    // The completed project is not anywhere in the lane.
    const allProjectNames = [
      ...assertDefined(lane).unassigned.map((p) => p.name),
      ...assertDefined(lane).programs.flatMap((pl) => pl.projects.map((p) => p.name)),
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
      statusId: org.statusId('project', 'active'),
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
      statusId: org.statusId('project', 'active'),
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
      statusId: foreign.statusId('project', 'active'),
      createdBy: foreign.humanActorId,
    });
    const app = appWithSession(hub, fakeSession(userId));
    const portfolio = await body<{ swimlanes: { organization: { id: string } }[] }>(
      await app.request('/portfolio'),
    );
    expect(portfolio.swimlanes.every((s) => s.organization.id !== foreign.orgId)).toBe(true);
  });

  it('the initiativeId chip filters swimlanes to the initiative’s associated programs/projects', async () => {
    const { userId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinOrg(userId, org.orgId);

    // An initiative the user filters by, plus a program + two projects.
    const [init] = await db
      .insert(schema.initiative)
      .values({
        organizationId: org.orgId,
        name: 'Q3 Push',
        status: 'active',
        statusId: org.statusId('initiative', 'active'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.initiative.id });

    const [linkedProgram] = await db
      .insert(schema.program)
      .values({
        organizationId: org.orgId,
        name: 'Linked Prog',
        status: 'active',
        statusId: org.statusId('program', 'active'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.program.id });
    const [otherProgram] = await db
      .insert(schema.program)
      .values({
        organizationId: org.orgId,
        name: 'Other Prog',
        status: 'active',
        statusId: org.statusId('program', 'active'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.program.id });

    const [linkedProject] = await db
      .insert(schema.project)
      .values({
        organizationId: org.orgId,
        name: 'Linked Proj',
        teamId: org.teamId,
        status: 'active',
        statusId: org.statusId('project', 'active'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.project.id });
    const [unlinkedProject] = await db
      .insert(schema.project)
      .values({
        organizationId: org.orgId,
        name: 'Unlinked Proj',
        teamId: org.teamId,
        status: 'active',
        statusId: org.statusId('project', 'active'),
        createdBy: org.humanActorId,
      })
      .returning({ id: schema.project.id });

    // Associate ONLY linkedProgram + linkedProject with the initiative.
    await db.insert(schema.initiativeProgram).values({
      initiativeId: assertDefined(init).id,
      programId: assertDefined(linkedProgram).id,
      organizationId: org.orgId,
    });
    await db.insert(schema.initiativeProject).values({
      initiativeId: assertDefined(init).id,
      projectId: assertDefined(linkedProject).id,
      organizationId: org.orgId,
    });

    const app = appWithSession(hub, fakeSession(userId));
    const filtered = await body<{
      swimlanes: {
        organization: { id: string };
        programs: { program: { id: string } }[];
        unassigned: { id: string }[];
      }[];
    }>(await app.request(`/portfolio?initiativeId=${assertDefined(init).id}`));

    const lane = assertDefined(filtered.swimlanes.find((s) => s.organization.id === org.orgId));
    expect(lane).toBeDefined();
    // Only the linked program lane is present.
    expect(lane.programs.map((p) => p.program.id)).toEqual([assertDefined(linkedProgram).id]);
    // Only the linked project appears in the unassigned bucket (it has no programId).
    expect(lane.unassigned.map((p) => p.id)).toEqual([assertDefined(linkedProject).id]);
    expect(lane.unassigned.map((p) => p.id)).not.toContain(assertDefined(unlinkedProject).id);

    // Without the chip, BOTH programs and projects show.
    const unfiltered = await body<{
      swimlanes: {
        organization: { id: string };
        programs: { program: { id: string } }[];
        unassigned: { id: string }[];
      }[];
    }>(await app.request('/portfolio'));
    const fullLane = assertDefined(
      unfiltered.swimlanes.find((s) => s.organization.id === org.orgId),
    );
    expect(fullLane.programs.map((p) => p.program.id).sort()).toEqual(
      [assertDefined(linkedProgram).id, assertDefined(otherProgram).id].sort(),
    );
    expect(fullLane.unassigned.map((p) => p.id).sort()).toEqual(
      [assertDefined(linkedProject).id, assertDefined(unlinkedProject).id].sort(),
    );
  });

  it('an initiativeId in a foreign org yields empty swimlane content (tenant isolation)', async () => {
    const { userId } = await seedUserWithHub();
    const mine = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    await joinOrg(userId, mine.orgId);

    // An in-flight project in MY org, but the filter names a FOREIGN initiative.
    await db.insert(schema.project).values({
      organizationId: mine.orgId,
      name: 'Mine',
      teamId: mine.teamId,
      status: 'active',
      statusId: mine.statusId('project', 'active'),
      createdBy: mine.humanActorId,
    });
    const [foreignInit] = await db
      .insert(schema.initiative)
      .values({
        organizationId: foreign.orgId,
        name: 'Theirs',
        status: 'active',
        statusId: foreign.statusId('initiative', 'active'),
        createdBy: foreign.humanActorId,
      })
      .returning({ id: schema.initiative.id });

    const app = appWithSession(hub, fakeSession(userId));
    const portfolio = await body<{
      swimlanes: { organization: { id: string }; programs: unknown[]; unassigned: unknown[] }[];
    }>(await app.request(`/portfolio?initiativeId=${assertDefined(foreignInit).id}`));
    const lane = assertDefined(portfolio.swimlanes.find((s) => s.organization.id === mine.orgId));
    // The foreign initiative resolves to no in-scope edges → nothing shows for my org.
    expect(lane.programs).toEqual([]);
    expect(lane.unassigned).toEqual([]);
  });
});

describe('hub /search (cross-org typed hits)', () => {
  function searchRoute(orgId: string, kind: string, id: string) {
    return {
      type: 'entity',
      organizationId: orgId,
      entityKind: kind,
      entityId: id,
      href: `/orgs/${orgId}/search?id=${id}`,
    };
  }

  it('returns org-chipped semantic hits and honors the limit', async () => {
    const { userId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinOrg(userId, org.orgId);

    await db.insert(schema.searchDocument).values([
      {
        id: `task:${org.orgId}:zephyr_task`,
        organizationId: org.orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'zephyr_task',
        title: 'Zephyr Task',
        facet: {},
        route: searchRoute(org.orgId, 'task', 'zephyr_task'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
      {
        id: `project:${org.orgId}:zephyr_project`,
        organizationId: org.orgId,
        kind: 'project',
        family: 'work',
        sourceTable: 'project',
        entityId: 'zephyr_project',
        title: 'Zephyr Project',
        facet: {},
        route: searchRoute(org.orgId, 'project', 'zephyr_project'),
        visibility: { mode: 'org_members' },
        baseRank: 95,
      },
      {
        id: `program:${org.orgId}:zephyr_program`,
        organizationId: org.orgId,
        kind: 'program',
        family: 'work',
        sourceTable: 'program',
        entityId: 'zephyr_program',
        title: 'Zephyr Program',
        facet: {},
        route: searchRoute(org.orgId, 'program', 'zephyr_program'),
        visibility: { mode: 'org_members' },
        baseRank: 88,
      },
    ]);

    const app = appWithSession(hub, fakeSession(userId));
    const search = await body<{
      query: string;
      items: { organizationId: string; kind: string; id: string; title: string }[];
    }>(await app.request('/search?q=Zephyr'));
    expect(search.query).toBe('Zephyr');
    const types = new Set(search.items.map((r) => r.kind));
    expect(types.has('task')).toBe(true);
    expect(types.has('project')).toBe(true);
    expect(types.has('program')).toBe(true);
    expect(search.items.every((r) => r.organizationId === org.orgId)).toBe(true);

    // A tiny limit caps the merged result set.
    const limited = await body<{ items: unknown[] }>(await app.request('/search?q=Zephyr&limit=1'));
    expect(limited.items).toHaveLength(1);
  });

  it('tenant isolation: never matches entities in a non-member org', async () => {
    const { userId } = await seedUserWithHub();
    const mine = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    await joinOrg(userId, mine.orgId);
    await db.insert(schema.searchDocument).values({
      id: `task:${foreign.orgId}:quasar_secret`,
      organizationId: foreign.orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'quasar_secret',
      title: 'Quasar Secret',
      facet: {},
      route: searchRoute(foreign.orgId, 'task', 'quasar_secret'),
      visibility: { mode: 'org_members' },
    });
    const app = appWithSession(hub, fakeSession(userId));
    const search = await body<{ items: unknown[] }>(await app.request('/search?q=Quasar'));
    expect(search.items).toHaveLength(0);
  });

  it('treats an empty query as browse rather than rejecting it', async () => {
    const { userId } = await seedUserWithHub();
    const app = appWithSession(hub, fakeSession(userId));

    // `q` is optional by design (see SearchQuery in domain packages): omitting it — or sending it
    // empty, which trims to the same thing — asks for the same permission-filtered corpus ordered
    // by recency instead of relevance. The Library rides this path rather than getting its own
    // endpoint, so that no second copy of the visibility filter can drift from this one.
    expect((await app.request('/search?q=')).status).toBe(200);
    expect((await app.request('/search')).status).toBe(200);
  });

  it('still rejects a query it cannot parse (422)', async () => {
    const { userId } = await seedUserWithHub();
    const app = appWithSession(hub, fakeSession(userId));

    // `q` going optional did not make the whole query bag permissive. `limit` is still bounded,
    // and the rejection path this covers is the one the empty-`q` case used to exercise before
    // browse mode existed.
    expect((await app.request('/search?limit=0')).status).toBe(422);
    expect((await app.request('/search?limit=101')).status).toBe(422);
  });

  it('a deactivated membership row is excluded from search scope', async () => {
    const { userId } = await seedUserWithHub();
    const org = await seedBaseOrg(db, schema);
    await joinOrg(userId, org.orgId, 'suspended');
    await db.insert(schema.searchDocument).values({
      id: `task:${org.orgId}:nebula_item`,
      organizationId: org.orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'nebula_item',
      title: 'Nebula Item',
      facet: {},
      route: searchRoute(org.orgId, 'task', 'nebula_item'),
      visibility: { mode: 'org_members' },
    });
    const app = appWithSession(hub, fakeSession(userId));
    const search = await body<{ items: unknown[] }>(await app.request('/search?q=Nebula'));
    expect(search.items).toHaveLength(0);
  });
});
