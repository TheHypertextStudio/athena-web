import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg, seedUserWithHub } from '../../support/routes-harness';
import {
  ACTIVITY_PULL_CADENCE_MINUTES,
  pullActivityForUser,
  sweepActivitySources,
} from '../../../src/lib/activity/sweep';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/**
 * A person's calendar with one elapsed, accepted, multi-attendee meeting.
 *
 * @remarks
 * The calendar path had no coverage at all, which is how the org-attribution bug below reached
 * production. Seeded through the real tables rather than a stub because the projection *is* the
 * query: a fake source would exercise none of the predicates that decide what counts as attended.
 */
async function seedAttendedMeeting(userId: string, startsAt: Date, endsAt: Date): Promise<void> {
  // `calendar_connection` has a composite FK onto the Better Auth `account` row that holds the
  // Google grant, so the linked account has to exist before the calendar does.
  const externalAccountId = `acct-${String(++calSeq)}`;
  await db.insert(schema.account).values({
    userId,
    providerId: 'google',
    accountId: externalAccountId,
  });
  const connectionId = one(
    await db
      .insert(schema.calendarConnection)
      .values({
        userId,
        provider: 'google',
        externalAccountId,
        accountEmail: 'ada@example.com',
        status: 'connected',
      })
      .returning({ id: schema.calendarConnection.id }),
  ).id;
  // `calendar_item.layer_id` keys `calendar_layer`, not the similarly-named `calendar_list`. The
  // projection used to join the latter, so the inner join matched nothing and the calendar leg of
  // the feature produced no events at all.
  const layerId = one(
    await db
      .insert(schema.calendarLayer)
      .values({
        userId,
        connectionId,
        sourceKind: 'provider',
        externalLayerId: `cal-${String(++calSeq)}`,
        title: 'Work',
        selected: true,
      })
      .returning({ id: schema.calendarLayer.id }),
  ).id;
  await db.insert(schema.calendarItem).values({
    userId,
    layerId,
    connectionId,
    kind: 'event',
    status: 'confirmed',
    provider: 'google',
    externalEventId: `evt-${String(++calSeq)}`,
    title: 'Comp review',
    startsAt,
    endsAt,
    attendees: [
      { email: 'ada@example.com', self: true, responseStatus: 'accepted' },
      { email: 'colleague@example.com', responseStatus: 'accepted' },
    ],
  });
}

let calSeq = 0;

/** A connected activity-capable integration owned by `actorId`. */
async function seedIntegration(
  orgId: string,
  actorId: string,
  provider: 'github' | 'gmail',
): Promise<string> {
  return one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider,
        pattern: 'connector',
        roles: provider === 'gmail' ? ['signal'] : ['code'],
        status: 'connected',
        createdBy: actorId,
      })
      .returning({ id: schema.integration.id }),
  ).id;
}

/**
 * An org whose human actor is backed by a real Better Auth user and Hub.
 *
 * @remarks
 * The base harness creates an actor with no `user_id`, which is a legitimate shape (an agent, or a
 * member seeded from a provider before they sign in) but not one this sweep can attribute activity
 * to: `event.user_id` is what the cross-org day reads by, so a person is required, not just an
 * actor. Seeding one explicitly keeps that requirement visible in the tests.
 */
async function seedPerson(): Promise<{ orgId: string; actorId: string; userId: string }> {
  const { orgId } = await seedBaseOrg(db, schema);
  const userId = await seedUserWithHub(db, schema, 'Ada');
  const actorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId })
      .returning({ id: schema.actor.id }),
  ).id;
  return { orgId, actorId, userId };
}

async function runsFor(integrationId: string) {
  return db.select().from(schema.syncRun).where(eq(schema.syncRun.integrationId, integrationId));
}

async function eventsFor(userId: string) {
  return db.select().from(schema.event).where(eq(schema.event.userId, userId));
}

describe('sweepActivitySources', () => {
  it('records what the person did, attributed to them so their day can read it', async () => {
    const { orgId, actorId, userId } = await seedPerson();
    const integrationId = await seedIntegration(orgId, actorId, 'github');

    const result = await sweepActivitySources(new Date());

    expect(result.events).toBeGreaterThan(0);
    const rows = await eventsFor(userId);
    expect(rows.length).toBeGreaterThan(0);
    // A null `userId` here would make the row invisible to the cross-org day that aggregates it —
    // correct-looking data that no surface can ever show.
    expect(rows.every((row) => row.userId === userId)).toBe(true);
    expect(rows.some((row) => row.sourceSystem === 'github')).toBe(true);

    const runs = await runsFor(integrationId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.purpose).toBe('activity_pull');
    expect(runs[0]?.status).toBe('succeeded');
  });

  it('re-polling the same window creates nothing new', async () => {
    const { orgId, actorId, userId } = await seedPerson();
    await seedIntegration(orgId, actorId, 'gmail');

    await pullActivityForUser(userId, new Date());
    const afterFirst = (await eventsFor(userId)).length;
    // Straight back in, inside the cadence window, so this exercises the dedupe key rather than the
    // gate — the property that lets the poll be cursorless at all.
    await pullActivityForUser(userId, new Date());

    expect((await eventsFor(userId)).length).toBe(afterFirst);
  });

  it('holds off a source polled recently', async () => {
    const { orgId, actorId } = await seedPerson();
    const integrationId = await seedIntegration(orgId, actorId, 'github');

    await sweepActivitySources(new Date());
    await sweepActivitySources(new Date());

    expect(await runsFor(integrationId)).toHaveLength(1);
  });

  it('polls again once the cadence has elapsed', async () => {
    const { orgId, actorId } = await seedPerson();
    const integrationId = await seedIntegration(orgId, actorId, 'github');

    await sweepActivitySources(new Date());
    const later = new Date(Date.now() + (ACTIVITY_PULL_CADENCE_MINUTES + 1) * 60_000);
    await sweepActivitySources(later);

    expect((await runsFor(integrationId)).length).toBe(2);
  });

  it('is gated by activity runs alone, so an unrelated sync cannot suppress it', async () => {
    // The trap this pins: `finishSuccess` stamps `integration.lastSyncedAt` for *every* purpose, so
    // gating on that column would let a task mirror silence the activity poll for half an hour — and
    // the resulting gap would read as a quiet day rather than a missed one.
    const { orgId, actorId } = await seedPerson();
    const integrationId = await seedIntegration(orgId, actorId, 'github');

    await db.insert(schema.syncRun).values({
      organizationId: orgId,
      integrationId,
      status: 'succeeded',
      trigger: 'scheduled',
      purpose: 'task_sync',
      startedAt: new Date(),
      finishedAt: new Date(),
    });
    await db
      .update(schema.integration)
      .set({ lastSyncedAt: new Date(), lastSyncStatus: 'succeeded' })
      .where(eq(schema.integration.id, integrationId));

    await sweepActivitySources(new Date());

    const activityRuns = await db
      .select()
      .from(schema.syncRun)
      .where(
        and(
          eq(schema.syncRun.integrationId, integrationId),
          eq(schema.syncRun.purpose, 'activity_pull'),
        ),
      );
    expect(activityRuns).toHaveLength(1);
  });

  it('skips a source whose lease is already held rather than failing it', async () => {
    const { orgId, actorId } = await seedPerson();
    const integrationId = await seedIntegration(orgId, actorId, 'github');
    await db
      .update(schema.integration)
      .set({ syncStartedAt: new Date() })
      .where(eq(schema.integration.id, integrationId));

    const result = await sweepActivitySources(new Date());

    expect(result.failed).toBe(0);
    expect(await runsFor(integrationId)).toHaveLength(0);
  });

  it('leaves an archived or disconnected source alone', async () => {
    const { orgId, actorId } = await seedPerson();
    const archived = await seedIntegration(orgId, actorId, 'github');
    await db
      .update(schema.integration)
      .set({ archivedAt: new Date() })
      .where(eq(schema.integration.id, archived));

    await sweepActivitySources(new Date());

    expect(await runsFor(archived)).toHaveLength(0);
  });

  it('reports a quiet day as quiet, without inventing activity', async () => {
    const { userId } = await seedPerson();

    // No integrations and no calendar connection: nothing to ask, so nothing recorded.
    const result = await pullActivityForUser(userId, new Date());

    expect(result).toMatchObject({ integrations: 0, users: 0, events: 0 });
    expect(await eventsFor(userId)).toHaveLength(0);
  });

  it('writes a meeting into the personal workspace, and picks the same one every tick', async () => {
    // `event` is org-scoped and a meeting is not, so one org has to be chosen. An unordered
    // `LIMIT 1` let Postgres decide, which for anyone in two orgs was both arbitrary and free to
    // change between ticks — and since `dedupeKey` is unique *per organization*, a flip writes the
    // same meeting a second time under a different org, into a log with no correction path.
    const { userId } = await seedPerson();
    const personalOrgId = one(
      await db
        .insert(schema.organization)
        .values({ name: 'Ada', slug: `ada-${String(++calSeq)}`, isPersonal: true })
        .returning({ id: schema.organization.id }),
    ).id;
    // Created *after* the shared org, so ordering by age alone would pick the wrong one. That is
    // what makes this assert `isPersonal` decides, rather than passing by accident.
    await db
      .insert(schema.actor)
      .values({
        organizationId: personalOrgId,
        kind: 'human',
        displayName: 'Ada',
        userId,
      })
      .returning({ id: schema.actor.id });

    const now = new Date('2026-08-12T20:00:00.000Z');
    await seedAttendedMeeting(
      userId,
      new Date('2026-08-12T15:00:00.000Z'),
      new Date('2026-08-12T16:00:00.000Z'),
    );

    await pullActivityForUser(userId, now);
    const first = await eventsFor(userId);
    expect(first).toHaveLength(1);
    expect(first[0]?.organizationId).toBe(personalOrgId);

    // Re-running must not produce a second copy under a different org.
    await pullActivityForUser(userId, now);
    const second = await eventsFor(userId);
    expect(second).toHaveLength(1);
    expect(second[0]?.organizationId).toBe(personalOrgId);
  });
});
