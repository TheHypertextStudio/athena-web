import type * as DbModule from '@docket/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { deliverWebNotification } from '../../../src/dispatch/adapters/web';
import { getMigratedDb } from '../../support/db';
import { seedUser } from '../../support/seed';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

async function seedIntentAndDelivery(
  userId: string,
): Promise<{ intentId: string; deliveryId: string }> {
  const [intent] = await db
    .insert(schema.notificationIntent)
    .values({
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['web'],
      subject: 'Subject',
      body: { text: 'Body' },
      createdBy: 'system',
    })
    .returning();
  const [recipient] = await db
    .insert(schema.notificationRecipient)
    .values({
      notificationId: assertDefined(intent).id,
      userId,
      organizationId: null,
      reason: 'explicit',
    })
    .returning();
  const [delivery] = await db
    .insert(schema.notificationDelivery)
    .values({
      notificationId: assertDefined(intent).id,
      recipientId: assertDefined(recipient).id,
      channel: 'web',
      destinationType: 'in_app',
      destination: { type: 'in_app' },
      status: 'sent',
    })
    .returning();
  return { intentId: assertDefined(intent).id, deliveryId: assertDefined(delivery).id };
}

describe('deliverWebNotification', () => {
  it('writes an inbox row projected from the notification content', async () => {
    const userId = await seedUser(db, schema, 'AdapterWebRow');
    const { intentId, deliveryId } = await seedIntentAndDelivery(userId);

    const row = await deliverWebNotification(db, {
      intentId,
      deliveryId,
      userId,
      organizationId: null,
      category: 'service_announcement',
      subject: 'Scheduled maintenance',
      body: { text: 'Maintenance tonight.' },
    });

    expect(row).toMatchObject({
      intentId,
      deliveryId,
      userId,
      organizationId: null,
      type: 'service_announcement',
      body: {
        title: 'Scheduled maintenance',
        summary: 'Maintenance tonight.',
        category: 'service_announcement',
      },
      readAt: null,
    });
  });

  it('threads an optional deep link url and an organization id into the projection', async () => {
    const userId = await seedUser(db, schema, 'AdapterWebRowWithUrl');
    const { intentId, deliveryId } = await seedIntentAndDelivery(userId);
    const orgId = assertDefined(
      (
        await db
          .insert(schema.organization)
          .values({ name: 'Org', slug: `org-web-${Math.random().toString(36).slice(2)}` })
          .returning({ id: schema.organization.id })
      )[0],
    ).id;

    const row = await deliverWebNotification(db, {
      intentId,
      deliveryId,
      userId,
      organizationId: orgId,
      category: 'workflow',
      subject: 'New assignment',
      body: { text: 'You were assigned a task.' },
      url: 'https://app.example.com/tasks/1',
    });

    expect(row.organizationId).toBe(orgId);
    expect(row.body).toMatchObject({ url: 'https://app.example.com/tasks/1' });
  });
});
