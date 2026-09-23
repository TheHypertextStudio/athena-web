import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  deviceNotificationDb,
  notificationItem,
  registerDevice,
  removalItem,
  seedDevicePerson,
  ulid,
  upload,
} from '../support/device-notifications';

/** The export modules, imported after the database is migrated. */
async function exportModules() {
  const schema = await deviceNotificationDb();
  const { collectAccountExport } = await import('../../src/account/export');
  const { buildExportArchive } = await import('../../src/account/archive');
  return { db: schema.db, collectAccountExport, buildExportArchive };
}

beforeAll(async () => {
  await exportModules();
});

interface ExportedSection {
  sources: { id: string; label: string }[];
  notifications: {
    id: string;
    appId: string;
    messages: { identity: string }[];
    removal: { reason: string } | null;
  }[];
  deletions: { appId: string | null }[];
}

describe('personal.deviceNotifications in the account export', () => {
  it('carries devices, notifications with their messages and removals, and deletions', async () => {
    const { db, collectAccountExport, buildExportArchive } = await exportModules();
    const { app, userId } = await seedDevicePerson('Export');
    const deviceId = await registerDevice(app);
    const kept = notificationItem({
      kind: 'message',
      messages: [
        { id: ulid(), threadId: 't', sender: 'Ada', sentAt: 1, text: 'hi', identity: 'msg-1' },
      ],
    });
    const plain = notificationItem({ appId: 'com.whatsapp', appName: 'WhatsApp' });
    await upload(app, deviceId, [kept, plain], [removalItem(kept.id, { reason: 'opened' })]);
    await app.request('/me/device-notifications?appId=com.example', { method: 'DELETE' });

    const { document } = await collectAccountExport(db, userId);
    expect(document.schemaVersion).toBe(3);
    const section = (document.personal as { deviceNotifications: ExportedSection })
      .deviceNotifications;
    expect(section.sources.map((source) => source.id)).toEqual([deviceId]);
    const byId = new Map(section.notifications.map((row) => [row.id, row]));
    expect(byId.get(kept.id)).toMatchObject({
      messages: [{ identity: 'msg-1' }],
      removal: { reason: 'opened' },
    });
    expect(byId.get(plain.id)).toMatchObject({ messages: [], removal: null });
    expect(section.deletions.map((row) => row.appId)).toEqual(['com.example']);

    const archive = unzipSync(
      buildExportArchive(document, {
        generatedAt: '2026-09-23T00:00:00.000Z',
        expiresAt: '2026-10-07T00:00:00.000Z',
        name: 'Export',
        email: null,
      }),
    );
    const readme = strFromU8(archive['README.md'] ?? new Uint8Array());
    expect(readme).toContain('Phone notifications synced for Athena: 2');
    const personal = JSON.parse(strFromU8(archive['personal.json'] ?? new Uint8Array())) as {
      deviceNotifications: ExportedSection;
    };
    expect(personal.deviceNotifications.notifications).toHaveLength(2);
  });

  it('is empty for a person who never synced', async () => {
    const { db, collectAccountExport } = await exportModules();
    const { userId } = await seedDevicePerson('Quiet');
    const { document } = await collectAccountExport(db, userId);
    expect(
      (document.personal as { deviceNotifications: ExportedSection }).deviceNotifications,
    ).toEqual({ sources: [], notifications: [], deletions: [] });
  });
});
