import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as HubTodayModule from '../../src/routes/hub-today';

import { getDb, one, seedBaseOrg, seedStatuses, seedUserWithHub } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let buildHubTodayPayload!: typeof HubTodayModule.buildHubTodayPayload;

const DATE = '2026-08-12';
/** Mid-morning on {@link DATE}, so the day has capacity left in it. */
const NOW = new Date(`${DATE}T09:00:00.000Z`);

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  buildHubTodayPayload = (await import('../../src/routes/hub-today')).buildHubTodayPayload;
  // The payload reads the clock itself to work out how much of the day is left, and a suggestion
  // only appears if it fits. Against the real clock these tests would pass all day and fail in the
  // last half hour of UTC — so the clock is pinned rather than the estimates made implausibly small.
  // Only `Date` is faked; timers stay real so the database driver is unaffected.
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

let seq = 0;

/** A person with a Hub, an org, and an actor in it. */
async function seedPerson(): Promise<{ orgId: string; teamId: string; userId: string }> {
  const { orgId, teamId } = await seedBaseOrg(db, schema);
  const userId = await seedUserWithHub(db, schema, `Today${String(++seq)}`);
  await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Today', userId });
  const [hubRow] = await db
    .select({ id: schema.hub.id })
    .from(schema.hub)
    .where(eq(schema.hub.userId, userId))
    .limit(1);
  // Desk time every day, all day: capacity is a precondition for a suggestion, not the thing under
  // test, so it is made generous rather than realistic.
  await db.insert(schema.schedulingPreference).values({
    hubId: assertDefined(hubRow).id,
    timezone: 'UTC',
    windows: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      startMinute: 0,
      endMinute: 24 * 60 - 1,
      kind: 'desk',
      label: null,
    })),
  });
  return { orgId, teamId, userId };
}

/** One open task assigned to the caller. */
async function seedTask(
  orgId: string,
  teamId: string,
  userId: string,
  over: {
    title?: string;
    priority?: 'urgent' | 'high' | 'medium' | 'low';
    dueDate?: Date;
    estimateMinutes?: number;
  } = {},
): Promise<string> {
  const [actorRow] = await db
    .select({ id: schema.actor.id })
    .from(schema.actor)
    .where(eq(schema.actor.userId, userId))
    .limit(1);
  const statusId = await seedStatuses(db, schema, orgId);
  seq += 1;
  return one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: over.title ?? `Task ${String(seq)}`,
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'public',
        assigneeId: actorRow?.id ?? null,
        ...(over.priority ? { priority: over.priority } : {}),
        ...(over.dueDate ? { dueDate: over.dueDate } : {}),
        estimateMinutes: over.estimateMinutes ?? 30,
      })
      .returning({ id: schema.task.id }),
  ).id;
}

describe('buildHubTodayPayload', () => {
  it('answers with an empty day rather than failing when there is nothing to read', async () => {
    // A user with no Hub and no org memberships is a real state — mid-onboarding, or an account whose
    // last org was deleted. The surface has to render something rather than throw.
    const userId = one(
      await db
        .insert(schema.user)
        .values({ name: 'Nobody', email: `nobody-${String(++seq)}@example.test` })
        .returning({ id: schema.user.id }),
    ).id;

    const payload = await buildHubTodayPayload(userId, DATE);

    expect(payload.date).toBe(DATE);
    expect(payload.plan).toEqual([]);
    expect(payload.suggestions).toEqual([]);
  });

  it('offers the caller their own open work, with a reason for each', async () => {
    // Every suggestion carries application-owned copy saying why it is a feasible next move. The
    // reason is what makes the list a recommendation rather than a dump of open tasks.
    const { orgId, teamId, userId } = await seedPerson();
    await seedTask(orgId, teamId, userId, { title: 'Urgent thing', priority: 'urgent' });

    const payload = await buildHubTodayPayload(userId, DATE);

    expect(payload.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of payload.suggestions) {
      expect(suggestion.reason.length).toBeGreaterThan(0);
      expect(suggestion.estimateMinutes).toBeGreaterThan(0);
      expect(suggestion.dependencyImpact).toBeGreaterThanOrEqual(0);
    }
  });

  it('says a task is due today when it is, ahead of merely being high priority', async () => {
    // Ordering of reasons is the claim: a deadline is a stronger reason to pick something up than a
    // priority label, so a task that is both must say the deadline.
    const { orgId, teamId, userId } = await seedPerson();
    await seedTask(orgId, teamId, userId, {
      title: 'Due and urgent',
      priority: 'urgent',
      dueDate: new Date(`${DATE}T12:00:00.000Z`),
    });

    const payload = await buildHubTodayPayload(userId, DATE);

    const due = payload.suggestions.find((item) => item.title === 'Due and urgent');
    expect(due?.reason).toBe('Due today');
  });

  it('names the priority when there is no deadline to name', async () => {
    const { orgId, teamId, userId } = await seedPerson();
    await seedTask(orgId, teamId, userId, { title: 'High only', priority: 'high' });

    const payload = await buildHubTodayPayload(userId, DATE);

    // Capitalised for display, from the stored lower-case enum value.
    expect(payload.suggestions.find((item) => item.title === 'High only')?.reason).toBe(
      'High priority',
    );
  });

  it('falls back to fit when a task has neither a deadline nor an urgent label', async () => {
    // The default has to be honest too: it says the task fits the time left, which is the only claim
    // still true when nothing else distinguishes it.
    const { orgId, teamId, userId } = await seedPerson();
    await seedTask(orgId, teamId, userId, { title: 'Ordinary', priority: 'medium' });

    const payload = await buildHubTodayPayload(userId, DATE);

    expect(payload.suggestions.find((item) => item.title === 'Ordinary')?.reason).toBe(
      'Fits the time left today',
    );
  });

  it('counts what a task unblocks, and says so ahead of anything else', async () => {
    // Unblocking other work is the strongest reason of all: it is the one that changes what somebody
    // *else* can do next, and it is stated with a count so the size of the effect is visible.
    const { orgId, teamId, userId } = await seedPerson();
    const blocker = await seedTask(orgId, teamId, userId, {
      title: 'The blocker',
      priority: 'urgent',
      dueDate: new Date(`${DATE}T12:00:00.000Z`),
    });
    const blocked = await seedTask(orgId, teamId, userId, { title: 'Waiting on it' });
    await db
      .insert(schema.taskDependency)
      .values({ organizationId: orgId, blockedTaskId: blocked, blockingTaskId: blocker });

    const payload = await buildHubTodayPayload(userId, DATE);

    const item = payload.suggestions.find((entry) => entry.title === 'The blocker');
    expect(item?.dependencyImpact).toBe(1);
    // Singular, because there is exactly one.
    expect(item?.reason).toBe('Unblocks 1 task');
  });

  it('pluralises the count when a task unblocks more than one thing', async () => {
    // The other side of the count. Copy assembled from a number is the kind of thing that reads fine
    // in the one case somebody tried and wrong in every other.
    const { orgId, teamId, userId } = await seedPerson();
    const blocker = await seedTask(orgId, teamId, userId, { title: 'The big blocker' });
    for (const title of ['First waiter', 'Second waiter']) {
      const blocked = await seedTask(orgId, teamId, userId, { title });
      await db
        .insert(schema.taskDependency)
        .values({ organizationId: orgId, blockedTaskId: blocked, blockingTaskId: blocker });
    }

    const payload = await buildHubTodayPayload(userId, DATE);

    const item = payload.suggestions.find((entry) => entry.title === 'The big blocker');
    expect(item?.dependencyImpact).toBe(2);
    expect(item?.reason).toBe('Unblocks 2 tasks');
  });

  it('says why the first planned item is the one to do now', async () => {
    // The plan is what the person committed to, so its items carry a different kind of reason than a
    // suggestion: not "this would fit" but "this is where you said you'd start". Ordering matters —
    // a deadline outranks position, and being scheduled right now outranks both.
    const { orgId, teamId, userId } = await seedPerson();
    const [hubRow] = await db
      .select({ id: schema.hub.id })
      .from(schema.hub)
      .where(eq(schema.hub.userId, userId))
      .limit(1);
    const first = await seedTask(orgId, teamId, userId, { title: 'Chosen first' });
    const second = await seedTask(orgId, teamId, userId, { title: 'Chosen second' });
    await db.insert(schema.dailyPlanItem).values([
      {
        hubId: assertDefined(hubRow).id,
        refOrganizationId: orgId,
        refTaskId: first,
        date: DATE,
        sort: 0,
      },
      {
        hubId: assertDefined(hubRow).id,
        refOrganizationId: orgId,
        refTaskId: second,
        date: DATE,
        sort: 1,
      },
    ]);

    const payload = await buildHubTodayPayload(userId, DATE);

    expect(payload.plan.length).toBeGreaterThanOrEqual(2);
    expect(payload.plan[0]?.reason).toBe('You chose this first');
    expect(payload.plan[1]?.reason).toBe('Next in your plan');
  });

  it('says a planned item is due today when its deadline has arrived', async () => {
    // A deadline outranks position: the second thing in the plan still says "Due today" rather than
    // "Next in your plan", because the deadline is the fact that changes what to do about it.
    const { orgId, teamId, userId } = await seedPerson();
    const [hubRow] = await db
      .select({ id: schema.hub.id })
      .from(schema.hub)
      .where(eq(schema.hub.userId, userId))
      .limit(1);
    const first = await seedTask(orgId, teamId, userId, { title: 'Plain first' });
    const due = await seedTask(orgId, teamId, userId, {
      title: 'Due second',
      dueDate: new Date(`${DATE}T15:00:00.000Z`),
    });
    await db.insert(schema.dailyPlanItem).values([
      {
        hubId: assertDefined(hubRow).id,
        refOrganizationId: orgId,
        refTaskId: first,
        date: DATE,
        sort: 0,
      },
      {
        hubId: assertDefined(hubRow).id,
        refOrganizationId: orgId,
        refTaskId: due,
        date: DATE,
        sort: 1,
      },
    ]);

    const payload = await buildHubTodayPayload(userId, DATE);

    expect(payload.plan.find((item) => item.title === 'Due second')?.reason).toBe('Due today');
  });

  it('keeps the surface bounded, however much is open', async () => {
    // Today is a place to start working, not a backlog. The cap is part of the product, so it is
    // asserted rather than left to whatever the query happens to return.
    const { orgId, teamId, userId } = await seedPerson();
    for (let index = 0; index < 6; index++) {
      await seedTask(orgId, teamId, userId, { title: `Open ${String(index)}` });
    }

    const payload = await buildHubTodayPayload(userId, DATE);

    expect(payload.suggestions.length).toBeLessThanOrEqual(3);
    expect(payload.statusCards.length).toBeLessThanOrEqual(4);
  });
});
