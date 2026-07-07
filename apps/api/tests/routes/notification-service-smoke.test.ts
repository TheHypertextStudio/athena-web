import type * as DbModule from '@docket/db';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  appWithSession,
  captureOutbox,
  fakeSession,
  getDb,
  seedContactPoint,
  seedStaffUser,
  seedUserWithHub,
} from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let product!: unknown;
let admin!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const appModule = await import('../../src/app');
  product = appModule.app;
  admin = appModule.adminRouter;
});

const J = { 'content-type': 'application/json' };

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function unique(label: string): string {
  return `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

describe('notification service smoke', () => {
  it('runs a staff service announcement from draft through user web inbox and captured email', async () => {
    const run = unique('announcement-smoke');
    const staff = await seedStaffUser(db, schema, 'superadmin', `${run}-staff`);
    const recipientId = await seedUserWithHub(db, schema, `${run}-recipient`);
    await seedContactPoint(db, schema, staff.userId, {
      value: `${run}-staff@example.test`,
      valueMasked: 's***@example.test',
    });
    await seedContactPoint(db, schema, recipientId, {
      value: `${run}-recipient@example.test`,
      valueMasked: 'r***@example.test',
    });

    const staffProduct = appWithSession(product, fakeSession(staff.userId));
    const staffAdmin = appWithSession(admin, fakeSession(staff.userId));
    const recipientProduct = appWithSession(product, fakeSession(recipientId));
    const outbox = await captureOutbox();
    const before = outbox.length;
    const subject = `Maintenance window ${run}`;

    const createdRes = await staffProduct.request('/v1/notifications', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        senderType: 'staff',
        category: 'service_announcement',
        priority: 'normal',
        audience: { type: 'user', userId: recipientId },
        channels: ['web', 'email'],
        subject,
        body: {
          text: 'Docket will be briefly unavailable tonight.',
          html: '<p>Docket will be briefly unavailable tonight.</p>',
        },
        replyPolicy: 'staff_inbox',
        idempotencyKey: run,
      }),
    });
    expect(createdRes.status).toBe(200);
    const created = await json<{ id: string; status: string; createdBy: string }>(createdRes);
    expect(created).toMatchObject({ status: 'draft', createdBy: staff.userId });

    const testSendRes = await staffProduct.request(`/v1/notifications/${created.id}/test`, {
      method: 'POST',
    });
    expect(testSendRes.status).toBe(200);
    expect(
      await json<{
        status: string;
        recipients: { userId: string }[];
        deliveries: { channel: string; status: string }[];
      }>(testSendRes),
    ).toMatchObject({
      status: 'sent',
      recipients: [expect.objectContaining({ userId: staff.userId })],
      deliveries: expect.arrayContaining([
        expect.objectContaining({ channel: 'web', status: 'sent' }),
        expect.objectContaining({ channel: 'email', status: 'sent' }),
      ]),
    });
    expect(outbox).toHaveLength(before + 1);
    expect(outbox.at(-1)).toMatchObject({
      to: `${run}-staff@example.test`,
      subject: `[Test] ${subject}`,
    });

    const approvedRes = await staffAdmin.request(`/notifications/${created.id}/approve`, {
      method: 'POST',
    });
    expect(approvedRes.status).toBe(200);
    expect(await json<{ id: string; status: string }>(approvedRes)).toMatchObject({
      id: created.id,
      status: 'queued',
    });

    const sentRes = await staffProduct.request(`/v1/notifications/${created.id}/send`, {
      method: 'POST',
    });
    expect(sentRes.status).toBe(200);
    expect(await json<{ id: string; status: string }>(sentRes)).toMatchObject({
      id: created.id,
      status: 'sent',
    });
    expect(outbox).toHaveLength(before + 2);
    expect(outbox.at(-1)).toMatchObject({
      to: `${run}-recipient@example.test`,
      subject,
      text: 'Docket will be briefly unavailable tonight.',
    });

    const inbox = await json<{
      items: {
        type: string;
        body: {
          title: string;
          summary?: string;
          deliveryChannels?: { channel: string; status: string; valueMasked?: string }[];
        };
        readAt: string | null;
      }[];
    }>(await recipientProduct.request('/v1/me/notifications'));
    expect(inbox.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'service_announcement',
          body: expect.objectContaining({
            title: subject,
            summary: 'Docket will be briefly unavailable tonight.',
            deliveryChannels: expect.arrayContaining([
              expect.objectContaining({ channel: 'web', status: 'sent' }),
              expect.objectContaining({
                channel: 'email',
                status: 'sent',
                valueMasked: 'r***@example.test',
              }),
            ]),
          }),
          readAt: null,
        }),
      ]),
    );

    const deliveries = await json<{ items: { channel: string; status: string }[] }>(
      await staffProduct.request(`/v1/notifications/${created.id}/deliveries`),
    );
    expect(deliveries.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'web', status: 'sent' }),
        expect.objectContaining({ channel: 'email', status: 'sent' }),
      ]),
    );
  });
});
