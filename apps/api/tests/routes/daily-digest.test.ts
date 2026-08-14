import { CaptureMailer } from '@docket/mail';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as DigestModule from '../../src/routes/daily-digest';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let sweepDailyDigests!: typeof DigestModule.sweepDailyDigests;
let markdownToHtml!: typeof DigestModule.markdownToHtml;
let assembleHighlightsMarkdown!: typeof DigestModule.assembleHighlightsMarkdown;
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
  assembleHighlightsMarkdown = mod.assembleHighlightsMarkdown;
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
      .values({ userId: u!.id, preferences: { digest: { enabled: true } } });
    await seedEvent(orgId, u!.id, 'Bare-preferences event');

    await sweepDailyDigests(NOW); // 20:00 UTC — past the 18:00 default in UTC.

    const [digest] = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, u!.id));
    expect(digest!.status).toBe('sent');
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
      userId: u!.id,
      preferences: { timezone: 'UTC', digest: { enabled: true, sendAtLocalTime: '18:00' } },
    });
    await seedEvent(orgId, u!.id, 'Nameless-user event');

    await sweepDailyDigests(NOW);

    const [digest] = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, u!.id));
    expect(digest!.summaryMarkdown).toContain("Here's what you did");
    expect(digest!.summaryMarkdown).not.toContain('Hi ');
  });

  it('passes an event’s summary, actor display name, and entity title through to the summarizer', async () => {
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
        docketEntityId: null,
      },
      dedupeKey: `obs-${String(seq)}`,
    });

    const { getContainer } = await import('../../src/container');
    const summarizer = getContainer().summarizer;
    const spy = vi.spyOn(summarizer, 'narrateDay');

    await sweepDailyDigests(NOW);

    expect(spy).toHaveBeenCalled();
    // The event's own detail has to survive grouping and reach the prompt: an episode narrated from
    // titles alone cannot say what actually changed.
    const narrated = spy.mock.calls
      .flatMap((args) => args[0].episodes)
      .flatMap((ep) => ep.events.map((event) => ({ subject: ep.subject, ...event })))
      .find((event) => event.title === 'Rich event');
    expect(narrated).toMatchObject({
      summary: 'A one-line summary of the change',
      actor: 'Jane Doe',
      subject: 'Ship the thing',
    });
    spy.mockRestore();
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
      expect(digest!.status).toBe('failed');
      expect(digest!.lastError).toBe('digest notification delivery failed');
    } finally {
      sendSpy.mockRestore();
    }
  });

  it('does not deliver a day it could not narrate, and says why', async () => {
    // Narration failing no longer fails the *record* — that separation is deliberate. But an email is
    // a one-shot artifact: sending "no tracked activity" for a day that had plenty would be false, so
    // the delivery is the thing that fails while the day itself stands.
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });
    await seedEvent(orgId, userId, 'Real work that went unnarrated');

    const { getContainer } = await import('../../src/container');
    const spy = vi
      .spyOn(getContainer().summarizer, 'narrateDay')
      .mockRejectedValueOnce('a plain string rejection');

    try {
      await sweepDailyDigests(NOW);

      // Asserted on this user's row rather than on the sweep's tally. The tally counts every user in
      // the database, and a failed digest is now retried by a later tick — so an earlier test's
      // failure being delivered on retry legitimately moves the global numbers without saying
      // anything about this day.
      const [digest] = await db
        .select()
        .from(schema.dailyDigest)
        .where(eq(schema.dailyDigest.userId, userId));
      expect(digest!.status).toBe('failed');
      expect(digest!.sentAt).toBeNull();
      expect(digest!.lastError).toContain('narrated');

      // The day's record survives the narration failure — that is the whole point of the split.
      const [day] = await db
        .select()
        .from(schema.activityDay)
        .where(eq(schema.activityDay.userId, userId));
      expect(day!.eventCount).toBeGreaterThan(0);
      const highlights = await db
        .select()
        .from(schema.activityHighlight)
        .where(eq(schema.activityHighlight.activityDayId, day!.id));
      expect(highlights).toHaveLength(1);
      expect(highlights[0]!.narrationState).toBe('failed');
    } finally {
      spy.mockRestore();
    }
  });

  it('tries again on a later tick after a delivery failure', async () => {
    // A `failed` digest used to be terminal: the row existed, so every later tick's insert conflicted
    // and returned "skipped", and one transient mail or model error meant that day's email was never
    // sent at all — while the events and highlights sat there intact.
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });
    await seedEvent(orgId, userId, 'Work worth reporting');

    const { getContainer } = await import('../../src/container');
    const failing = vi
      .spyOn(getContainer().mailer, 'send')
      .mockRejectedValueOnce(new Error('mail provider unavailable'));
    await sweepDailyDigests(NOW);
    failing.mockRestore();

    const [afterFailure] = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, userId));
    expect(afterFailure!.status).toBe('failed');

    // The same day, a later tick. Nothing about the day changed — only that the transient failure is
    // over.
    await sweepDailyDigests(NOW);

    const [afterRetry] = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, userId));
    expect(afterRetry!.status).toBe('sent');
    expect(afterRetry!.sentAt).not.toBeNull();
    // Still one row: the retry takes the existing claim back rather than creating a second digest.
    const all = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, userId));
    expect(all).toHaveLength(1);
  });

  it('stays silent for a day the person curated away', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId } = await seedDigestUser({ enabled: true, sendAt: '18:00', tz: 'UTC' });
    await seedEvent(orgId, userId, 'Something they chose not to report');

    // Narrate first, then drop everything — dropping every line is a decision, not a failure, and
    // the right response to it is silence rather than an empty email.
    const { reconcileDay } = await import('../../src/services/highlights/reconcile');
    const reconciled = await reconcileDay(userId, '2026-06-28', NOW);
    await db
      .update(schema.activityHighlight)
      .set({ kept: false, curatedAt: NOW })
      .where(eq(schema.activityHighlight.activityDayId, reconciled.activityDayId));

    const result = await sweepDailyDigests(NOW);

    expect(result.sent).toBe(0);
    expect(result.skippedEmpty).toBe(1);
    const [digest] = await db
      .select()
      .from(schema.dailyDigest)
      .where(eq(schema.dailyDigest.userId, userId));
    expect(digest!.status).toBe('skipped_empty');
    expect(digest!.sentAt).toBeNull();
  });
});

describe('markdownToHtml', () => {
  it('says the day is partial when a source could not be read', () => {
    // The connector-reliability invariant on the email. An email is read once and believed, so a day
    // assembled from sources that could not all be reached has to say so — otherwise an outage and a
    // day with nothing in it produce the same message and the reader cannot tell which they got.
    const one = assembleHighlightsMarkdown({
      dateLabel: 'Wednesday, August 12, 2026',
      highlights: [{ sentence: 'I shipped the beta.' }],
      unreadSources: ['github'],
    });
    expect(one).toContain('I shipped the beta.');
    expect(one).toContain('GitHub');
    // App-owned copy naming the source, never a provider's own diagnostic.
    expect(one).not.toContain('github');

    const several = assembleHighlightsMarkdown({
      dateLabel: 'Wednesday, August 12, 2026',
      highlights: [{ sentence: 'I shipped the beta.' }],
      unreadSources: ['github', 'google_calendar'],
    });
    expect(several).toContain('GitHub and Calendar');
  });

  it('adds no caveat to a day whose sources were all reachable', () => {
    // The counterpart: a complete day must read as complete, or the notice means nothing.
    const complete = assembleHighlightsMarkdown({
      dateLabel: 'Wednesday, August 12, 2026',
      highlights: [{ sentence: 'I shipped the beta.' }],
      unreadSources: [],
    });
    expect(complete).not.toContain('could not be read');
    expect(
      assembleHighlightsMarkdown({
        dateLabel: 'Wednesday, August 12, 2026',
        highlights: [{ sentence: 'I shipped the beta.' }],
      }),
    ).not.toContain('could not be read');
  });

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
