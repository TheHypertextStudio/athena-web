import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { findOwnershipBlockers, findSoleOccupiedOrgIds } from '../../src/account/blockers';
import {
  ACCOUNT_GRACE_DAYS,
  cancelAccountDeletion,
  purgeUser,
  scheduleAccountDeletion,
  sweepAccountDeletions,
} from '../../src/account/lifecycle';
import { addMember, getDb, one, seedOrg, seedUserWithHub } from '../support/routes-harness';

const NOW = '2026-01-01T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await getDb();
});

describe('scheduleAccountDeletion / cancelAccountDeletion', () => {
  it('schedules deletion with a +14d delete deadline and is idempotent', async () => {
    const schema = await getDb();
    const { db, hub } = schema;
    const userId = await seedUserWithHub(db, schema, 'ada');
    expect(await scheduleAccountDeletion(db, userId, NOW)).toBe(1);

    const row = one(
      await db
        .select({
          state: hub.deletionState,
          requestedAt: hub.deletionRequestedAt,
          deleteAfterAt: hub.deleteAfterAt,
        })
        .from(hub)
        .where(eq(hub.userId, userId)),
    );
    expect(row.state).toBe('pending_deletion');
    expect(row.requestedAt?.toISOString()).toBe(NOW);
    expect(row.deleteAfterAt?.getTime()).toBe(
      new Date(NOW).getTime() + ACCOUNT_GRACE_DAYS * DAY_MS,
    );

    // Idempotent: re-scheduling re-stamps the same window.
    expect(await scheduleAccountDeletion(db, userId, NOW)).toBe(1);
  });

  it('cancel restores the account to active and clears the timers', async () => {
    const schema = await getDb();
    const { db, hub } = schema;
    const userId = await seedUserWithHub(db, schema, 'grace');
    await scheduleAccountDeletion(db, userId, NOW);
    expect(await cancelAccountDeletion(db, userId)).toBe(1);

    const row = one(
      await db
        .select({ state: hub.deletionState, deleteAfterAt: hub.deleteAfterAt })
        .from(hub)
        .where(eq(hub.userId, userId)),
    );
    expect(row.state).toBe('active');
    expect(row.deleteAfterAt).toBeNull();
  });
});

describe('findOwnershipBlockers', () => {
  it('flags a shared org the user solely owns (with other members)', async () => {
    const schema = await getDb();
    const { db } = schema;
    const owner = await seedUserWithHub(db, schema, 'soleowner');
    const other = await seedUserWithHub(db, schema, 'teammate');
    const orgId = await seedOrg(db, schema, false);
    await addMember(db, schema, orgId, owner, 'owner');
    await addMember(db, schema, orgId, other, 'member');

    const blockers = await findOwnershipBlockers(db, owner);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ organizationId: orgId, memberCount: 2 });
  });

  it('does not flag a co-owned shared org', async () => {
    const schema = await getDb();
    const { db } = schema;
    const a = await seedUserWithHub(db, schema, 'coA');
    const b = await seedUserWithHub(db, schema, 'coB');
    const orgId = await seedOrg(db, schema, false);
    await addMember(db, schema, orgId, a, 'owner');
    await addMember(db, schema, orgId, b, 'owner');

    expect(await findOwnershipBlockers(db, a)).toHaveLength(0);
  });

  it('does not flag a personal org or a solo shared org', async () => {
    const schema = await getDb();
    const { db } = schema;
    const u = await seedUserWithHub(db, schema, 'solo');
    const personal = await seedOrg(db, schema, true);
    await addMember(db, schema, personal, u, 'owner');
    const soloShared = await seedOrg(db, schema, false);
    await addMember(db, schema, soloShared, u, 'owner');

    expect(await findOwnershipBlockers(db, u)).toHaveLength(0);
  });
});

describe('findSoleOccupiedOrgIds', () => {
  it('returns the personal org and a solo shared org, not a co-occupied one', async () => {
    const schema = await getDb();
    const { db } = schema;
    const u = await seedUserWithHub(db, schema, 'occ');
    const teammate = await seedUserWithHub(db, schema, 'occ2');
    const personal = await seedOrg(db, schema, true);
    await addMember(db, schema, personal, u, 'owner');
    const solo = await seedOrg(db, schema, false);
    await addMember(db, schema, solo, u, 'owner');
    const shared = await seedOrg(db, schema, false);
    await addMember(db, schema, shared, u, 'owner');
    await addMember(db, schema, shared, teammate, 'member');

    const ids = await findSoleOccupiedOrgIds(db, u);
    expect(new Set(ids)).toEqual(new Set([personal, solo]));
  });
});

describe('purgeUser', () => {
  it('removes the user, hub, no-FK rows and sole-occupied orgs; spares a co-owned shared org', async () => {
    const schema = await getDb();
    const { db } = schema;
    const u = await seedUserWithHub(db, schema, 'victim');
    const teammate = await seedUserWithHub(db, schema, 'survivor');

    const personal = await seedOrg(db, schema, true);
    await addMember(db, schema, personal, u, 'owner');
    const shared = await seedOrg(db, schema, false);
    await addMember(db, schema, shared, u, 'owner');
    await addMember(db, schema, shared, teammate, 'owner'); // co-owner → org must survive

    // No-FK user_id rows that must be cleaned up explicitly.
    await db.insert(schema.notification).values({ userId: u, type: 'mention', body: {} as never });
    await db.insert(schema.streamSubscription).values({
      organizationId: shared,
      userId: u,
      entityKind: 'work_item',
      source: 'docket',
      externalId: 't1',
    });
    await db.insert(schema.event).values({
      organizationId: shared,
      userId: u,
      sourceSystem: 'linear',
      kind: 'mention',
      occurredAt: new Date(NOW),
      title: 'x',
      dedupeKey: `d-${Math.random()}`,
    });
    await db.insert(schema.dailyDigest).values({ userId: u, digestDate: '2026-01-01' });

    await purgeUser(db, u);

    // User + hub gone.
    expect(await db.select().from(schema.user).where(eq(schema.user.id, u))).toHaveLength(0);
    expect(await db.select().from(schema.hub).where(eq(schema.hub.userId, u))).toHaveLength(0);
    // No-FK rows gone.
    expect(
      await db.select().from(schema.notification).where(eq(schema.notification.userId, u)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.streamSubscription)
        .where(eq(schema.streamSubscription.userId, u)),
    ).toHaveLength(0);
    expect(await db.select().from(schema.event).where(eq(schema.event.userId, u))).toHaveLength(0);
    expect(
      await db.select().from(schema.dailyDigest).where(eq(schema.dailyDigest.userId, u)),
    ).toHaveLength(0);
    // Personal org purged; co-owned shared org survives.
    expect(
      await db.select().from(schema.organization).where(eq(schema.organization.id, personal)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.organization).where(eq(schema.organization.id, shared)),
    ).toHaveLength(1);
    // The survivor keeps their membership in the shared org.
    expect(
      await db.select().from(schema.actor).where(eq(schema.actor.userId, teammate)),
    ).toHaveLength(1);
  });
});

describe('sweepAccountDeletions', () => {
  it('purges a due account, leaves a not-yet-due one, and skips a blocked one', async () => {
    const schema = await getDb();
    const { db, hub } = schema;
    const past = new Date(new Date(NOW).getTime() - DAY_MS);
    const future = new Date(new Date(NOW).getTime() + DAY_MS);

    // Due + safe → purged.
    const due = await seedUserWithHub(db, schema, 'due');
    const dueOrg = await seedOrg(db, schema, true);
    await addMember(db, schema, dueOrg, due, 'owner');
    await db
      .update(hub)
      .set({ deletionState: 'pending_deletion', deleteAfterAt: past })
      .where(eq(hub.userId, due));

    // Pending but not yet due → untouched.
    const notDue = await seedUserWithHub(db, schema, 'notdue');
    await db
      .update(hub)
      .set({ deletionState: 'pending_deletion', deleteAfterAt: future })
      .where(eq(hub.userId, notDue));

    // Due but newly sole-owner of a shared org → skipped (would orphan).
    const blocked = await seedUserWithHub(db, schema, 'blocked');
    const teammate = await seedUserWithHub(db, schema, 'blocked-mate');
    const sharedOrg = await seedOrg(db, schema, false);
    await addMember(db, schema, sharedOrg, blocked, 'owner');
    await addMember(db, schema, sharedOrg, teammate, 'member');
    await db
      .update(hub)
      .set({ deletionState: 'pending_deletion', deleteAfterAt: past })
      .where(eq(hub.userId, blocked));

    const result = await sweepAccountDeletions(db, NOW);
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    expect(await db.select().from(schema.user).where(eq(schema.user.id, due))).toHaveLength(0);
    expect(await db.select().from(schema.user).where(eq(schema.user.id, notDue))).toHaveLength(1);
    expect(await db.select().from(schema.user).where(eq(schema.user.id, blocked))).toHaveLength(1);
  });
});
