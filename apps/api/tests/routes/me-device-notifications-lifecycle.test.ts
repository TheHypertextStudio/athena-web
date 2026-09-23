import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type {
  DeviceNotificationDeleteOut,
  DeviceNotificationDeletionsOut,
  DeviceNotificationListOut,
} from '@docket/athena/device-notification-contract';
import { eq } from 'drizzle-orm';

import { sweepExpiredDeviceNotifications } from '../../src/services/device-notifications/expiry';
import {
  UPLOAD_BATCH_LIMIT,
  UPLOAD_WINDOW_MILLISECONDS,
} from '../../src/services/device-notifications/upload-window';
import {
  DAY,
  JSON_HEADERS,
  type DeviceApp,
  deviceNotificationDb,
  notificationItem,
  registerDevice,
  removalItem,
  seedDevicePerson,
  ulid,
  upload,
  uploadRaw,
} from '../support/device-notifications';
import { composedV1App } from '../support/routes-harness';

let schema!: typeof DbModule;

beforeAll(async () => {
  schema = await deviceNotificationDb();
});

/** Count a hub's rows in one of the device-notification tables. */
async function countRows(
  table:
    | typeof DbModule.deviceNotification
    | typeof DbModule.deviceNotificationMessage
    | typeof DbModule.deviceNotificationRemoval
    | typeof DbModule.deviceNotificationSource,
  hubId: string,
): Promise<number> {
  const rows = await schema.db
    .select({ hubId: table.hubId })
    .from(table)
    .where(eq(table.hubId, hubId));
  return rows.length;
}

async function list(app: DeviceApp, query = ''): Promise<DeviceNotificationListOut> {
  const res = await app.request(`/me/device-notifications${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as DeviceNotificationListOut;
}

async function deletions(app: DeviceApp): Promise<DeviceNotificationDeletionsOut> {
  return (await (
    await app.request('/me/device-notifications/deletions')
  ).json()) as DeviceNotificationDeletionsOut;
}

describe('DELETE /v1/me/device-notifications and GET …/deletions', () => {
  it('starts with no deletions', async () => {
    const { app } = await seedDevicePerson();
    expect(await deletions(app)).toEqual({ deletedBefore: null, apps: [] });
  });

  it('deletes one app, then everything, with their messages and removals', async () => {
    const { app, hubId } = await seedDevicePerson();
    const phone = await registerDevice(app);
    const tablet = await registerDevice(app);
    const gmail = notificationItem({
      kind: 'message',
      messages: [
        { id: ulid(), threadId: 't', sender: null, sentAt: 1, text: 'hi', identity: 'gm-1' },
      ],
    });
    const chat = notificationItem({ appId: 'com.whatsapp', appName: 'WhatsApp' });
    await upload(app, phone, [gmail], [removalItem(gmail.id)]);
    await upload(app, tablet, [chat]);

    const one = await app.request('/me/device-notifications?appId=com.google.android.gm', {
      method: 'DELETE',
    });
    expect((await one.json()) as DeviceNotificationDeleteOut).toEqual({ deleted: 1 });
    expect(await countRows(schema.deviceNotificationMessage, hubId)).toBe(0);
    expect(await countRows(schema.deviceNotificationRemoval, hubId)).toBe(0);
    const afterApp = await deletions(app);
    expect(afterApp.deletedBefore).toBeNull();
    expect(afterApp.apps.map((entry) => entry.appId)).toEqual(['com.google.android.gm']);

    const all = await app.request('/me/device-notifications', { method: 'DELETE' });
    expect((await all.json()) as DeviceNotificationDeleteOut).toEqual({ deleted: 1 });
    const first = await deletions(app);
    expect(first.deletedBefore).toEqual(expect.any(Number));
    // A second delete moves the time forward on the same row.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await app.request('/me/device-notifications', { method: 'DELETE' });
    const second = await deletions(app);
    expect(second.deletedBefore).toBeGreaterThan(first.deletedBefore ?? 0);
    expect(second.apps).toHaveLength(1);
    // Devices stay registered; only their uploads were deleted.
    expect(await countRows(schema.deviceNotificationSource, hubId)).toBe(2);
    expect(await countRows(schema.deviceNotification, hubId)).toBe(0);
  });
});

describe('GET /v1/me/device-notifications', () => {
  it('pages newest capture first and filters by app', async () => {
    const { app } = await seedDevicePerson();
    const deviceId = await registerDevice(app);
    const now = Date.now();
    const [oldest, middle, newest] = [3, 2, 1].map((minutes) =>
      notificationItem({ capturedAt: now - minutes * 60_000 }),
    );
    const items = [oldest, middle, newest].flatMap((item) => (item ? [item] : []));
    const other = notificationItem({ appId: 'com.whatsapp', capturedAt: now - 30_000 });
    expect(items).toHaveLength(3);
    await upload(app, deviceId, [...items, other]);

    const page1 = await list(app, '?limit=2');
    expect(page1.items.map((item) => item.id)).toEqual([other.id, newest?.id]);
    expect(page1.nextCursor).toEqual(expect.any(String));
    const page2 = await list(app, `?limit=2&cursor=${page1.nextCursor ?? ''}`);
    expect(page2.items.map((item) => item.id)).toEqual([middle?.id, oldest?.id]);
    expect(page2.nextCursor).toBeNull();

    const gmail = await list(app, '?appId=com.whatsapp');
    expect(gmail.items.map((item) => item.id)).toEqual([other.id]);
  });

  it('rejects a malformed cursor and an oversized limit', async () => {
    const { app } = await seedDevicePerson();
    expect((await app.request('/me/device-notifications?cursor=%%%')).status).toBe(422);
    expect((await app.request('/me/device-notifications?limit=201')).status).toBe(422);
  });
});

describe('expiry', () => {
  it('leaves expired rows out of the list and deletes them on the next upload', async () => {
    const { app, hubId } = await seedDevicePerson();
    const deviceId = await registerDevice(app, { retentionDays: 1 });
    const item = notificationItem({ capturedAt: Date.now() - DAY + 60_000 });
    await upload(app, deviceId, [item]);
    // Age the stored row past its expiry.
    await schema.db
      .update(schema.deviceNotification)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.deviceNotification.hubId, hubId));
    expect((await list(app)).items).toEqual([]);
    expect(await countRows(schema.deviceNotification, hubId)).toBe(1);
    await upload(app, deviceId, []);
    expect(await countRows(schema.deviceNotification, hubId)).toBe(0);
  });

  it('sweeps every person’s expired rows from the daily cron tick', async () => {
    const { app, hubId } = await seedDevicePerson();
    const deviceId = await registerDevice(app);
    const fresh = notificationItem();
    const stale = notificationItem();
    await upload(app, deviceId, [fresh, stale], [removalItem(stale.id)]);
    await schema.db
      .update(schema.deviceNotification)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.deviceNotification.id, stale.id));
    const result = await sweepExpiredDeviceNotifications(new Date());
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    const remaining = await list(app);
    expect(remaining.items.map((item) => item.id)).toEqual([fresh.id]);
    expect(await countRows(schema.deviceNotificationRemoval, hubId)).toBe(0);
  });
});

describe('account deletion', () => {
  it('removes every synced row with the person', async () => {
    const { app, hubId, userId } = await seedDevicePerson();
    const deviceId = await registerDevice(app);
    const item = notificationItem({
      messages: [{ id: ulid(), threadId: 't', sender: 'A', sentAt: 1, text: 'x', identity: 'i' }],
    });
    await upload(app, deviceId, [item], [removalItem(item.id)]);
    await app.request('/me/device-notifications?appId=com.example', { method: 'DELETE' });
    await schema.db.delete(schema.user).where(eq(schema.user.id, userId));
    for (const table of [
      schema.deviceNotificationSource,
      schema.deviceNotification,
      schema.deviceNotificationMessage,
      schema.deviceNotificationRemoval,
    ]) {
      expect(await countRows(table, hubId)).toBe(0);
    }
    const tombstones = await schema.db
      .select()
      .from(schema.deviceNotificationDeletion)
      .where(eq(schema.deviceNotificationDeletion.hubId, hubId));
    expect(tombstones).toEqual([]);
  });
});

describe('upload limits', () => {
  it('answers 429 with Retry-After once the hourly window is full', async () => {
    const { app, hubId } = await seedDevicePerson();
    const deviceId = await registerDevice(app);
    const startedAt = new Date(Date.now() - 10 * 60_000);
    await schema.db.insert(schema.deviceNotificationUploadWindow).values({
      hubId,
      windowStartedAt: startedAt,
      batches: UPLOAD_BATCH_LIMIT,
    });
    const limited = await uploadRaw(app, deviceId, [notificationItem()]);
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(40 * 60);
    expect(retryAfter).toBeLessThanOrEqual(UPLOAD_WINDOW_MILLISECONDS / 1_000);
    expect(await countRows(schema.deviceNotification, hubId)).toBe(0);

    // A window that has run out resets.
    await schema.db
      .update(schema.deviceNotificationUploadWindow)
      .set({ windowStartedAt: new Date(Date.now() - UPLOAD_WINDOW_MILLISECONDS - 1) })
      .where(eq(schema.deviceNotificationUploadWindow.hubId, hubId));
    expect((await uploadRaw(app, deviceId, [notificationItem()])).status).toBe(200);
  });

  it('answers 413 for a body over the batch limit, before reading it', async () => {
    const app = await composedV1App();
    const res = await app.request('/v1/me/device-notifications/batches', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ deviceId: ulid(), notifications: ['x'.repeat(9 * 1024 * 1024)] }),
    });
    expect(res.status).toBe(413);
  });

  it('answers 401 without a session', async () => {
    const app = await composedV1App();
    for (const [method, path] of [
      ['PUT', `/me/device-notification-sources/${ulid()}`],
      ['POST', '/me/device-notifications/batches'],
      ['GET', '/me/device-notifications/deletions'],
      ['GET', '/me/device-notifications'],
      ['DELETE', '/me/device-notifications'],
    ] as const) {
      const res = await app.request(`/v1${path}`, {
        method,
        headers: JSON_HEADERS,
        ...(method === 'PUT' || method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});
