import { CaptureMailer } from '@docket/mail';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as DigestModule from '../../src/routes/daily-digest';
import { getDb, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let sweepDailyDigests!: typeof DigestModule.sweepDailyDigests;
let outbox!: CaptureMailer['outbox'];

/** A fixed reference time: 20:00 UTC, past an 18:00 send time. */
const NOW = new Date('2026-06-28T20:00:00.000Z');
/** Before any reasonable send time: 08:00 UTC. */
const EARLY = new Date('2026-06-28T08:00:00.000Z');

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  sweepDailyDigests = (await import('../../src/routes/daily-digest')).sweepDailyDigests;
  // The container's mailer is the in-memory CaptureMailer under APP_MODE=test.
  const { getContainer } = await import('../../src/container');
  const mailer = getContainer().mailer;
  if (!(mailer instanceof CaptureMailer)) throw new Error('expected the capture mailer in tests');
  outbox = mailer.outbox;
});

let seq = 0;

/** Seed a user + a Hub with digest preferences; returns the user id + email. */
async function seedDigestUser(opts: {
  enabled: boolean;
  sendAt?: string;
  tz?: string;
}): Promise<{ userId: string; email: string }> {
  seq += 1;
  const email = `digest-${String(seq)}@example.com`;
  const [u] = await db
    .insert(schema.user)
    .values({ name: `User ${String(seq)}`, email })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({
    userId: u!.id,
    preferences: {
      timezone: opts.tz ?? 'UTC',
      digest: { enabled: opts.enabled, sendAtLocalTime: opts.sendAt ?? '18:00' },
    },
  });
  return { userId: u!.id, email };
}

/** Seed one event attributed to `userId`, occurring earlier on the reference day. */
async function seedEvent(orgId: string, userId: string, title: string): Promise<void> {
  seq += 1;
  await db.insert(schema.event).values({
    organizationId: orgId,
    userId,
    sourceSystem: 'linear',
    kind: 'created',
    occurredAt: new Date('2026-06-28T09:00:00.000Z'),
    title,
    dedupeKey: `obs-${String(seq)}`,
  });
}

describe('sweepDailyDigests (the hero feature)', () => {
  it('generates, persists, and emails a digest for a due opted-in user with activity', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId, email } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });
    await seedEvent(orgId, userId, 'Created issue: Ship it');
    await seedEvent(orgId, userId, 'Created issue: Fix bug');

    await sweepDailyDigests(NOW);

    const [digest] = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, userId));
    expect(digest!.status).toBe('sent');
    expect(digest!.digestDate).toBe('2026-06-28');
    expect(digest!.eventCount).toBe(2);
    expect(digest!.summaryMarkdown).toBeTruthy();
    expect(digest!.summaryHtml).toBeTruthy();
    expect(digest!.stats?.total).toBe(2);

    expect(outbox.some((m) => m.to === email && m.subject.includes('digest'))).toBe(true);
  });

  it('records skipped_empty (and sends nothing) for a due user with no activity', async () => {
    const { userId, email } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });

    await sweepDailyDigests(NOW);

    const [digest] = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, userId));
    expect(digest!.status).toBe('skipped_empty');
    expect(digest!.eventCount).toBe(0);
    expect(outbox.some((m) => m.to === email)).toBe(false);
  });

  it('does not generate before the local send time has passed', async () => {
    const { userId } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });

    await sweepDailyDigests(EARLY); // 08:00 local < 18:00 send time

    const rows = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it('is idempotent: a second sweep does not create or send a second digest', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId, email } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });
    await seedEvent(orgId, userId, 'Did a thing');

    await sweepDailyDigests(NOW);
    await sweepDailyDigests(NOW);

    const rows = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, userId));
    expect(rows).toHaveLength(1);
    expect(outbox.filter((m) => m.to === email).length).toBe(1);
  });
});
