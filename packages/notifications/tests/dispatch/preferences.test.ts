import type * as DbModule from '@docket/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { resolveNotificationPreferences } from '../../src/dispatch/preferences';
import { getMigratedDb } from '../support/db';
import { seedContactPoint, seedUser } from '../support/seed';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

describe('resolveNotificationPreferences', () => {
  it('uses default web and email delivery for service announcements', async () => {
    const userId = await seedUser(db, schema, 'PreferenceDefaultAnnouncement');
    const email = await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'default-announcement@example.test',
      valueNormalized: 'default-announcement@example.test',
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
        destination: { type: 'email', contactPointId: email.id, valueMasked: 'd***@example.test' },
      },
    ]);
    expect(Object.isFrozen(decisions)).toBe(true);
  });

  it('defaults organizationId-less resolution and uses UTC when there is no stored preference', async () => {
    const userId = await seedUser(db, schema, 'PreferenceNoRow');
    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'service_announcement',
      priority: 'normal',
      channels: ['web'],
    });
    expect(decisions).toEqual([
      { channel: 'web', decision: 'send', destination: { type: 'in_app' } },
    ]);
  });

  it('delays allowed external delivery during quiet hours', async () => {
    const userId = await seedUser(db, schema, 'PreferenceQuietHours');
    await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'quiet@example.test',
      valueNormalized: 'quiet@example.test',
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

  it('bypasses quiet hours for urgent-priority notifications', async () => {
    const userId = await seedUser(db, schema, 'PreferenceQuietHoursUrgent');
    await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'urgent@example.test',
      valueNormalized: 'urgent@example.test',
      valueMasked: 'u***@example.test',
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      timezone: 'UTC',
      quietHours: {
        enabled: true,
        start: '00:00',
        end: '00:00',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      },
      categories: { workflow: { email: true } },
    });

    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'workflow',
      priority: 'urgent',
      channels: ['email'],
      now: new Date('2026-07-06T12:00:00.000Z'), // Monday
    });

    expect(decisions[0]).toMatchObject({ channel: 'email', decision: 'send' });
  });

  it('bypasses quiet hours for a locked category even without urgent priority', async () => {
    const userId = await seedUser(db, schema, 'PreferenceQuietHoursLocked');
    await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'locked@example.test',
      valueNormalized: 'locked@example.test',
      valueMasked: 'l***@example.test',
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      timezone: 'UTC',
      quietHours: {
        enabled: true,
        start: '00:00',
        end: '00:00',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      },
    });

    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'security',
      priority: 'normal',
      channels: ['email'],
      now: new Date('2026-07-06T12:00:00.000Z'), // Monday
    });

    expect(decisions[0]).toMatchObject({ channel: 'email', decision: 'send' });
  });

  it('suppresses email when no verified contact point exists', async () => {
    const userId = await seedUser(db, schema, 'PreferenceNoContact');

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
    const userId = await seedUser(db, schema, 'PreferenceBouncedContact');
    const email = await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'bounced@example.test',
      valueNormalized: 'bounced@example.test',
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
        destination: { type: 'email', contactPointId: email.id, valueMasked: 'b***@example.test' },
        suppression: { reason: 'contact_point_bounced', channel: 'email' },
      },
    ]);
  });

  it('suppresses email when the only matching contact point unsubscribed', async () => {
    const userId = await seedUser(db, schema, 'PreferenceUnsubscribedContact');
    const email = await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'unsub@example.test',
      valueNormalized: 'unsub@example.test',
      valueMasked: 'u***@example.test',
      status: 'unsubscribed',
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
        destination: { type: 'email', contactPointId: email.id, valueMasked: 'u***@example.test' },
        suppression: { reason: 'user_unsubscribed', channel: 'email' },
      },
    ]);
  });

  it('prefers an active contact point over a bounced one for the same channel', async () => {
    const userId = await seedUser(db, schema, 'PreferenceActiveOverBounced');
    await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'bounced@example.test',
      valueNormalized: 'bounced@example.test',
      valueMasked: 'b***@example.test',
      status: 'bounced',
    });
    const active = await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'active@example.test',
      valueNormalized: 'active@example.test',
      valueMasked: 'a***@example.test',
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
        decision: 'send',
        destination: { type: 'email', contactPointId: active.id, valueMasked: 'a***@example.test' },
      },
    ]);
  });

  it('keeps locked security email enabled despite an explicit user opt-out', async () => {
    const userId = await seedUser(db, schema, 'PreferenceSecurityLocked');
    const email = await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'security@example.test',
      valueNormalized: 'security@example.test',
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
        destination: { type: 'email', contactPointId: email.id, valueMasked: 's***@example.test' },
      },
    ]);
  });

  it('suppresses external delivery when the user opted out of that category channel', async () => {
    const userId = await seedUser(db, schema, 'PreferenceOptOut');
    await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'opt-out@example.test',
      valueNormalized: 'opt-out@example.test',
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

  it('suppresses a category that disallows the channel outright (marketing)', async () => {
    const userId = await seedUser(db, schema, 'PreferenceMarketingDisallowed');

    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'marketing',
      priority: 'normal',
      channels: ['email'],
      now: new Date('2026-07-07T17:00:00.000Z'),
    });

    expect(decisions).toEqual([
      {
        channel: 'email',
        decision: 'suppress',
        destination: null,
        suppression: { reason: 'category_disallows_channel', channel: 'email' },
      },
    ]);
  });

  it('skip_user_preferences mode ignores an explicit opt-out but still applies quiet hours', async () => {
    const userId = await seedUser(db, schema, 'PreferenceSkipMode');
    await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'skip@example.test',
      valueNormalized: 'skip@example.test',
      valueMasked: 's***@example.test',
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      categories: { service_announcement: { email: false } },
    });

    const decisions = await resolveNotificationPreferences(
      db,
      {
        userId,
        category: 'service_announcement',
        priority: 'normal',
        channels: ['email'],
        now: new Date('2026-07-07T17:00:00.000Z'),
      },
      'skip_user_preferences',
    );

    expect(decisions[0]).toMatchObject({ channel: 'email', decision: 'send' });
  });

  it('resolves phone and push destinations for sms/push channels', async () => {
    const userId = await seedUser(db, schema, 'PreferencePhonePush');
    const phone = await seedContactPoint(db, schema, userId, {
      type: 'phone',
      value: '+17025550123',
      valueNormalized: '+17025550123',
      valueMasked: '+1******0123',
    });
    const push = await seedContactPoint(db, schema, userId, {
      type: 'push_token',
      value: 'push-token-1',
      valueNormalized: 'push-token-1',
      valueMasked: 'push...en-1',
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      categories: { service_announcement: { sms: true, push: true } },
    });

    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'service_announcement',
      priority: 'normal',
      channels: ['sms', 'push'],
      now: new Date('2026-07-07T17:00:00.000Z'),
    });

    expect(decisions).toEqual([
      {
        channel: 'sms',
        decision: 'send',
        destination: { type: 'phone', contactPointId: phone.id, valueMasked: '+1******0123' },
      },
      {
        channel: 'push',
        decision: 'send',
        destination: { type: 'push_token', contactPointId: push.id, valueMasked: 'push...en-1' },
      },
    ]);
  });
});
