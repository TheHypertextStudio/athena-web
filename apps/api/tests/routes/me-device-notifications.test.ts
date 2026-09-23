import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type {
  DeviceNotificationListOut,
  DeviceNotificationSourceOut,
} from '@docket/athena/device-notification-contract';
import { and, eq } from 'drizzle-orm';

import {
  DAY,
  JSON_HEADERS,
  deviceNotificationDb,
  notificationItem,
  registerDevice,
  removalItem,
  seedDevicePerson,
  ulid,
  upload,
  uploadRaw,
} from '../support/device-notifications';

let schema!: typeof DbModule;

beforeAll(async () => {
  schema = await deviceNotificationDb();
});

/** Every stored notification id for a hub. */
async function storedIds(hubId: string): Promise<string[]> {
  const rows = await schema.db
    .select({ id: schema.deviceNotification.id })
    .from(schema.deviceNotification)
    .where(eq(schema.deviceNotification.hubId, hubId));
  return rows.map((row) => row.id);
}

describe('PUT /v1/me/device-notification-sources/:deviceId', () => {
  it('registers a device, updates it in place, and reads it back', async () => {
    const { app } = await seedDevicePerson();
    const deviceId = ulid();
    const put = (retentionDays: number) =>
      app.request(`/me/device-notification-sources/${deviceId}`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          platform: 'android',
          label: 'Pixel 11 Pro',
          retentionDays,
          syncConsentedAt: 1_790_000_000_000,
        }),
      });
    const first = await put(90);
    expect(first.status).toBe(200);
    const created = (await first.json()) as DeviceNotificationSourceOut;
    expect(created).toMatchObject({
      deviceId,
      platform: 'android',
      label: 'Pixel 11 Pro',
      retentionDays: 90,
      syncConsentedAt: 1_790_000_000_000,
    });
    const updated = (await (await put(30)).json()) as DeviceNotificationSourceOut;
    expect(updated.retentionDays).toBe(30);
    expect(updated.createdAt).toBe(created.createdAt);
    const read = await app.request(`/me/device-notification-sources/${deviceId}`);
    expect((await read.json()) as DeviceNotificationSourceOut).toMatchObject({
      deviceId,
      retentionDays: 30,
    });
    const unknown = await app.request(`/me/device-notification-sources/${ulid()}`);
    expect(unknown.status).toBe(404);
  });

  it('lets two accounts register the same install as two sources', async () => {
    const ada = await seedDevicePerson('Ada');
    const grace = await seedDevicePerson('Grace');
    const deviceId = ulid();
    await registerDevice(ada.app, { deviceId, retentionDays: 30 });
    await registerDevice(grace.app, { deviceId, retentionDays: 365 });
    const rows = await schema.db
      .select()
      .from(schema.deviceNotificationSource)
      .where(eq(schema.deviceNotificationSource.id, deviceId));
    expect(rows.map((row) => row.retentionDays).sort((a, b) => a - b)).toEqual([30, 365]);
  });

  it('rejects a malformed device id and an out-of-range retention', async () => {
    const { app } = await seedDevicePerson();
    const body = JSON.stringify({
      platform: 'android',
      label: 'Pixel',
      retentionDays: 90,
      syncConsentedAt: 0,
    });
    const badId = await app.request('/me/device-notification-sources/not-a-ulid', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body,
    });
    expect(badId.status).toBe(422);
    const badRetention = await app.request(`/me/device-notification-sources/${ulid()}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...JSON.parse(body), retentionDays: 3651 }),
    });
    expect(badRetention.status).toBe(422);
  });
});

describe('POST /v1/me/device-notifications/batches', () => {
  it('stores a valid batch with its Android fields, lines, and messages', async () => {
    const { app, hubId } = await seedDevicePerson();
    const deviceId = await registerDevice(app);
    const item = notificationItem({
      kind: 'message',
      threadId: 'thread-1',
      threadTitle: 'Team',
      lines: ['first line', 'second line'],
      messages: [
        {
          id: ulid(),
          threadId: 'thread-1',
          sender: 'Ada',
          sentAt: Date.now() - 120_000,
          text: 'Shipping today',
          identity: 'thread-1|ada|1',
        },
      ],
    });
    const result = await upload(app, deviceId, [item]);
    expect(result).toEqual({ notifications: [{ id: item.id, status: 'stored' }], removals: [] });
    const list = (await (
      await app.request('/me/device-notifications')
    ).json()) as DeviceNotificationListOut;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: item.id,
      deviceId,
      capturedAt: item.capturedAt,
      lines: ['first line', 'second line'],
      android: item.android,
      messages: [{ sender: 'Ada', text: 'Shipping today', identity: 'thread-1|ada|1' }],
      removal: null,
      expiresAt: item.capturedAt + 90 * DAY,
    });
    expect(await storedIds(hubId)).toEqual([item.id]);
  });

  it('answers a repeated batch with duplicate and stores nothing twice', async () => {
    const { app, hubId } = await seedDevicePerson();
    const deviceId = await registerDevice(app);
    const first = notificationItem();
    const items = [first, notificationItem()];
    const removal = removalItem(first.id);
    await upload(app, deviceId, items, [removal]);
    const again = await upload(app, deviceId, items, [removal]);
    expect(again.notifications.map((result) => result.status)).toEqual(['duplicate', 'duplicate']);
    expect(again.removals).toEqual([{ id: removal.id, status: 'duplicate' }]);
    expect(await storedIds(hubId)).toHaveLength(2);
  });

  it('answers every item of a mixed batch in request order', async () => {
    const { app } = await seedDevicePerson();
    const deviceId = await registerDevice(app, { retentionDays: 7 });
    const stored = notificationItem();
    const expired = notificationItem({ capturedAt: Date.now() - 8 * DAY });
    const oversized = notificationItem({ body: 'x'.repeat(4001) });
    const tooManyLines = notificationItem({ lines: Array.from({ length: 51 }, () => 'line') });
    const wrongKind = { ...notificationItem(), kind: 'weather' };
    const repeated = { ...stored };
    const orphan = removalItem(ulid());
    const removal = removalItem(stored.id);
    const badRemoval = { ...removalItem(stored.id), reason: 'swiped' };
    const result = await upload(
      app,
      deviceId,
      [stored, expired, oversized, tooManyLines, wrongKind, repeated],
      [orphan, removal, badRemoval],
    );
    expect(result.notifications.map((r) => r.status)).toEqual([
      'stored',
      'expired',
      'invalid',
      'invalid',
      'invalid',
      'duplicate',
    ]);
    expect(result.notifications.map((r) => r.id)).toEqual(
      [stored, expired, oversized, tooManyLines, wrongKind, repeated].map((item) => item.id),
    );
    expect(result.removals.map((r) => r.status)).toEqual(['orphaned', 'stored', 'invalid']);
  });

  it('stores a message once per person even when several notifications repeat it', async () => {
    const { app, hubId } = await seedDevicePerson();
    const deviceId = await registerDevice(app);
    const message = (id: string) => ({
      id,
      threadId: 't',
      sender: 'Ada',
      sentAt: Date.now() - 5_000,
      text: 'hello',
      identity: 't|ada|hello',
    });
    const first = notificationItem({ kind: 'message', messages: [message(ulid())] });
    const second = notificationItem({ kind: 'message', messages: [message(ulid())] });
    const result = await upload(app, deviceId, [first, second]);
    expect(result.notifications.map((r) => r.status)).toEqual(['stored', 'stored']);
    const messages = await schema.db
      .select()
      .from(schema.deviceNotificationMessage)
      .where(eq(schema.deviceNotificationMessage.hubId, hubId));
    expect(messages.map((message) => message.notificationId)).toEqual([first.id]);
  });

  it('refuses entries captured at or before a deletion as deleted', async () => {
    const { app } = await seedDevicePerson();
    const deviceId = await registerDevice(app);
    const before = notificationItem({ capturedAt: Date.now() - 10_000 });
    const otherApp = notificationItem({
      appId: 'com.whatsapp',
      appName: 'WhatsApp',
      capturedAt: Date.now() - 10_000,
    });
    expect(
      (
        await app.request('/me/device-notifications?appId=com.google.android.gm', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(200);
    const result = await upload(app, deviceId, [before, otherApp]);
    expect(result.notifications.map((r) => r.status)).toEqual(['deleted', 'stored']);
    await app.request('/me/device-notifications', { method: 'DELETE' });
    const late = notificationItem({ appId: 'com.whatsapp', capturedAt: Date.now() - 5_000 });
    const later = notificationItem({ capturedAt: Date.now() + 5_000 });
    const after = await upload(app, deviceId, [late, later]);
    expect(after.notifications.map((r) => r.status)).toEqual(['deleted', 'stored']);
  });

  it('answers 404 for a device the caller has not registered', async () => {
    const ada = await seedDevicePerson('Ada');
    const grace = await seedDevicePerson('Grace');
    const adaDevice = await registerDevice(ada.app);
    expect((await uploadRaw(ada.app, ulid(), [notificationItem()])).status).toBe(404);
    // Another person's registered device is not the caller's.
    expect((await uploadRaw(grace.app, adaDevice, [notificationItem()])).status).toBe(404);
  });

  it('rejects a batch whose shape is malformed as a whole', async () => {
    const { app } = await seedDevicePerson();
    const deviceId = await registerDevice(app);
    const tooMany = Array.from({ length: 101 }, () => notificationItem());
    expect((await uploadRaw(app, deviceId, tooMany)).status).toBe(422);
    expect((await uploadRaw(app, deviceId, [{ title: 'no id' }])).status).toBe(422);
    const tooManyRemovals = Array.from({ length: 201 }, () => removalItem(ulid()));
    expect((await uploadRaw(app, deviceId, [], tooManyRemovals)).status).toBe(422);
  });

  it('keeps one person’s rows away from another who reuses the same ids', async () => {
    const ada = await seedDevicePerson('Ada');
    const grace = await seedDevicePerson('Grace');
    const deviceId = ulid();
    await registerDevice(ada.app, { deviceId });
    await registerDevice(grace.app, { deviceId });
    const item = notificationItem();
    expect((await upload(ada.app, deviceId, [item])).notifications).toEqual([
      { id: item.id, status: 'stored' },
    ]);
    // The same phone-minted id from another account is that account's own row, not a duplicate.
    expect((await upload(grace.app, deviceId, [item])).notifications).toEqual([
      { id: item.id, status: 'stored' },
    ]);
    // A removal cannot reach the other person's notification.
    const stranger = await seedDevicePerson('Stranger');
    const strangerDevice = await registerDevice(stranger.app);
    const removal = await upload(stranger.app, strangerDevice, [], [removalItem(item.id)]);
    expect(removal.removals.map((result) => result.status)).toEqual(['orphaned']);
    const strangerList = (await (
      await stranger.app.request('/me/device-notifications')
    ).json()) as DeviceNotificationListOut;
    expect(strangerList.items).toEqual([]);
    await stranger.app.request('/me/device-notifications', { method: 'DELETE' });
    const adaRows = await schema.db
      .select()
      .from(schema.deviceNotification)
      .where(
        and(
          eq(schema.deviceNotification.hubId, ada.hubId),
          eq(schema.deviceNotification.id, item.id),
        ),
      );
    expect(adaRows).toHaveLength(1);
  });

  it('records when the device was last seen', async () => {
    const { app, hubId } = await seedDevicePerson();
    const deviceId = await registerDevice(app);
    await schema.db
      .update(schema.deviceNotificationSource)
      .set({ lastSeenAt: new Date(0) })
      .where(eq(schema.deviceNotificationSource.hubId, hubId));
    await upload(app, deviceId, [notificationItem()]);
    const [source] = await schema.db
      .select()
      .from(schema.deviceNotificationSource)
      .where(eq(schema.deviceNotificationSource.hubId, hubId));
    expect(source?.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
