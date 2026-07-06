import type * as DbModule from '@docket/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { resolveNotificationPreferences } from '../../../src/services/notifications/preferences';
import { getDb, one, seedUserWithHub } from '../../routes/harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

describe('resolveNotificationPreferences', () => {
  it('uses default web and email delivery for service announcements', async () => {
    const userId = await seedUserWithHub(db, schema, 'PreferenceDefaultAnnouncement');
    const email = await seedContactPoint(userId, {
      type: 'email',
      value: 'default-announcement@example.test',
      valueMasked: 'd***@example.test',
    });

    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'service_announcement',
      priority: 'normal',
      channels: ['web', 'email'],
      now: new Date('2026-07-07T17:00:00.000Z'),
    });

    expect(decisions).toEqual([
      { channel: 'web', decision: 'send', destination: { type: 'in_app' } },
      {
        channel: 'email',
        decision: 'send',
        destination: {
          type: 'email',
          contactPointId: email.id,
          valueMasked: 'd***@example.test',
        },
      },
    ]);
  });

  it('delays allowed external delivery during quiet hours', async () => {
    const userId = await seedUserWithHub(db, schema, 'PreferenceQuietHours');
    await seedContactPoint(userId, {
      type: 'email',
      value: 'quiet@example.test',
      valueMasked: 'q***@example.test',
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      timezone: 'America/Los_Angeles',
      quietHours: {
        enabled: true,
        start: '18:00',
        end: '08:00',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      },
      categories: { workflow: { email: true } },
    });

    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'workflow',
      priority: 'normal',
      channels: ['email'],
      now: new Date('2026-07-07T03:00:00.000Z'),
    });

    expect(decisions).toEqual([
      {
        channel: 'email',
        decision: 'delay',
        destination: expect.objectContaining({ type: 'email' }),
        suppression: { reason: 'quiet_hours', channel: 'email', detail: 'Held by quiet hours' },
      },
    ]);
  });

  it('suppresses email when no verified contact point exists', async () => {
    const userId = await seedUserWithHub(db, schema, 'PreferenceNoContact');

    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'service_announcement',
      priority: 'normal',
      channels: ['email'],
      now: new Date('2026-07-07T17:00:00.000Z'),
    });

    expect(decisions).toEqual([
      {
        channel: 'email',
        decision: 'suppress',
        destination: null,
        suppression: { reason: 'no_verified_contact_point', channel: 'email' },
      },
    ]);
  });

  it('suppresses email when the only matching contact point bounced', async () => {
    const userId = await seedUserWithHub(db, schema, 'PreferenceBouncedContact');
    const email = await seedContactPoint(userId, {
      type: 'email',
      value: 'bounced@example.test',
      valueMasked: 'b***@example.test',
      status: 'bounced',
    });

    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'service_announcement',
      priority: 'normal',
      channels: ['email'],
      now: new Date('2026-07-07T17:00:00.000Z'),
    });

    expect(decisions).toEqual([
      {
        channel: 'email',
        decision: 'suppress',
        destination: {
          type: 'email',
          contactPointId: email.id,
          valueMasked: 'b***@example.test',
        },
        suppression: { reason: 'contact_point_bounced', channel: 'email' },
      },
    ]);
  });

  it('keeps locked security email enabled despite an explicit user opt-out', async () => {
    const userId = await seedUserWithHub(db, schema, 'PreferenceSecurityLocked');
    const email = await seedContactPoint(userId, {
      type: 'email',
      value: 'security@example.test',
      valueMasked: 's***@example.test',
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      categories: { security: { email: false } },
    });

    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'security',
      priority: 'normal',
      channels: ['email'],
      now: new Date('2026-07-07T17:00:00.000Z'),
    });

    expect(decisions).toEqual([
      {
        channel: 'email',
        decision: 'send',
        destination: {
          type: 'email',
          contactPointId: email.id,
          valueMasked: 's***@example.test',
        },
      },
    ]);
  });

  it('suppresses external delivery when the user opted out of that category channel', async () => {
    const userId = await seedUserWithHub(db, schema, 'PreferenceOptOut');
    await seedContactPoint(userId, {
      type: 'email',
      value: 'opt-out@example.test',
      valueMasked: 'o***@example.test',
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      categories: { service_announcement: { email: false } },
    });

    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'service_announcement',
      priority: 'normal',
      channels: ['web', 'email'],
      now: new Date('2026-07-07T17:00:00.000Z'),
    });

    expect(decisions).toEqual([
      { channel: 'web', decision: 'send', destination: { type: 'in_app' } },
      {
        channel: 'email',
        decision: 'suppress',
        destination: null,
        suppression: { reason: 'user_disabled_channel', channel: 'email' },
      },
    ]);
  });
});

async function seedContactPoint(
  userId: string,
  overrides: Partial<typeof schema.contactPoint.$inferInsert>,
): Promise<{ readonly id: string }> {
  return one(
    await db
      .insert(schema.contactPoint)
      .values({
        userId,
        type: 'email',
        value: 'user@example.test',
        valueNormalized: overrides.value ?? 'user@example.test',
        valueMasked: 'u***@example.test',
        status: 'active',
        primary: true,
        verifiedAt: new Date('2026-07-07T17:00:00.000Z'),
        ...overrides,
      })
      .returning({ id: schema.contactPoint.id }),
  );
}
