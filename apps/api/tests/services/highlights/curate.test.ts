import { asc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from '../../support/routes-harness';
import { curateHighlight } from '../../../src/services/highlights/curate';
import {
  buildHighlightsDayPayload,
  dayNeedsRefresh,
  readActivityDay,
} from '../../../src/services/highlights/read';
import { reconcileDay } from '../../../src/services/highlights/reconcile';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const DAY = '2026-08-12';
const NOW = new Date('2026-08-12T18:00:00.000Z');

let people = 0;
let seq = 0;

async function seedPerson(): Promise<{ orgId: string; userId: string }> {
  const { orgId } = await seedBaseOrg(db, schema);
  people += 1;
  const userId = one(
    await db
      .insert(schema.user)
      .values({ name: `Cur ${String(people)}`, email: `cur-${String(people)}@example.test` })
      .returning({ id: schema.user.id }),
  ).id;
  await db.insert(schema.hub).values({ userId, preferences: { timezone: 'UTC' } });
  return { orgId, userId };
}

async function seedEvent(orgId: string, userId: string, subject = 'ENG-1'): Promise<string> {
  seq += 1;
  return one(
    await db
      .insert(schema.event)
      .values({
        organizationId: orgId,
        userId,
        sourceSystem: 'github',
        kind: 'completed',
        occurredAt: new Date('2026-08-12T09:00:00.000Z'),
        title: `Event ${String(seq)}`,
        entity: {
          kind: 'work_item',
          source: 'github',
          externalId: subject,
          title: `Subject ${subject}`,
          url: null,
          docketEntityId: null,
        },
        entityKind: 'work_item',
        entityAssociation: 'pending',
        dedupeKey: `cur-${String(seq)}`,
      })
      .returning({ id: schema.event.id }),
  ).id;
}

/** A person with one narrated highlight on {@link DAY}. */
/** A connected activity integration owned by `userId`, so the source has something to report. */
async function seedActivityIntegration(
  orgId: string,
  userId: string,
  provider: 'github' | 'gmail',
  status: 'connected' | 'error' | 'disconnected' = 'connected',
): Promise<{ actorId: string; integrationId: string }> {
  const actorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Src', userId })
      .returning({ id: schema.actor.id }),
  ).id;
  const integrationId = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider,
        pattern: 'connector',
        roles: provider === 'gmail' ? ['signal'] : ['code'],
        status,
        createdBy: actorId,
      })
      .returning({ id: schema.integration.id }),
  ).id;
  return { actorId, integrationId };
}

/** One finished activity pull for an integration. */
async function seedActivityRun(
  orgId: string,
  integrationId: string,
  status: 'succeeded' | 'failed',
  finishedAt: Date,
): Promise<void> {
  await db.insert(schema.syncRun).values({
    organizationId: orgId,
    integrationId,
    purpose: 'activity_pull',
    status,
    trigger: 'scheduled',
    startedAt: finishedAt,
    finishedAt,
  });
}

async function seedNarratedDay() {
  const { orgId, userId } = await seedPerson();
  const eventId = await seedEvent(orgId, userId);
  const day = await reconcileDay(userId, DAY, NOW);
  const highlight = one(
    await db
      .select()
      .from(schema.activityHighlight)
      .where(eq(schema.activityHighlight.activityDayId, day.activityDayId))
      .orderBy(asc(schema.activityHighlight.sort)),
  );
  return { orgId, userId, eventId, highlight };
}

describe('curateHighlight', () => {
  it('drops a line and restores it, keeping the record either way', async () => {
    const { userId, highlight } = await seedNarratedDay();

    const dropped = await curateHighlight(userId, highlight.id, { kept: false }, NOW);
    expect(dropped.kept).toBe(false);
    expect(dropped.curatedAt).not.toBeNull();
    // Dropping is reversible because the row stays: the evidence is not deleted with the decision.
    expect(
      await db
        .select()
        .from(schema.activityHighlight)
        .where(eq(schema.activityHighlight.id, highlight.id)),
    ).toHaveLength(1);

    const restored = await curateHighlight(userId, highlight.id, { kept: true }, NOW);
    expect(restored.kept).toBe(true);
  });

  it('prefers a rewrite, and keeps the generated sentence to come back to', async () => {
    const { userId, highlight } = await seedNarratedDay();
    const generated = highlight.narration;

    const rewritten = await curateHighlight(
      userId,
      highlight.id,
      { narration: 'I finished the import fix.' },
      NOW,
    );
    expect(rewritten.narration.text).toBe('I finished the import fix.');
    expect(rewritten.narration.edited).toBe(true);

    const [row] = await db
      .select()
      .from(schema.activityHighlight)
      .where(eq(schema.activityHighlight.id, highlight.id));
    // The generated sentence was not overwritten, which is what makes reverting possible.
    expect(row?.narration).toBe(generated);

    const reverted = await curateHighlight(userId, highlight.id, { narration: null }, NOW);
    expect(reverted.narration.edited).toBe(false);
    expect(reverted.narration.text).toBe(generated);
  });

  it('never touches the activity log', async () => {
    // The append-only guarantee, tested rather than asserted in prose.
    const { userId, eventId, highlight } = await seedNarratedDay();
    const [before] = await db.select().from(schema.event).where(eq(schema.event.id, eventId));

    await curateHighlight(userId, highlight.id, { kept: false, narration: 'Rewritten.' }, NOW);

    const [after] = await db.select().from(schema.event).where(eq(schema.event.id, eventId));
    expect(after).toEqual(before);
  });

  it('hides a highlight that belongs to somebody else rather than refusing it', async () => {
    const { highlight } = await seedNarratedDay();
    const stranger = await seedPerson();

    // Not-found rather than forbidden: a 403 would confirm the id exists and whose day it is on.
    await expect(
      curateHighlight(stranger.userId, highlight.id, { kept: false }, NOW),
    ).rejects.toThrow(/not found/i);
  });

  it('records nothing for an empty patch', async () => {
    const { userId, highlight } = await seedNarratedDay();

    const unchanged = await curateHighlight(userId, highlight.id, {}, NOW);

    expect(unchanged.kept).toBe(true);
    expect(unchanged.curatedAt).toBeNull();
  });
});

describe('buildHighlightsDayPayload', () => {
  it('reads a narrated day with its evidence', async () => {
    const { userId, eventId } = await seedNarratedDay();

    const payload = await buildHighlightsDayPayload(userId, DAY, NOW);

    expect(payload.status).toBe('ready');
    expect(payload.date).toBe(DAY);
    expect(payload.generating).toBe(false);
    expect(payload.highlights).toHaveLength(1);
    expect(payload.highlights[0]?.narration.text).not.toBeNull();
    expect(payload.highlights[0]?.events.map((e) => e.id)).toEqual([eventId]);
  });

  it('shows a person their rewrite, not the generated line', async () => {
    const { userId, highlight } = await seedNarratedDay();
    await curateHighlight(userId, highlight.id, { narration: 'My own words.' }, NOW);

    const payload = await buildHighlightsDayPayload(userId, DAY, NOW);

    expect(payload.highlights[0]?.narration.text).toBe('My own words.');
    expect(payload.highlights[0]?.narration.edited).toBe(true);
  });

  it('still lists a dropped line, so the choice can be seen and undone', async () => {
    const { userId, highlight } = await seedNarratedDay();
    await curateHighlight(userId, highlight.id, { kept: false }, NOW);

    const payload = await buildHighlightsDayPayload(userId, DAY, NOW);

    expect(payload.highlights).toHaveLength(1);
    expect(payload.highlights[0]?.kept).toBe(false);
  });

  it('decides to rebuild only a day that would gain from it', async () => {
    // Pure, so each case is stated rather than arranged. A day nobody built must always be rebuilt —
    // that is the whole gap. Today is rebuilt once a source has gone stale, since the day is still
    // accumulating. A finished past day is left alone: it cannot gain activity, so rebuilding it
    // spends a model call reproducing what is already stored.
    const withSources = (state: 'ok' | 'stale', status: 'pending' | 'ready' | 'empty') => ({
      status,
      sources: [{ system: 'github' as const, state, lastReadAt: null, eventCount: 0 }],
    });

    expect(dayNeedsRefresh(withSources('ok', 'pending'), false)).toBe(true);
    expect(dayNeedsRefresh(withSources('ok', 'pending'), true)).toBe(true);
    expect(dayNeedsRefresh(withSources('stale', 'ready'), true)).toBe(true);
    expect(dayNeedsRefresh(withSources('stale', 'ready'), false)).toBe(false);
    expect(dayNeedsRefresh(withSources('ok', 'ready'), true)).toBe(false);
    expect(dayNeedsRefresh(withSources('ok', 'empty'), true)).toBe(false);
  });

  it('builds the day behind the read, so it is there the next time', async () => {
    // The gap this closes. `reconcileDay`'s only production caller was the digest sweep, which selects
    // Hubs with `digest.enabled = 'true'` — so for anyone who had not turned digest email on, no day
    // was ever built, the poll kept writing events nothing grouped, and every surface reported
    // `pending` forever.
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId);

    // The first read is honest about the day as it stands: nobody has built it yet.
    const first = await readActivityDay(userId, DAY, NOW);
    expect(first.status).toBe('pending');
    expect(first.highlights).toHaveLength(0);

    // The refresh it triggered is not awaited, so the read stays fast; letting the microtask queue
    // drain is what stands in for the moment between one request and the next.
    await vi.waitFor(async () => {
      const [day] = await db
        .select({ status: schema.activityDay.status })
        .from(schema.activityDay)
        .where(eq(schema.activityDay.userId, userId));
      expect(day?.status).toBe('ready');
    });

    const second = await readActivityDay(userId, DAY, NOW);
    expect(second.status).toBe('ready');
    expect(second.highlights.length).toBeGreaterThan(0);
  });

  it('does not rebuild a finished past day', async () => {
    // A day that is already built cannot gain activity, so triggering a rebuild would spend a model
    // call reproducing what is stored. Only `pending`, and a stale source on today, are worth it.
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId);
    await reconcileDay(userId, DAY, NOW);

    const [before] = await db
      .select({ reconciledAt: schema.activityDay.reconciledAt })
      .from(schema.activityDay)
      .where(eq(schema.activityDay.userId, userId));

    // Read it as a past day, from a `now` on the following day.
    await readActivityDay(userId, DAY, new Date('2026-08-13T18:00:00.000Z'));
    await Promise.resolve();

    const [after] = await db
      .select({ reconciledAt: schema.activityDay.reconciledAt })
      .from(schema.activityDay)
      .where(eq(schema.activityDay.userId, userId));
    expect(after?.reconciledAt?.toISOString()).toBe(before?.reconciledAt?.toISOString());
  });

  it('reports the most recent successful pull, not just any of them', async () => {
    // Freshness is the latest *successful* read. With several runs recorded the newest one is what
    // the day was read from, and reporting an older one would understate how current the day is —
    // the mirror of counting a failed run as a read, which would overstate it.
    const { orgId, userId } = await seedPerson();
    const { integrationId } = await seedActivityIntegration(orgId, userId, 'github');
    const older = new Date('2026-08-12T08:00:00.000Z');
    const newer = new Date('2026-08-12T11:00:00.000Z');
    await seedActivityRun(orgId, integrationId, 'succeeded', older);
    await seedActivityRun(orgId, integrationId, 'succeeded', newer);

    const payload = await buildHighlightsDayPayload(userId, DAY, NOW);

    const github = payload.sources.find((source) => source.system === 'github');
    expect(github?.lastReadAt).toBe(newer.toISOString());
    expect(github?.state).toBe('ok');
  });

  it('ends the day at real local midnight, so a DST day is not truncated', async () => {
    // The read and the reconcile have to agree about where a day ends, or the source-health counts
    // describe a different window than the episodes do. On a 25-hour day a fixed 24 hours would cut
    // the last hour out of the read's window while the reconcile kept it.
    const { orgId } = await seedBaseOrg(db, schema);
    people += 1;
    const userId = one(
      await db
        .insert(schema.user)
        .values({ name: `Dst ${String(people)}`, email: `dst-${String(people)}@example.test` })
        .returning({ id: schema.user.id }),
    ).id;
    await db.insert(schema.hub).values({ userId, preferences: { timezone: 'America/New_York' } });

    // 2026-11-01 in New York runs 04:00Z to 05:00Z the next day — 25 hours, because the clocks go
    // back. A `start + 24h` window ends at 04:00Z, so this event at 04:30Z falls in the hour that
    // only the correct boundary includes. Placed inside that gap deliberately: anywhere else and the
    // test passes against both the fixed and the broken version.
    seq += 1;
    await db.insert(schema.event).values({
      organizationId: orgId,
      userId,
      sourceSystem: 'github',
      kind: 'completed',
      occurredAt: new Date('2026-11-02T04:30:00.000Z'),
      title: 'Late on a long day',
      entityAssociation: 'unmatched',
      dedupeKey: `dst-${String(seq)}`,
    });

    await reconcileDay(userId, '2026-11-01', new Date('2026-11-02T12:00:00.000Z'));
    const payload = await buildHighlightsDayPayload(
      userId,
      '2026-11-01',
      new Date('2026-11-02T12:00:00.000Z'),
    );

    expect(payload.highlights.length).toBeGreaterThan(0);
    expect(payload.sources.find((source) => source.system === 'github')?.eventCount).toBe(1);
  });

  it('reports a day nobody has built as pending, not as empty', async () => {
    // These are different facts and must not look alike: one means "not looked at yet", the other
    // means "looked at, and there was nothing".
    const { userId } = await seedPerson();

    const payload = await buildHighlightsDayPayload(userId, DAY, NOW);

    expect(payload.status).toBe('pending');
    expect(payload.highlights).toEqual([]);
  });

  it('refuses a day that has not happened, rather than calling it quiet', async () => {
    // The finding this pins: the refusal used to live in the HTTP route only, so the agent tool —
    // which reads the same builder — answered "nothing happened" for tomorrow. An empty day and an
    // impossible day are different facts, and every caller needs them kept apart.
    const { userId } = await seedPerson();

    await expect(buildHighlightsDayPayload(userId, '2026-08-13', NOW)).rejects.toThrow(
      /has not happened/i,
    );
  });

  it('still reads a day already past', async () => {
    const { userId } = await seedPerson();
    const payload = await buildHighlightsDayPayload(userId, '2026-08-11', NOW);
    expect(payload.date).toBe('2026-08-11');
  });

  it('falls back to UTC for a hub that has never set a timezone', async () => {
    // A hub's `preferences` defaults to `{}`, so a person who has not been through the timezone step
    // has none. The day still has to resolve to *some* boundary rather than throwing, and UTC is the
    // only defensible default \u2014 guessing from a request header would make the same person's day
    // shift depending on where they opened it from.
    const { orgId } = await seedBaseOrg(db, schema);
    people += 1;
    const userId = one(
      await db
        .insert(schema.user)
        .values({ name: `NoTz ${String(people)}`, email: `notz-${String(people)}@example.test` })
        .returning({ id: schema.user.id }),
    ).id;
    await db.insert(schema.hub).values({ userId });
    void orgId;

    const payload = await buildHighlightsDayPayload(userId, DAY, NOW);

    expect(payload.timezone).toBe('UTC');
    expect(payload.date).toBe(DAY);
  });

  it('reports a genuinely quiet day as empty', async () => {
    const { userId } = await seedPerson();
    await reconcileDay(userId, DAY, NOW);

    expect((await buildHighlightsDayPayload(userId, DAY, NOW)).status).toBe('empty');
  });

  it('accounts for every source, and never with provider text', async () => {
    const { userId } = await seedNarratedDay();

    const payload = await buildHighlightsDayPayload(userId, DAY, NOW);

    // A day where a source could not be read must be distinguishable from a quiet one, so each
    // source reports a state — and the states are Docket's own vocabulary, not a provider's message.
    expect(payload.sources.length).toBeGreaterThan(0);
    for (const source of payload.sources) {
      expect(['ok', 'never_connected', 'stale', 'failed', 'disconnected']).toContain(source.state);
    }
    expect(payload.sources.some((source) => source.system === 'google_calendar')).toBe(true);
    expect(JSON.stringify(payload.sources)).not.toContain('lastError');
  });

  it('says a source is ok once it has been read inside the day', async () => {
    // The counterpart to the stale case: a successful pull that finished after the day began is what
    // earns `ok`, and it is the only state that claims the day is complete for that source.
    const { orgId, userId } = await seedPerson();
    const { integrationId } = await seedActivityIntegration(orgId, userId, 'github');
    const insideDay = new Date('2026-08-12T10:00:00.000Z');
    await seedActivityRun(orgId, integrationId, 'succeeded', insideDay);

    const payload = await buildHighlightsDayPayload(userId, DAY, NOW);

    const github = payload.sources.find((source) => source.system === 'github');
    expect(github?.state).toBe('ok');
    expect(github?.lastReadAt).toBe(insideDay.toISOString());
  });

  it('does not count a failed pull as having read the day', async () => {
    // A failed run is not a read. Counting one would let a source that never answered report `ok`,
    // which is the precise way a broken connector comes to look like a quiet day.
    const { orgId, userId } = await seedPerson();
    const { integrationId } = await seedActivityIntegration(orgId, userId, 'github');
    await seedActivityRun(orgId, integrationId, 'failed', new Date('2026-08-12T10:00:00.000Z'));

    const payload = await buildHighlightsDayPayload(userId, DAY, NOW);

    const github = payload.sources.find((source) => source.system === 'github');
    expect(github?.state).toBe('stale');
    expect(github?.lastReadAt).toBeNull();
  });

  it('reports an integration in error as failed rather than merely stale', async () => {
    const { orgId, userId } = await seedPerson();
    await seedActivityIntegration(orgId, userId, 'github', 'error');

    const payload = await buildHighlightsDayPayload(userId, DAY, NOW);

    expect(payload.sources.find((source) => source.system === 'github')?.state).toBe('failed');
  });

  it('separates a calendar that was disconnected from one never connected', async () => {
    // Two different facts with two different remedies: reconnect, versus connect for the first time.
    // Collapsing them would tell somebody to set up a calendar they already had.
    const neverConnected = await seedPerson();
    expect(
      (await buildHighlightsDayPayload(neverConnected.userId, DAY, NOW)).sources.find(
        (source) => source.system === 'google_calendar',
      )?.state,
    ).toBe('never_connected');

    const wasConnected = await seedPerson();
    await db.insert(schema.account).values({
      userId: wasConnected.userId,
      providerId: 'google',
      accountId: 'gone-1',
    });
    await db.insert(schema.calendarConnection).values({
      userId: wasConnected.userId,
      provider: 'google',
      externalAccountId: 'gone-1',
      status: 'disconnected',
    });

    expect(
      (await buildHighlightsDayPayload(wasConnected.userId, DAY, NOW)).sources.find(
        (source) => source.system === 'google_calendar',
      )?.state,
    ).toBe('disconnected');
  });

  it('takes the calendar’s freshness from the most recent of several connections', async () => {
    // Calendar activity is projected from synced rows, so its freshness is the calendar sync's. With
    // two connections the newer sync is what the day was read from.
    const { userId } = await seedPerson();
    const older = new Date('2026-08-12T08:00:00.000Z');
    const newer = new Date('2026-08-12T11:00:00.000Z');
    for (const [index, syncedAt] of [older, newer].entries()) {
      await db.insert(schema.account).values({
        userId,
        providerId: 'google',
        accountId: `multi-${String(index)}`,
      });
      await db.insert(schema.calendarConnection).values({
        userId,
        provider: 'google',
        externalAccountId: `multi-${String(index)}`,
        status: 'connected',
        lastSyncedAt: syncedAt,
      });
    }

    const calendar = (await buildHighlightsDayPayload(userId, DAY, NOW)).sources.find(
      (source) => source.system === 'google_calendar',
    );
    expect(calendar?.state).toBe('ok');
    expect(calendar?.lastReadAt).toBe(newer.toISOString());
  });

  it('says a connected source is stale until it has actually been read', async () => {
    const { orgId, userId } = await seedPerson();
    const actorId = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Cur', userId })
        .returning({ id: schema.actor.id }),
    ).id;
    await db.insert(schema.integration).values({
      organizationId: orgId,
      provider: 'github',
      pattern: 'connector',
      roles: ['code'],
      status: 'connected',
      createdBy: actorId,
    });

    const payload = await buildHighlightsDayPayload(userId, DAY, NOW);

    const github = payload.sources.find((source) => source.system === 'github');
    // Connected but never read for this day: claiming `ok` here would be claiming completeness the
    // day does not have.
    expect(github?.state).toBe('stale');
    expect(github?.lastReadAt).toBeNull();
  });
});
