/**
 * `@docket/api` — the proactive day cadence, tested where its defect would actually live.
 *
 * @remarks
 * These tests deliberately enter at {@link sweepDayCadence} — the scheduled entry point — and
 * assert on **rows**, never on a return value alone. That is the whole point of the file: the
 * behaviours it covers existed as pure functions with no caller for a long time, and a test that
 * called `reorganizeRemainingDay` directly would have passed happily throughout. So the drift
 * case asserts that the calendar item genuinely moved and that a check-in notification genuinely
 * exists, and both of those go dark the moment the sweep stops calling the reorganization.
 *
 * The day is seeded by hand rather than planned by the scheduler, because these cases need an
 * exact shape — one block forty-five minutes past its window, one block that has not started —
 * and a real planning run would place whatever it liked.
 *
 * **On the counters.** The sweep is a whole-fleet pass, so every Hub any test in this file seeded
 * is still in the table when the next one sweeps. Its aggregate counters are therefore asserted
 * only where they are honestly monotone (`failed` must be zero; a count must be *at least* what
 * this Hub contributed); everything that has to be exact is asserted against this Hub's own rows.
 * A counter equality here would be a test that passes or fails on file ordering.
 */
import type * as DbModule from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type { sweepDayCadence as SweepDayCadence } from '../../src/routes/day-cadence-sweep';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let sweepDayCadence!: typeof SweepDayCadence;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  sweepDayCadence = (await import('../../src/routes/day-cadence-sweep')).sweepDayCadence;
});

const TZ = 'UTC';
/** A Tuesday, so the default availability model gives the day real windows. */
const DATE = '2026-10-06';
/** The Monday of that week, which is what makes the day read as planned. */
const WEEK = '2026-10-05';

/** An instant on `DATE`, in UTC, from a wall-clock time. */
function at(clock: string): Date {
  return new Date(`${DATE}T${clock}:00.000Z`);
}

interface Seed {
  readonly userId: string;
  readonly hubId: string;
  readonly layerId: string;
}

/** A weekday-only desk window, for the cases that need the day's capacity to be knowable. */
function deskWindows(startHour: number, endHour: number) {
  return [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: startHour * 60,
    endMinute: endHour * 60,
    kind: 'desk' as const,
    label: 'Desk',
  }));
}

/** Seed a user, their Hub, a scheduling preference (which is what the sweep selects on), a layer. */
async function seedHub(options: { windows?: ReturnType<typeof deskWindows> } = {}): Promise<Seed> {
  const slug = `dc-${Math.random().toString(36).slice(2, 10)}`;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@e.com` })
    .returning({ id: schema.user.id });
  const [h] = await db
    .insert(schema.hub)
    .values({ userId: assertDefined(u).id })
    .returning({ id: schema.hub.id });
  await db.insert(schema.schedulingPreference).values({
    hubId: assertDefined(h).id,
    timezone: TZ,
    ...(options.windows ? { windows: options.windows } : {}),
  });
  const [layer] = await db
    .insert(schema.calendarLayer)
    .values({
      userId: assertDefined(u).id,
      connectionId: null,
      provider: 'docket',
      sourceKind: 'native_blocks',
      title: 'Docket blocks',
      selected: true,
      visibleByDefault: true,
      editableCore: true,
      primary: false,
    })
    .returning({ id: schema.calendarLayer.id });
  return {
    userId: assertDefined(u).id,
    hubId: assertDefined(h).id,
    layerId: assertDefined(layer).id,
  };
}

/** One scheduler-placed block. Returns its id so a test can read its times back. */
async function seedBlock(
  seed: Seed,
  title: string,
  start: Date,
  end: Date,
  options: { origin?: 'scheduler' | 'user'; done?: boolean } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.calendarItem)
    .values({
      userId: seed.userId,
      layerId: seed.layerId,
      connectionId: null,
      kind: 'native_block',
      provider: 'docket',
      // `free` is the calendar's own completion signal — what `loadDayBlocks` reads as done.
      status: options.done === true ? 'free' : 'confirmed',
      syncState: 'clean',
      title,
      startsAt: start,
      endsAt: end,
      workShape: 'deep_writing',
      origin: options.origin ?? 'scheduler',
    })
    .returning({ id: schema.calendarItem.id });
  return assertDefined(row).id;
}

/** The planning run that makes the day read `ready` rather than `not_generated`. */
async function seedRun(seed: Seed): Promise<void> {
  await db
    .insert(schema.scheduleRun)
    .values({ hubId: seed.hubId, weekStartDate: WEEK, timezone: TZ, blockCount: 2 });
}

/**
 * A day that has genuinely drifted: a two-hour morning block still unfinished forty-five minutes
 * past its window, and an afternoon block that has not started and now overlaps it.
 */
async function seedDriftedDay(): Promise<Seed & { overrunId: string; upcomingId: string }> {
  const seed = await seedHub();
  await seedRun(seed);
  const overrunId = await seedBlock(seed, 'Cut the trailer', at('09:00'), at('14:00'));
  const upcomingId = await seedBlock(seed, 'Draft the brief', at('14:30'), at('15:30'));
  return { ...seed, overrunId, upcomingId };
}

/** Every notification intent addressed to one user, newest last. */
async function intentsFor(userId: string) {
  return db
    .select({
      id: schema.notificationIntent.id,
      subject: schema.notificationIntent.subject,
      body: schema.notificationIntent.body,
      category: schema.notificationIntent.category,
      idempotencyKey: schema.notificationIntent.idempotencyKey,
    })
    .from(schema.notificationIntent)
    .innerJoin(
      schema.notificationRecipient,
      eq(schema.notificationRecipient.notificationId, schema.notificationIntent.id),
    )
    .where(eq(schema.notificationRecipient.userId, userId))
    .orderBy(schema.notificationIntent.createdAt);
}

/** The block's times as the calendar now holds them. */
async function blockTimes(id: string): Promise<{ startsAt: Date | null; endsAt: Date | null }> {
  const [row] = await db
    .select({ startsAt: schema.calendarItem.startsAt, endsAt: schema.calendarItem.endsAt })
    .from(schema.calendarItem)
    .where(eq(schema.calendarItem.id, id));
  return assertDefined(row);
}

describe('sweepDayCadence — a day that has drifted', () => {
  it('re-cuts the remaining day AND fires the check-in that has come due', async () => {
    const seed = await seedDriftedDay();
    // 14:45: the 09:00–14:00 block is forty-five minutes past its window (drift, by posture), and
    // the 14:30 check-in came due fifteen minutes ago (inside the firing window).
    const now = at('14:45');

    const result = await sweepDayCadence(now);

    expect(result.failed).toBe(0);

    // 1. THE REMAINDER WAS REORGANIZED — asserted on the calendar row, not on a return value.
    //    The not-yet-started block cannot keep 14:30 (the overrun block consumed it), so it is
    //    re-placed into the availability that is genuinely left.
    expect(result.reorganized).toBeGreaterThanOrEqual(1);
    const moved = await blockTimes(seed.upcomingId);
    expect(moved.startsAt?.toISOString()).toBe(at('14:45').toISOString());
    expect(moved.endsAt?.toISOString()).toBe(at('15:45').toISOString());

    // The block that is actually being worked is never moved out from under the person.
    const untouched = await blockTimes(seed.overrunId);
    expect(untouched.startsAt?.toISOString()).toBe(at('09:00').toISOString());

    // 2. A CHECK-IN NOTIFICATION WAS PRODUCED, and the row records that it fired.
    expect(result.fired).toBeGreaterThanOrEqual(1);
    const intents = await intentsFor(seed.userId);
    const checkInIntent = intents.find((i) => i.idempotencyKey?.startsWith('day-check-in:'));
    expect(checkInIntent).toBeDefined();
    expect(checkInIntent?.category).toBe('workflow');
    // Application-owned copy, and it names the re-cut rather than letting the calendar change
    // silently underneath the person being asked how the day is going.
    expect(checkInIntent?.body).toMatchObject({ text: expect.stringContaining('re-cut') });

    const fired = await db
      .select({ firedAt: schema.dayCheckIn.firedAt, scheduledAt: schema.dayCheckIn.scheduledAt })
      .from(schema.dayCheckIn)
      .where(and(eq(schema.dayCheckIn.hubId, seed.hubId), eq(schema.dayCheckIn.date, DATE)));
    const firedRows = fired.filter((r) => r.firedAt !== null);
    expect(firedRows).toHaveLength(1);
    expect(firedRows[0]?.scheduledAt.toISOString()).toBe(at('14:30').toISOString());

    // 3. The re-cut announced itself. A calendar that rearranges without saying so is one you
    //    cannot trust.
    const recut = intents.find((i) => i.idempotencyKey?.startsWith('day-recut:'));
    expect(recut?.subject).toBe('The rest of today has been re-cut');
  });

  it('leaves the day alone on the next tick — no re-cut loop, no second notification', async () => {
    const seed = await seedDriftedDay();
    await sweepDayCadence(at('14:45'));
    const afterFirst = await blockTimes(seed.upcomingId);
    expect(afterFirst.startsAt?.toISOString()).toBe(at('14:45').toISOString());

    // Ten minutes later the day is still late, but it was re-cut inside the cooldown and the
    // check-in has already fired. A five-minute cadence must not become a five-minute nag.
    await sweepDayCadence(at('14:55'));

    const afterSecond = await blockTimes(seed.upcomingId);
    expect(afterSecond.startsAt?.toISOString()).toBe(afterFirst.startsAt?.toISOString());

    const intents = await intentsFor(seed.userId);
    expect(intents.filter((i) => i.idempotencyKey?.startsWith('day-check-in:'))).toHaveLength(1);
    expect(intents.filter((i) => i.idempotencyKey?.startsWith('day-recut:'))).toHaveLength(1);
    // No second check-in row was materialized either: the day keeps the rhythm it started with.
    const rows = await db
      .select({ id: schema.dayCheckIn.id })
      .from(schema.dayCheckIn)
      .where(and(eq(schema.dayCheckIn.hubId, seed.hubId), eq(schema.dayCheckIn.date, DATE)));
    expect(rows.length).toBe(8);
  });

  it('is deterministic: the same seeded day at the same instant produces the same result', async () => {
    const a = await seedDriftedDay();
    const b = await seedDriftedDay();
    // Two Hubs seeded identically. Sweeping picks up both, so the per-Hub work is done twice over
    // identical input in one pass — and the two must land in exactly the same place.
    await sweepDayCadence(at('14:45'));

    const movedA = await blockTimes(a.upcomingId);
    const movedB = await blockTimes(b.upcomingId);
    expect(movedA.startsAt?.toISOString()).toBe(movedB.startsAt?.toISOString());
    expect(movedA.endsAt?.toISOString()).toBe(movedB.endsAt?.toISOString());

    const scheduleFor = async (hubId: string): Promise<string[]> => {
      const rows = await db
        .select({ scheduledAt: schema.dayCheckIn.scheduledAt })
        .from(schema.dayCheckIn)
        .where(and(eq(schema.dayCheckIn.hubId, hubId), eq(schema.dayCheckIn.date, DATE)))
        .orderBy(schema.dayCheckIn.scheduledAt);
      return rows.map((r) => r.scheduledAt.toISOString());
    };
    expect(await scheduleFor(a.hubId)).toEqual(await scheduleFor(b.hubId));
  });

  it('honours the Hub’s own autoReorganizeOnDrift setting rather than a hardcoded policy', async () => {
    const seed = await seedDriftedDay();
    await db
      .update(schema.schedulingPreference)
      .set({ autoReorganizeOnDrift: false })
      .where(eq(schema.schedulingPreference.hubId, seed.hubId));

    await sweepDayCadence(at('14:45'));

    const unmoved = await blockTimes(seed.upcomingId);
    expect(unmoved.startsAt?.toISOString()).toBe(at('14:30').toISOString());
    // The drift is still reported and still asked about — the setting turns off the *re-cut*, not
    // the noticing.
    const intents = await intentsFor(seed.userId);
    expect(intents.filter((i) => i.idempotencyKey?.startsWith('day-check-in:'))).toHaveLength(1);
    expect(intents.filter((i) => i.idempotencyKey?.startsWith('day-recut:'))).toHaveLength(0);
  });

  it('re-cuts on the person’s own answer even while the clock still looks fine', async () => {
    const seed = await seedHub();
    await seedRun(seed);
    // Nothing is overrun at 11:05, so the posture signal is silent...
    await seedBlock(seed, 'Cut the trailer', at('09:00'), at('12:00'));
    const upcomingId = await seedBlock(seed, 'Draft the brief', at('11:30'), at('12:30'));
    // ...but the person said the day had got away from them, and that is the signal that counts.
    await sweepDayCadence(at('10:00'));
    const [row] = await db
      .select({ id: schema.dayCheckIn.id })
      .from(schema.dayCheckIn)
      .where(and(eq(schema.dayCheckIn.hubId, seed.hubId), eq(schema.dayCheckIn.date, DATE)))
      .limit(1);
    await db
      .update(schema.dayCheckIn)
      .set({ response: 'behind', respondedAt: at('11:00') })
      .where(eq(schema.dayCheckIn.id, assertDefined(row).id));

    await sweepDayCadence(at('11:05'));

    // The block that overlapped the block still being worked was moved past it, into the first
    // desk time genuinely left after lunch.
    const moved = await blockTimes(upcomingId);
    expect(moved.startsAt?.toISOString()).toBe(at('13:00').toISOString());
    const intents = await intentsFor(seed.userId);
    expect(intents.filter((i) => i.idempotencyKey?.startsWith('day-recut:'))).toHaveLength(1);
  });
});

describe('sweepDayCadence — the arithmetic in what it says', () => {
  it('states one day, not two: the check-in body never claims more work than the day holds', async () => {
    // A nine-to-five with nothing after it, so the re-cut genuinely runs out of room. Two of the
    // afternoon's blocks will not fit the shortened day and are displaced out of it — which is
    // precisely the case where a count frozen at materialization stops describing the day.
    const seed = await seedHub({ windows: deskWindows(9, 17) });
    await seedRun(seed);
    await seedBlock(seed, 'Cut the trailer', at('09:00'), at('14:00'));
    await seedBlock(seed, 'Answer the producer', at('13:00'), at('14:30'), { done: true });
    await seedBlock(seed, 'Draft the brief', at('14:30'), at('15:30'));
    await seedBlock(seed, 'Review the cut', at('15:30'), at('16:30'));
    await seedBlock(seed, 'Send the invoices', at('16:30'), at('17:00'));
    await seedBlock(seed, 'Book the studio', at('17:00'), at('17:30'));

    const now = at('14:45');
    const result = await sweepDayCadence(now);
    // The pass under test is one where both things happen at once: the day is re-cut, and a
    // check-in comes due and fires. That combination is what makes the two counts disagree.
    expect(result.failed).toBe(0);
    expect(result.reorganized).toBeGreaterThanOrEqual(1);
    expect(result.displacedBlocks).toBeGreaterThanOrEqual(1);

    const intents = await intentsFor(seed.userId);
    const checkIn = intents.find((i) => i.idempotencyKey?.startsWith('day-check-in:'));
    expect(checkIn).toBeDefined();
    const text = (checkIn?.body as { text?: string } | null)?.text ?? '';
    expect(text).toContain('re-cut');

    const numbers = /^(\d+) of (\d+) blocks done, (\d+) still ahead of you\./.exec(text);
    expect(numbers).not.toBeNull();
    const done = Number(numbers?.[1]);
    const total = Number(numbers?.[2]);
    const ahead = Number(numbers?.[3]);

    // The sentence has to hold together on its own terms. "1 of 4 blocks done, 4 still ahead of
    // you" describes five blocks in a day of four, and a person reading that concludes — fairly —
    // that the system has lost track of their day.
    expect(done + ahead).toBeLessThanOrEqual(total);

    // And it has to be true of the day as it now stands, not of the day as it was before the
    // re-cut moved and displaced blocks underneath it.
    const live = await db
      .select({
        startsAt: schema.calendarItem.startsAt,
        endsAt: schema.calendarItem.endsAt,
        status: schema.calendarItem.status,
      })
      .from(schema.calendarItem)
      .where(
        and(eq(schema.calendarItem.userId, seed.userId), isNull(schema.calendarItem.archivedAt)),
      );
    expect(total).toBe(live.length);
    expect(done).toBe(live.filter((b) => b.status === 'free').length);
    expect(ahead).toBe(
      live.filter((b) => b.status !== 'free' && (b.endsAt?.getTime() ?? 0) > now.getTime()).length,
    );
  });
});

describe('sweepDayCadence — the days it must not touch', () => {
  it('skips a Hub whose today was never planned, rather than inventing a day to ask about', async () => {
    const seed = await seedHub();
    await seedBlock(seed, 'Cut the trailer', at('09:00'), at('14:00'));

    const result = await sweepDayCadence(at('14:45'));

    expect(result.skipped).toBeGreaterThanOrEqual(1);
    const rows = await db
      .select({ id: schema.dayCheckIn.id })
      .from(schema.dayCheckIn)
      .where(eq(schema.dayCheckIn.hubId, seed.hubId));
    expect(rows).toHaveLength(0);
    expect(await intentsFor(seed.userId)).toHaveLength(0);
  });

  it('does not move a block a person placed by hand', async () => {
    const seed = await seedHub();
    await seedRun(seed);
    await seedBlock(seed, 'Cut the trailer', at('09:00'), at('14:00'));
    const handPlaced = await seedBlock(seed, 'Coffee with Sam', at('14:30'), at('15:30'), {
      origin: 'user',
    });

    await sweepDayCadence(at('14:45'));

    const unmoved = await blockTimes(handPlaced);
    expect(unmoved.startsAt?.toISOString()).toBe(at('14:30').toISOString());
    expect(
      (await intentsFor(seed.userId)).filter((i) => i.idempotencyKey?.startsWith('day-recut:')),
    ).toHaveLength(0);
  });

  it('leaves a check-in that came due hours ago unfired rather than sending a backlog', async () => {
    const seed = await seedDriftedDay();

    // Well past every morning check-in's firing window, and past the 14:30 one too.
    await sweepDayCadence(at('16:30'));

    expect(
      (await intentsFor(seed.userId)).filter((i) => i.idempotencyKey?.startsWith('day-check-in:')),
    ).toHaveLength(0);
  });
});
