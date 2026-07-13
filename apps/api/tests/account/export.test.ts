import { strFromU8, unzipSync } from 'fflate';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { AccountExportScope } from '@docket/types';

import {
  addMember,
  captureOutbox,
  getDb,
  one,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';

const NOW = '2026-02-01T00:00:00.000Z';

/** The migrated db module, the lazily-imported export module, and the capture-mailer outbox. */
async function setup() {
  const schema = await getDb();
  const exportMod = await import('../../src/account/export');
  const { buildExportArchive } = await import('../../src/account/archive');
  return { schema, db: schema.db, ...exportMod, buildExportArchive, outbox: await captureOutbox() };
}

beforeAll(async () => {
  await setup(); // migrate + import once up front
});

describe('collectAccountExport', () => {
  it('normalizes legacy export jobs to the full persisted scope', async () => {
    const { exportScope, FULL_ACCOUNT_EXPORT_SCOPE } = await setup();

    expect(exportScope(null)).toEqual(FULL_ACCOUNT_EXPORT_SCOPE);
    expect(
      exportScope({
        categories: ['personal'],
        workspaces: [],
        allWorkspaces: false,
      }),
    ).toEqual({
      categories: ['personal'],
      workspaces: [],
      allWorkspaces: false,
    });
  });

  it('captures the user identity and their cross-org personal rows', async () => {
    const { db, schema, collectAccountExport } = await setup();
    const userId = await seedUserWithHub(db, schema, 'Ivy');
    await db.insert(schema.notification).values({ userId, type: 'mention', body: {} as never });

    const { document, user: userRow } = await collectAccountExport(db, userId);
    const doc = document as unknown as {
      identity: { user: { id: string } | null };
      personal: { notifications: unknown[] };
    };
    expect(doc.identity.user?.id).toBe(userId);
    expect(userRow?.id).toBe(userId);
    expect(doc.personal.notifications).toHaveLength(1);
  });

  it('omits unselected account and workspace files from a personal-only export', async () => {
    const { db, schema, buildExportArchive, collectAccountExport } = await setup();
    const userId = await seedUserWithHub(db, schema, 'Selective');
    const { document } = await collectAccountExport(db, userId, {
      categories: ['personal'],
      workspaces: [],
      allWorkspaces: false,
    });

    expect(document.identity).toBeNull();
    expect(document.memberships).toEqual([]);
    expect(document.personal).not.toBeNull();

    const files = unzipSync(
      buildExportArchive(document, {
        generatedAt: NOW,
        expiresAt: '2026-02-15T00:00:00.000Z',
        name: 'Selective',
        email: 'ada@example.com',
      }),
    );
    expect(Object.keys(files).sort()).toEqual(['README.md', 'manifest.json', 'personal.json']);
    expect(strFromU8(files['README.md']!)).toContain('the data you selected');
  });

  it('omits a workspace when the membership is suspended before the worker collects it', async () => {
    const { db, schema, collectAccountExport } = await setup();
    const userId = await seedUserWithHub(db, schema, 'Suspended');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);
    const scope: AccountExportScope = {
      categories: ['workspaces'],
      workspaces: [{ id: orgId, name: 'Former workspace' }],
      allWorkspaces: false,
    };

    expect((await collectAccountExport(db, userId, scope)).document.memberships).toHaveLength(1);
    await db.update(schema.actor).set({ status: 'suspended' }).where(eq(schema.actor.id, actorId));
    expect((await collectAccountExport(db, userId, scope)).document.memberships).toEqual([]);
  });
});

describe('sweepAccountExports', () => {
  it('does not resolve blob storage when there are no pending jobs', async () => {
    const { db, sweepAccountExports } = await setup();
    const resolveBlob = vi.fn(() => {
      throw new Error('blob storage is not configured');
    });

    const result = await sweepAccountExports(db, NOW, resolveBlob);

    expect(result.generated).toBe(0);
    expect(result.failed).toBe(0);
    expect(resolveBlob).not.toHaveBeenCalled();
  });

  it('records a pending job as failed when blob storage is unavailable', async () => {
    const { db, schema, sweepAccountExports } = await setup();
    const userId = await seedUserWithHub(db, schema, 'MissingBlob');
    const job = one(
      await db
        .insert(schema.accountExport)
        .values({ userId })
        .returning({ id: schema.accountExport.id }),
    );

    const result = await sweepAccountExports(db, NOW, () => {
      throw new Error('blob storage is not configured');
    });

    expect(result.failed).toBeGreaterThanOrEqual(1);
    const row = one(
      await db.select().from(schema.accountExport).where(eq(schema.accountExport.id, job.id)),
    );
    expect(row).toMatchObject({
      status: 'failed',
      error: 'blob storage is not configured',
    });
  });

  it('generates a pending export to blob storage and emails the link', async () => {
    const { db, schema, sweepAccountExports, outbox } = await setup();
    const userId = await seedUserWithHub(db, schema, 'Ready');
    const [user] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    const email = user?.email ?? '';
    const job = one(
      await db
        .insert(schema.accountExport)
        .values({ userId })
        .returning({ id: schema.accountExport.id }),
    );

    const result = await sweepAccountExports(db, NOW);
    expect(result.generated).toBeGreaterThanOrEqual(1);

    const row = one(
      await db.select().from(schema.accountExport).where(eq(schema.accountExport.id, job.id)),
    );
    expect(row.status).toBe('ready');
    expect(row.blobKey).toContain(`exports/account/${userId}/`);
    expect(row.expiresAt).not.toBeNull();
    expect(outbox.some((m) => m.to === email && m.subject.includes('export'))).toBe(true);

    const sent = outbox.find((m) => m.to === email && m.subject.includes('export'));
    if (!sent) throw new Error('Expected export-ready email');
    expect(sent.text).toContain(`/exports/${job.id}`);
    expect(sent.text).not.toContain(`/file`);
    const intent = await notificationIntentForSubject(schema, sent.subject, userId);
    expect(intent).toMatchObject({
      senderType: 'system',
      category: 'account',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['web', 'email'],
      status: 'sent',
      createdBy: 'system',
    });
    const deliveries = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.notificationId, intent.id));
    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'web', status: 'sent' }),
        expect.objectContaining({ channel: 'email', status: 'sent' }),
      ]),
    );
  });

  it('expires a ready export whose link TTL has elapsed', async () => {
    const { db, schema, sweepAccountExports } = await setup();
    const userId = await seedUserWithHub(db, schema, 'Old');
    const job = one(
      await db
        .insert(schema.accountExport)
        .values({
          userId,
          status: 'ready',
          blobKey: 'exports/account/x/1.json',
          readyAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2026-01-10T00:00:00.000Z'),
        })
        .returning({ id: schema.accountExport.id }),
    );

    const result = await sweepAccountExports(db, NOW);
    expect(result.expired).toBeGreaterThanOrEqual(1);
    const row = one(
      await db
        .select({ status: schema.accountExport.status })
        .from(schema.accountExport)
        .where(eq(schema.accountExport.id, job.id)),
    );
    expect(row.status).toBe('expired');
  });
});

async function notificationIntentForSubject(
  schema: Awaited<ReturnType<typeof getDb>>,
  subject: string,
  userId: string,
) {
  const intents = await schema.db
    .select()
    .from(schema.notificationIntent)
    .where(eq(schema.notificationIntent.subject, subject));
  const intent = intents.find((row) => {
    const audience = row.audience as { readonly type?: string; readonly userId?: string };
    return audience.type === 'user' && audience.userId === userId;
  });
  if (!intent) throw new Error(`Expected notification intent for ${subject}`);
  return intent;
}
