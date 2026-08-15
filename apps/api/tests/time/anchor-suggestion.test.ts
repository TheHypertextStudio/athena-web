/**
 * `@docket/api` — what Docket proposes the caller should be tracking, and why.
 *
 * @remarks
 * Two things are worth pinning here. First, the **order**: the four sources are ranked by how
 * strongly each commits the caller to a task in the present minute, and getting that order wrong
 * would have the app confidently suggesting yesterday's leftovers over the block someone is
 * sitting in right now. Second, the **filters**: a suggestion the caller cannot start, or one
 * drawn from a block that has already ended, is worse than no suggestion at all, because they
 * cannot tell it apart from a good one without acting on it.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import {
  addMember,
  getDb,
  one,
  seedOrg,
  seedStatuses,
  seedUserWithHub,
  type StatusIdLookup,
} from '../support/routes-harness';
import { resolveAnchorSuggestion } from '../../src/time/anchor-suggestion';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

const NOW = new Date('2026-08-05T14:30:00.000Z');

let userId: string;
let hubId: string;
let organizationId: string;
let teamId: string;
let actorId: string;
let statusId: StatusIdLookup;

beforeEach(async () => {
  schema = await getDb();
  db = schema.db;
  userId = await seedUserWithHub(db, schema, 'Anchor');
  hubId = one(
    await db.select({ id: schema.hub.id }).from(schema.hub).where(eq(schema.hub.userId, userId)),
  ).id;
  organizationId = await seedOrg(db, schema);
  statusId = await seedStatuses(db, schema, organizationId);
  actorId = await addMember(db, schema, organizationId, userId);
  teamId = one(
    await db
      .insert(schema.team)
      .values({
        organizationId,
        name: 'Core',
        key: `K${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id }),
  ).id;
});

/** An ordinary task in the caller's workspace. */
async function seedTask(title: string, overrides: Record<string, unknown> = {}): Promise<string> {
  return one(
    await db
      .insert(schema.task)
      .values({
        organizationId,
        teamId,
        title,
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdBy: actorId,
        ...overrides,
      })
      .returning({ id: schema.task.id }),
  ).id;
}

/** The caller's native-blocks layer, created once per test. */
async function layer(): Promise<string> {
  const existing = await db
    .select({ id: schema.calendarLayer.id })
    .from(schema.calendarLayer)
    .where(eq(schema.calendarLayer.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0].id;
  return one(
    await db
      .insert(schema.calendarLayer)
      .values({ userId, sourceKind: 'native_blocks', title: 'Blocks' })
      .returning({ id: schema.calendarLayer.id }),
  ).id;
}

/** A calendar block owned by the caller, optionally linked to a task. */
async function seedBlock(options: {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly taskId?: string;
  readonly kind?: string;
}): Promise<string> {
  const itemId = one(
    await db
      .insert(schema.calendarItem)
      .values({
        userId,
        layerId: await layer(),
        kind: options.kind ?? 'timebox',
        title: 'Deep work',
        startsAt: options.startsAt,
        endsAt: options.endsAt,
        organizationId,
      })
      .returning({ id: schema.calendarItem.id }),
  ).id;
  if (options.taskId) {
    // The link is owned by the *task's* workspace, which is not always the caller's — the
    // cross-tenant case depends on that being modelled honestly.
    const owner = one(
      await db
        .select({ organizationId: schema.task.organizationId })
        .from(schema.task)
        .where(eq(schema.task.id, options.taskId)),
    ).organizationId;
    await db.insert(schema.calendarItemTaskLink).values({
      calendarItemId: itemId,
      taskId: options.taskId,
      organizationId: owner,
      createdBy: actorId,
    });
  }
  return itemId;
}

describe('resolveAnchorSuggestion', () => {
  it('suggests nothing when the day names nothing', async () => {
    expect(await resolveAnchorSuggestion(userId, hubId, NOW)).toBeNull();
  });

  it('suggests the task linked to the calendar block covering now, with its bounds', async () => {
    const taskId = await seedTask('Onboarding rewrite');
    const startsAt = new Date(NOW.getTime() - 12 * 60_000);
    const endsAt = new Date(NOW.getTime() + 48 * 60_000);
    const calendarItemId = await seedBlock({ startsAt, endsAt, taskId });

    expect(await resolveAnchorSuggestion(userId, hubId, NOW)).toEqual({
      taskId,
      organizationId,
      title: 'Onboarding rewrite',
      source: 'calendar_timebox',
      calendarItemId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
  });

  it('ignores a block that has already ended', async () => {
    const taskId = await seedTask('Finished block');
    await seedBlock({
      startsAt: new Date(NOW.getTime() - 90 * 60_000),
      endsAt: new Date(NOW.getTime() - 30 * 60_000),
      taskId,
    });
    expect(await resolveAnchorSuggestion(userId, hubId, NOW)).toBeNull();
  });

  // Availability describes when someone *could* be booked, not what they are doing. Treating it
  // as a commitment would suggest work through every free hour of the day.
  it('ignores an availability block even when it covers now and names a task', async () => {
    const taskId = await seedTask('Not a commitment');
    await seedBlock({
      startsAt: new Date(NOW.getTime() - 10 * 60_000),
      endsAt: new Date(NOW.getTime() + 10 * 60_000),
      taskId,
      kind: 'availability_block',
    });
    expect(await resolveAnchorSuggestion(userId, hubId, NOW)).toBeNull();
  });

  it('ignores an archived task', async () => {
    const taskId = await seedTask('Archived', { archivedAt: new Date() });
    await seedBlock({
      startsAt: new Date(NOW.getTime() - 10 * 60_000),
      endsAt: new Date(NOW.getTime() + 10 * 60_000),
      taskId,
    });
    expect(await resolveAnchorSuggestion(userId, hubId, NOW)).toBeNull();
  });

  it('ignores a task in a workspace the caller has no active actor in', async () => {
    const foreignOrg = await seedOrg(db, schema);
    const foreignStatusId = await seedStatuses(db, schema, foreignOrg);
    const foreignTeam = one(
      await db
        .insert(schema.team)
        .values({ organizationId: foreignOrg, name: 'Other', key: 'OTH' })
        .returning({ id: schema.team.id }),
    ).id;
    const foreignTask = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: foreignOrg,
          teamId: foreignTeam,
          title: 'Hidden',
          state: 'todo',
          statusId: foreignStatusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;
    await seedBlock({
      startsAt: new Date(NOW.getTime() - 10 * 60_000),
      endsAt: new Date(NOW.getTime() + 10 * 60_000),
      taskId: foreignTask,
    });
    expect(await resolveAnchorSuggestion(userId, hubId, NOW)).toBeNull();
  });

  it('falls back to a daily-plan timebox when no calendar block covers now', async () => {
    const taskId = await seedTask('Planned work');
    await db.insert(schema.dailyPlanItem).values({
      hubId,
      refOrganizationId: organizationId,
      refTaskId: taskId,
      date: '2026-08-05',
      timeboxStartsAt: new Date(NOW.getTime() - 5 * 60_000),
      timeboxEndsAt: new Date(NOW.getTime() + 25 * 60_000),
    });

    const suggestion = await resolveAnchorSuggestion(userId, hubId, NOW);
    expect(suggestion).toMatchObject({
      taskId,
      source: 'daily_plan_timebox',
      calendarItemId: null,
    });
  });

  // Both stores hold "planned time" and nothing joins them, so the order between them has to be
  // deliberate: a calendar block is the stronger claim about the present minute.
  it('prefers the calendar block over a daily-plan timebox covering the same minute', async () => {
    const planned = await seedTask('From the day plan');
    const scheduled = await seedTask('From the calendar');
    await db.insert(schema.dailyPlanItem).values({
      hubId,
      refOrganizationId: organizationId,
      refTaskId: planned,
      date: '2026-08-05',
      timeboxStartsAt: new Date(NOW.getTime() - 5 * 60_000),
      timeboxEndsAt: new Date(NOW.getTime() + 25 * 60_000),
    });
    await seedBlock({
      startsAt: new Date(NOW.getTime() - 5 * 60_000),
      endsAt: new Date(NOW.getTime() + 25 * 60_000),
      taskId: scheduled,
    });

    expect(await resolveAnchorSuggestion(userId, hubId, NOW)).toMatchObject({
      taskId: scheduled,
      source: 'calendar_timebox',
    });
  });

  it('falls back to the day directive’s recommendation while it is still fresh', async () => {
    const taskId = await seedTask('Recommended next');
    await db.insert(schema.dayDirective).values({
      hubId,
      date: '2026-08-05',
      timezone: 'UTC',
      directiveId: 'dir_1',
      recommendedTaskId: taskId,
      computedAt: new Date(NOW.getTime() - 60 * 60_000),
    });

    expect(await resolveAnchorSuggestion(userId, hubId, NOW)).toMatchObject({
      taskId,
      source: 'day_directive',
    });
  });

  // A directive nobody has recomputed since yesterday morning does not speak for this minute.
  it('ignores a stale day directive', async () => {
    const taskId = await seedTask('Yesterday’s recommendation');
    await db.insert(schema.dayDirective).values({
      hubId,
      date: '2026-08-04',
      timezone: 'UTC',
      directiveId: 'dir_0',
      recommendedTaskId: taskId,
      computedAt: new Date(NOW.getTime() - 20 * 60 * 60_000),
    });

    expect(await resolveAnchorSuggestion(userId, hubId, NOW)).toBeNull();
  });
});
