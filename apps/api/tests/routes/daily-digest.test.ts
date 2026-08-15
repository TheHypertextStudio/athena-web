import { CaptureMailer } from '@docket/mail';
import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as DigestModule from '../../src/routes/daily-digest';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let sweepDailyDigests!: typeof DigestModule.sweepDailyDigests;
let markdownToHtml!: typeof DigestModule.markdownToHtml;
let outbox!: CaptureMailer['outbox'];

/** A fixed reference time: 20:00 UTC, past an 18:00 send time. */
const NOW = new Date('2026-06-28T20:00:00.000Z');
/** Before any reasonable send time: 08:00 UTC. */
const EARLY = new Date('2026-06-28T08:00:00.000Z');

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/daily-digest');
  sweepDailyDigests = mod.sweepDailyDigests;
  markdownToHtml = mod.markdownToHtml;
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
    userId: assertDefined(u).id,
    preferences: {
      timezone: opts.tz ?? 'UTC',
      digest: { enabled: opts.enabled, sendAtLocalTime: opts.sendAt ?? '18:00' },
    },
  });
  return { userId: assertDefined(u).id, email };
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
    expect(assertDefined(digest).status).toBe('sent');
    expect(assertDefined(digest).digestDate).toBe('2026-06-28');
    expect(assertDefined(digest).eventCount).toBe(2);
    expect(assertDefined(digest).summaryMarkdown).toBeTruthy();
    expect(assertDefined(digest).summaryHtml).toBeTruthy();
    expect(assertDefined(digest).stats?.total).toBe(2);

    expect(outbox.some((m) => m.to === email && m.subject.includes('digest'))).toBe(true);
    const sent = outbox.find((m) => m.to === email && m.subject.includes('digest'));
    if (!sent) throw new Error('Expected digest email');
    const intent = await notificationIntentForSubject(sent.subject, userId);
    expect(intent).toMatchObject({
      senderType: 'system',
      category: 'digest',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['email'],
      status: 'sent',
      createdBy: 'system',
    });
    const deliveries = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.notificationId, intent.id));
    expect(deliveries).toEqual([
      expect.objectContaining({ channel: 'email', status: 'sent', destinationType: 'email' }),
    ]);
  });

  it('records skipped_empty (and sends nothing) for a due user with no activity', async () => {
    const { userId, email } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });

    await sweepDailyDigests(NOW);

    const [digest] = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, userId));
    expect(assertDefined(digest).status).toBe('skipped_empty');
    expect(assertDefined(digest).eventCount).toBe(0);
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

  it('treats an unparseable configured send time as the default (18:00), gating generation accordingly', async () => {
    const { userId } = await seedDigestUser({ enabled: true, sendAt: 'not-a-time', tz: 'UTC' });
    // If the malformed value were not corrected to DEFAULT_SEND_MINUTES, a NaN comparison would
    // never gate anything (always false), so the digest would generate even before 18:00. Seeing
    // it correctly skip at 08:00 proves the fallback, rather than NaN-always-passes, is in effect.
    await sweepDailyDigests(EARLY);
    const rows = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it('defaults timezone to UTC and send time to 18:00 when a Hub omits both entirely', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    seq += 1;
    const email = `bare-prefs-${String(seq)}@example.com`;
    const [u] = await db
      .insert(schema.user)
      .values({ name: `Bare ${String(seq)}`, email })
      .returning({ id: schema.user.id });
    // No `timezone`, no `digest.sendAtLocalTime` — only the flag the sweep's own WHERE clause reads.
    await db
      .insert(schema.hub)
      .values({ userId: assertDefined(u).id, preferences: { digest: { enabled: true } } });
    await seedEvent(orgId, assertDefined(u).id, 'Bare-preferences event');

    await sweepDailyDigests(NOW); // 20:00 UTC — past the 18:00 default in UTC.

    const [digest] = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, assertDefined(u).id));
    expect(assertDefined(digest).status).toBe('sent');
  });

  it('omits the greeting name when the user has no name on file', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    seq += 1;
    const email = `no-name-${String(seq)}@example.com`;
    const [u] = await db
      .insert(schema.user)
      .values({ name: '', email })
      .returning({ id: schema.user.id });
    await db.insert(schema.hub).values({
      userId: assertDefined(u).id,
      preferences: { timezone: 'UTC', digest: { enabled: true, sendAtLocalTime: '18:00' } },
    });
    await seedEvent(orgId, assertDefined(u).id, 'Nameless-user event');

    await sweepDailyDigests(NOW);

    const [digest] = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, assertDefined(u).id));
    expect(assertDefined(digest).summaryMarkdown).toContain("Here's what you did");
    expect(assertDefined(digest).summaryMarkdown).not.toContain('Hi ');
  });

  it('groups one subject-day episode and delivers only its trusted narrated highlight', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });
    seq += 1;
    await db.insert(schema.event).values({
      organizationId: orgId,
      userId,
      sourceSystem: 'linear',
      kind: 'created',
      occurredAt: new Date('2026-06-28T09:00:00.000Z'),
      title: 'Rich event',
      summary: 'A one-line summary of the change',
      actor: {
        source: 'linear',
        externalId: 'ext_actor_1',
        displayName: 'Jane Doe',
        avatarUrl: null,
        docketActorId: null,
      },
      entity: {
        kind: 'work_item',
        source: 'linear',
        externalId: 'ext_entity_1',
        title: 'Ship the thing',
        url: null,
        docketEntityId: 'task_digest',
      },
      entityKind: 'work_item',
      entityAssociation: 'matched',
      docketEntityId: 'task_digest',
      dedupeKey: `obs-${String(seq)}`,
    });
    seq += 1;
    await db.insert(schema.event).values({
      organizationId: orgId,
      userId,
      sourceSystem: 'github',
      kind: 'comment',
      occurredAt: new Date('2026-06-28T16:00:00.000Z'),
      title: 'Reviewed the implementation',
      entity: {
        kind: 'work_item',
        source: 'github',
        externalId: 'pr_42',
        title: 'Ship the thing',
        url: null,
        docketEntityId: 'task_digest',
      },
      entityKind: 'work_item',
      entityAssociation: 'matched',
      docketEntityId: 'task_digest',
      dedupeKey: `obs-${String(seq)}`,
    });
    seq += 1;
    await db.insert(schema.event).values({
      organizationId: orgId,
      userId,
      sourceSystem: 'linear',
      kind: 'reaction',
      occurredAt: new Date('2026-06-28T10:00:00.000Z'),
      title: 'Reacted to the implementation',
      entity: {
        kind: 'work_item',
        source: 'linear',
        externalId: 'ext_entity_1',
        title: 'Ship the thing',
        url: null,
        docketEntityId: 'task_digest',
      },
      entityKind: 'work_item',
      entityAssociation: 'matched',
      docketEntityId: 'task_digest',
      dedupeKey: `obs-${String(seq)}`,
    });

    const { getContainer } = await import('../../src/container');
    const summarizer = getContainer().summarizer;
    const spy = vi.spyOn(summarizer, 'narrateDay').mockImplementation(async (input) => ({
      highlights: input.episodes.map((episode) => ({
        key: episode.key,
        sentence: `I trusted the narration for ${episode.subject ?? 'this activity'}.`,
      })),
    }));

    try {
      await sweepDailyDigests(NOW);

      expect(spy).toHaveBeenCalledTimes(1);
      const [input] = spy.mock.calls[0] ?? [];
      expect(input?.episodes).toMatchObject([
        {
          key: `day:2026-06-28:${orgId}:docket:task_digest`,
          provider: 'linear',
          subject: 'Ship the thing',
          startedAt: '2026-06-28T09:00:00.000Z',
          endedAt: '2026-06-28T16:00:00.000Z',
          events: [
            {
              kind: 'created',
              title: 'Rich event',
              summary: 'A one-line summary of the change',
              actor: 'Jane Doe',
            },
            { kind: 'comment', title: 'Reviewed the implementation' },
          ],
        },
      ]);

      const [digest] = await db
        .select()
        .from(schema.dailyDigest)
        .where(eq(schema.dailyDigest.userId, userId));
      expect(assertDefined(digest).summaryMarkdown).toContain(
        'I trusted the narration for Ship the thing.',
      );
      expect(assertDefined(digest).summaryMarkdown).not.toContain('Rich event');
    } finally {
      spy.mockRestore();
    }
  });

  it('passes all-minor activity to narration when an episode has no visible event', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });
    const records = [
      {
        kind: 'reaction' as const,
        occurredAt: new Date('2026-06-28T09:00:00.000Z'),
        title: 'Reacted to the timer',
      },
      {
        kind: 'timer_started' as const,
        occurredAt: new Date('2026-06-28T09:05:00.000Z'),
        title: 'Started focus time',
      },
    ];
    for (const record of records) {
      seq += 1;
      await db.insert(schema.event).values({
        organizationId: orgId,
        userId,
        sourceSystem: 'linear',
        ...record,
        entity: {
          kind: 'work_item',
          source: 'linear',
          externalId: 'minor_entity',
          title: 'Minor-only work',
          url: null,
          docketEntityId: 'task_minor',
        },
        entityKind: 'work_item',
        entityAssociation: 'matched',
        docketEntityId: 'task_minor',
        dedupeKey: `minor-${String(seq)}`,
      });
    }

    const { getContainer } = await import('../../src/container');
    const spy = vi
      .spyOn(getContainer().summarizer, 'narrateDay')
      .mockImplementation(async (input) => ({
        highlights: input.episodes.map((episode) => ({
          key: episode.key,
          sentence: 'I kept the minor activity visible.',
        })),
      }));

    try {
      await sweepDailyDigests(NOW);

      const [input] = spy.mock.calls[0] ?? [];
      expect(input?.episodes[0]?.events.map((event) => event.kind)).toEqual([
        'reaction',
        'timer_started',
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it('marks the digest failed (not thrown) when the notification fails to send', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });
    await seedEvent(orgId, userId, 'Will not be delivered');

    const { getContainer } = await import('../../src/container');
    const mailer = getContainer().mailer;
    const sendSpy = vi.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('smtp is down'));

    try {
      const result = await sweepDailyDigests(NOW);
      expect(result.failed).toBe(1);
      expect(result.sent).toBe(0);

      const [digest] = await db
        .select()
        .from(schema.dailyDigest)
        .where(eq(schema.dailyDigest.userId, userId));
      expect(assertDefined(digest).status).toBe('failed');
      expect(assertDefined(digest).lastError).toBe('digest notification delivery failed');
    } finally {
      sendSpy.mockRestore();
    }
  });

  it('records a generic error message when generation throws something other than an Error', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });
    await seedEvent(orgId, userId, 'Non-Error throw');

    const { getContainer } = await import('../../src/container');
    const summarizer = getContainer().summarizer;
    // Deliberately a non-Error rejection, to exercise the `err instanceof Error` false arm of the
    // digest's own catch block.
    const spy = vi
      .spyOn(summarizer, 'narrateDay')
      .mockRejectedValueOnce('a plain string rejection');

    try {
      const result = await sweepDailyDigests(NOW);
      expect(result.failed).toBe(1);

      const [digest] = await db
        .select()
        .from(schema.dailyDigest)
        .where(eq(schema.dailyDigest.userId, userId));
      expect(assertDefined(digest).status).toBe('failed');
      expect(assertDefined(digest).lastError).toBe('digest generation error');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('markdownToHtml', () => {
  it('closes a bullet list mid-document when a heading follows it, not only at the end', () => {
    const html = markdownToHtml('- first\n- second\n# A heading\nA paragraph.');
    expect(html).toBe(
      [
        '<ul>',
        '<li>first</li>',
        '<li>second</li>',
        '</ul>',
        '<h1>A heading</h1>',
        '<p>A paragraph.</p>',
      ].join('\n'),
    );
  });

  it('closes a trailing list at the end of the document', () => {
    const html = markdownToHtml('# Title\n\n- only item');
    expect(html).toBe(['<h1>Title</h1>', '<ul>', '<li>only item</li>', '</ul>'].join('\n'));
  });

  it('renders bold inline text and escapes HTML-significant characters', () => {
    const html = markdownToHtml('A **bold** claim about <script> & "quotes".');
    expect(html).toBe('<p>A <strong>bold</strong> claim about &lt;script&gt; &amp; "quotes".</p>');
  });

  it('skips blank lines rather than emitting empty paragraphs', () => {
    const html = markdownToHtml('First.\n\nSecond.');
    expect(html).toBe('<p>First.</p>\n<p>Second.</p>');
  });
});

async function notificationIntentForSubject(subject: string, userId: string) {
  const intents = await db
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
