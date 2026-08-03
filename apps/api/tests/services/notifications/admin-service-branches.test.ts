/**
 * `services/notifications/admin-service` branch-coverage top-up (non-mocked cases).
 *
 * @remarks
 * `tests/routes/admin-notifications.test.ts` exercises the happy paths through the HTTP admin
 * router (list, one suppressed channel, all four channels rendered with both `text` and `html`).
 * This file closes the branches that suite never reaches: `preview()`'s excluded-channel and
 * missing-text/html-fallback sides, and `approve()`'s not-found/wrong-state refusals. The
 * suppression-aggregation branches (which need a hand-built `NotificationChannelDecision` the real
 * preference resolver never actually produces) live in the sibling
 * `admin-service-suppression-branches.test.ts`, which mocks the preference resolver at module
 * scope.
 */
import type * as DbModule from '@docket/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { AdminNotificationService } from '../../../src/services/notifications/admin-service';
import { NotificationIntentService } from '../../../src/services/notifications/intent-service';
import { getDb, one, seedStaffUser, seedUserWithHub } from '../../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function seedIntent(
  createdBy: string,
  subject: string,
  overrides: Partial<typeof schema.notificationIntent.$inferInsert> = {},
): Promise<{ readonly id: string }> {
  const recipientUserId = await seedUserWithHub(db, schema, `Recipient-${Math.random()}`);
  return one(
    await db
      .insert(schema.notificationIntent)
      .values({
        senderType: 'staff',
        category: 'service_announcement',
        priority: 'normal',
        audience: { type: 'user', userId: recipientUserId },
        channels: ['web'],
        subject,
        body: { text: subject },
        replyPolicy: 'none',
        status: 'draft',
        createdBy,
        ...overrides,
      })
      .returning({ id: schema.notificationIntent.id }),
  );
}

function service(): AdminNotificationService {
  return new AdminNotificationService(db, new NotificationIntentService(db));
}

describe('preview() — excluded channels and the missing-text fallback', () => {
  it('omits every channel key not requested', async () => {
    const staff = await seedStaffUser(db, schema);
    const intent = await seedIntent(staff.userId, 'Web only announcement', {
      channels: ['web'],
      body: { text: 'Only the web channel gets this.' },
    });

    const preview = await service().preview(staff.userId, intent.id);

    expect(preview).toEqual({
      subject: 'Web only announcement',
      replyPolicy: 'none',
      web: { title: 'Web only announcement', body: 'Only the web channel gets this.' },
    });
    expect(preview).not.toHaveProperty('email');
    expect(preview).not.toHaveProperty('sms');
    expect(preview).not.toHaveProperty('push');
  });

  it('strips HTML for the body text when no plain text is supplied', async () => {
    const staff = await seedStaffUser(db, schema);
    const intent = await seedIntent(staff.userId, 'HTML-only announcement', {
      channels: ['sms'],
      body: { html: '<p>Only   <strong>html</strong>   here.</p>' },
    });

    const preview = await service().preview(staff.userId, intent.id);

    expect(preview.sms).toEqual({ text: 'Docket: HTML-only announcement. Only html here.' });
    expect(preview).not.toHaveProperty('web');
    expect(preview).not.toHaveProperty('email');
    expect(preview).not.toHaveProperty('push');
  });
});

describe('approve() — refusal paths', () => {
  it('404s for an intent id that does not exist', async () => {
    const staff = await seedStaffUser(db, schema);
    await expect(service().approve(staff.userId, 'notif_missing')).rejects.toThrow(
      'Notification intent not found',
    );
  });

  it('409s when the intent is not draft or scheduled', async () => {
    const staff = await seedStaffUser(db, schema);
    const intent = await seedIntent(staff.userId, 'Already queued', { status: 'queued' });

    await expect(service().approve(staff.userId, intent.id)).rejects.toThrow(
      'Notification intent cannot be approved from its current state',
    );
  });
});
