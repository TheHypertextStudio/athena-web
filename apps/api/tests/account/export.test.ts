import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { captureOutbox, getDb, one, seedUserWithHub } from '../routes/harness.test';

const NOW = '2026-02-01T00:00:00.000Z';

/** The migrated db module, the lazily-imported export module, and the capture-mailer outbox. */
async function setup() {
  const schema = await getDb();
  const exportMod = await import('../../src/account/export');
  return { schema, db: schema.db, ...exportMod, outbox: await captureOutbox() };
}

beforeAll(async () => {
  await setup(); // migrate + import once up front
});

describe('collectAccountExport', () => {
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
});

describe('sweepAccountExports', () => {
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
