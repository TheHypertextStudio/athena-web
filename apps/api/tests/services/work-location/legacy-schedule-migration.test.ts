import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import {
  fullSchema,
  hub,
  user,
  workLocationAssertion,
  workPlace,
  workScheduleChange,
  workSchedulePlan,
  type Database,
} from '@docket/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  migrateLegacyWorkSchedule,
  planLegacyWorkScheduleMigration,
} from '../../../src/services/work-location/legacy-schedule-migration';

const PLACE_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PLACE_B = '01BX5ZZKBKACTAV9WEVGEMMVS0';

describe('planLegacyWorkScheduleMigration', () => {
  it('combines compatible weekly places into one seven-day default', () => {
    const result = planLegacyWorkScheduleMigration(
      [
        {
          id: 'weekly-a',
          placeId: PLACE_A,
          schedule: {
            type: 'weekly_timed',
            effectiveFrom: '2026-09-07',
            effectiveUntil: null,
            weekdays: [0, 2],
            startMinute: 540,
            endMinute: 1_020,
            timezone: 'America/Los_Angeles',
          },
        },
        {
          id: 'weekly-b',
          placeId: PLACE_B,
          schedule: {
            type: 'weekly_all_day',
            effectiveFrom: '2026-09-07',
            effectiveUntil: null,
            weekdays: [1],
            timezone: 'America/Los_Angeles',
          },
        },
      ],
      [],
    );

    expect(result).toMatchObject({
      status: 'ready',
      plan: {
        anchorDate: '2026-09-07',
        effectiveFrom: '2026-09-07',
        cycleDays: [
          { segments: [expect.objectContaining({ startMinute: 540 })] },
          { segments: [expect.objectContaining({ durationMinutes: 1_440 })] },
          { segments: [expect.objectContaining({ startMinute: 540 })] },
          { segments: [] },
          { segments: [] },
          { segments: [] },
          { segments: [] },
        ],
      },
    });
  });

  it('turns one-off entries into full-day replacements', () => {
    const result = planLegacyWorkScheduleMigration(
      [
        {
          id: 'one-off',
          placeId: PLACE_A,
          schedule: {
            type: 'one_off_timed',
            startsAt: '2026-09-10T16:00:00.000Z',
            endsAt: '2026-09-10T20:00:00.000Z',
            timezone: 'America/Los_Angeles',
          },
        },
      ],
      [],
    );

    expect(result).toMatchObject({
      status: 'ready',
      plan: { effectiveFrom: '2026-09-10', effectiveUntil: '2026-09-10' },
      exceptions: [
        {
          date: '2026-09-10',
          segments: [expect.objectContaining({ startMinute: 540, durationMinutes: 240 })],
        },
      ],
    });
  });

  it('keeps other weekly and dated work when one occurrence is cancelled', () => {
    const result = planLegacyWorkScheduleMigration(
      [
        {
          id: 'weekly-morning',
          placeId: PLACE_A,
          schedule: {
            type: 'weekly_timed',
            effectiveFrom: '2026-09-07',
            effectiveUntil: null,
            weekdays: [0],
            startMinute: 540,
            endMinute: 720,
            timezone: 'America/Los_Angeles',
          },
        },
        {
          id: 'weekly-afternoon',
          placeId: PLACE_B,
          schedule: {
            type: 'weekly_timed',
            effectiveFrom: '2026-09-07',
            effectiveUntil: null,
            weekdays: [0],
            startMinute: 780,
            endMinute: 1_020,
            timezone: 'America/Los_Angeles',
          },
        },
        {
          id: 'dated-evening',
          placeId: PLACE_A,
          schedule: {
            type: 'one_off_timed',
            startsAt: '2026-09-15T01:00:00.000Z',
            endsAt: '2026-09-15T02:00:00.000Z',
            timezone: 'America/Los_Angeles',
          },
        },
      ],
      [
        {
          assertionId: 'weekly-morning',
          date: '2026-09-14',
          action: 'cancel',
          replacementPlaceId: null,
          replacementSchedule: null,
        },
      ],
    );

    expect(result).toMatchObject({
      status: 'ready',
      exceptions: [
        {
          date: '2026-09-14',
          segments: [
            expect.objectContaining({ startMinute: 780, durationMinutes: 240 }),
            expect.objectContaining({ startMinute: 1_080, durationMinutes: 60 }),
          ],
        },
      ],
    });
  });

  it('refuses overlapping legacy locations instead of guessing which one wins', () => {
    const result = planLegacyWorkScheduleMigration(
      [
        {
          id: 'weekly-a',
          placeId: PLACE_A,
          schedule: {
            type: 'weekly_all_day',
            effectiveFrom: '2026-09-07',
            effectiveUntil: null,
            weekdays: [0],
            timezone: 'America/Los_Angeles',
          },
        },
        {
          id: 'weekly-b',
          placeId: PLACE_B,
          schedule: {
            type: 'weekly_timed',
            effectiveFrom: '2026-09-07',
            effectiveUntil: null,
            weekdays: [0],
            startMinute: 540,
            endMinute: 1_020,
            timezone: 'America/Los_Angeles',
          },
        },
      ],
      [],
    );

    expect(result).toEqual({
      status: 'conflict',
      reason: 'overlapping_segments',
      assertionIds: ['weekly-a', 'weekly-b'],
    });
  });
});

describe('migrateLegacyWorkSchedule', () => {
  let client: PGlite;
  let database: Database;
  let hubId: string;

  beforeAll(async () => {
    client = new PGlite('memory://');
    const migrated = drizzle(client, { schema: fullSchema });
    await migrate(migrated, {
      migrationsFolder: resolve(import.meta.dirname, '../../../../../packages/db/drizzle'),
    });
    database = migrated;
    const owner = (
      await database
        .insert(user)
        .values({ name: 'Legacy owner', email: `legacy-schedule-${Date.now()}@example.com` })
        .returning()
    )[0];
    if (!owner) throw new Error('Expected an owner');
    const ownerHub = (
      await database
        .insert(hub)
        .values({ userId: owner.id, preferences: { timezone: 'America/Los_Angeles' } })
        .returning()
    )[0];
    if (!ownerHub) throw new Error('Expected a Hub');
    hubId = ownerHub.id;
  });

  afterAll(async () => {
    await client.close();
  });

  it('migrates compatible rows once and archives them as readable history', async () => {
    const place = (
      await database.insert(workPlace).values({ hubId, name: 'Legacy office' }).returning()
    )[0];
    if (!place) throw new Error('Expected a place');
    const assertion = (
      await database
        .insert(workLocationAssertion)
        .values({
          hubId,
          placeId: place.id,
          schedule: {
            type: 'weekly_timed',
            effectiveFrom: '2026-09-07',
            effectiveUntil: null,
            weekdays: [0, 1, 2, 3, 4],
            startMinute: 540,
            endMinute: 1_020,
            timezone: 'America/Los_Angeles',
          },
        })
        .returning()
    )[0];
    if (!assertion) throw new Error('Expected an assertion');

    expect(await migrateLegacyWorkSchedule(database, hubId)).toBe('migrated');
    expect(await migrateLegacyWorkSchedule(database, hubId)).toBe('unchanged');
    expect(
      await database.select().from(workSchedulePlan).where(eq(workSchedulePlan.hubId, hubId)),
    ).toHaveLength(1);
    expect(
      await database
        .select()
        .from(workLocationAssertion)
        .where(eq(workLocationAssertion.id, assertion.id)),
    ).toEqual([
      expect.objectContaining({
        archivedAt: expect.any(Date),
        sourcePlanVersionId: expect.any(String),
      }),
    ]);
    expect(
      await database.select().from(workScheduleChange).where(eq(workScheduleChange.hubId, hubId)),
    ).toEqual([]);
  });

  it('serializes concurrent first-read migrations for one Hub', async () => {
    const owner = (
      await database
        .insert(user)
        .values({
          name: 'Concurrent owner',
          email: `concurrent-schedule-${Date.now()}@example.com`,
        })
        .returning()
    )[0];
    if (!owner) throw new Error('Expected a concurrent owner');
    const ownerHub = (
      await database
        .insert(hub)
        .values({ userId: owner.id, preferences: { timezone: 'America/Los_Angeles' } })
        .returning()
    )[0];
    if (!ownerHub) throw new Error('Expected a concurrent Hub');
    const place = (
      await database
        .insert(workPlace)
        .values({ hubId: ownerHub.id, name: 'Concurrent office' })
        .returning()
    )[0];
    if (!place) throw new Error('Expected a concurrent place');
    await database.insert(workLocationAssertion).values({
      hubId: ownerHub.id,
      placeId: place.id,
      schedule: {
        type: 'weekly_all_day',
        effectiveFrom: '2026-09-07',
        effectiveUntil: null,
        weekdays: [0],
        timezone: 'America/Los_Angeles',
      },
    });

    const results = await Promise.all([
      migrateLegacyWorkSchedule(database, ownerHub.id),
      migrateLegacyWorkSchedule(database, ownerHub.id),
    ]);

    expect(results.sort()).toEqual(['migrated', 'unchanged']);
    expect(
      await database.select().from(workSchedulePlan).where(eq(workSchedulePlan.hubId, ownerHub.id)),
    ).toHaveLength(1);
  });
});
