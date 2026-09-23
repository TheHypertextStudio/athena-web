/**
 * Fixtures for the device-notification sync tests: a signed-in person with a registered phone,
 * and upload items shaped exactly like the Android client's.
 */
import { genId } from '@docket/db';
import type * as DbModule from '@docket/db';
import type {
  DeviceNotificationBatchOut,
  DeviceNotificationIn,
  DeviceNotificationRemovalIn,
} from '@docket/athena/device-notification-contract';

import { appWithSession, fakeSession, getDb, seedUserWithHub } from './routes-harness';

/** Milliseconds in one day. */
export const DAY = 86_400_000;

/** A JSON content type header. */
export const JSON_HEADERS = { 'content-type': 'application/json' };

/** One mounted app for a person. */
export type DeviceApp = ReturnType<typeof appWithSession>;

/** A person with both device-notification routers mounted under `/v1/me`. */
export interface DevicePerson {
  readonly userId: string;
  readonly hubId: string;
  readonly app: DeviceApp;
}

let schema: typeof DbModule | undefined;

/** The migrated db module. */
export async function deviceNotificationDb(): Promise<typeof DbModule> {
  schema ??= await getDb();
  return schema;
}

/** Seed a person with a hub and mount the routers the way `app.ts` does. */
export async function seedDevicePerson(name = 'Ada'): Promise<DevicePerson> {
  const mod = await deviceNotificationDb();
  const { eq } = await import('drizzle-orm');
  const { meDeviceNotificationSources, meDeviceNotifications } =
    await import('../../src/routes/me-device-notifications');
  const { Hono } = await import('hono');
  const userId = await seedUserWithHub(mod.db, mod, name);
  const [hubRow] = await mod.db
    .select({ id: mod.hub.id })
    .from(mod.hub)
    .where(eq(mod.hub.userId, userId));
  if (!hubRow) throw new Error('seeded user has no hub');
  const routes = new Hono()
    .route('/me/device-notification-sources', meDeviceNotificationSources as never)
    .route('/me/device-notifications', meDeviceNotifications as never);
  return { userId, hubId: hubRow.id, app: appWithSession(routes, fakeSession(userId)) };
}

/** A fresh ULID. */
export function ulid(): string {
  return genId();
}

/** Register a device for a person; returns the device id. */
export async function registerDevice(
  app: DeviceApp,
  options: { deviceId?: string; retentionDays?: number } = {},
): Promise<string> {
  const deviceId = options.deviceId ?? ulid();
  const res = await app.request(`/me/device-notification-sources/${deviceId}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      platform: 'android',
      label: 'Pixel 11 Pro',
      retentionDays: options.retentionDays ?? 90,
      syncConsentedAt: Date.now() - DAY,
    }),
  });
  if (res.status !== 200) throw new Error(`registration failed with ${String(res.status)}`);
  return deviceId;
}

/** One notification as the Android client sends it. */
export function notificationItem(
  overrides: Partial<DeviceNotificationIn> = {},
): DeviceNotificationIn {
  const capturedAt = overrides.capturedAt ?? Date.now() - 60_000;
  return {
    id: ulid(),
    platform: 'android',
    extractorVersion: 1,
    appId: 'com.google.android.gm',
    appName: 'Gmail',
    sourceKey: '0|com.google.android.gm|42|null|10123',
    threadId: null,
    threadTitle: null,
    kind: 'email',
    postedAt: capturedAt - 100,
    capturedAt,
    title: 'Quarterly plan',
    subtitle: null,
    body: 'The draft is ready for review.',
    lines: [],
    redacted: false,
    scrubbed: false,
    backfilled: false,
    contentHash: 'sha256:abc',
    android: { channelId: 'mail', category: 'email', whenAt: capturedAt - 100, shortcutId: null },
    messages: [],
    ...overrides,
  };
}

/** One removal as the Android client sends it. */
export function removalItem(
  notificationId: string,
  overrides: Partial<DeviceNotificationRemovalIn> = {},
): DeviceNotificationRemovalIn {
  return {
    id: ulid(),
    notificationId,
    removedAt: Date.now(),
    reason: 'dismissed',
    platformReason: 2,
    ...overrides,
  };
}

/** Upload one batch and return the raw response. */
export async function uploadRaw(
  app: DeviceApp,
  deviceId: string,
  notifications: readonly unknown[],
  removals: readonly unknown[] = [],
): Promise<Response> {
  return app.request('/me/device-notifications/batches', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ deviceId, notifications, removals }),
  });
}

/** Upload one batch that must succeed and return its per-item results. */
export async function upload(
  app: DeviceApp,
  deviceId: string,
  notifications: readonly unknown[],
  removals: readonly unknown[] = [],
): Promise<DeviceNotificationBatchOut> {
  const res = await uploadRaw(app, deviceId, notifications, removals);
  if (res.status !== 200) throw new Error(`upload failed with ${String(res.status)}`);
  return (await res.json()) as DeviceNotificationBatchOut;
}
