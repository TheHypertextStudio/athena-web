import { and, asc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from '../../support/routes-harness';
import { reconcileDay, refreshDayInBackground } from '../../../src/services/highlights/reconcile';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const DAY = '2026-08-12';
/** Mid-afternoon UTC, so the day's window is open and its events sit inside it. */
const NOW = new Date('2026-08-12T18:00:00.000Z');

let people = 0;

/** A person with a Hub pinned to UTC, so the local day and the calendar date coincide. */
async function seedPerson(): Promise<{ orgId: string; userId: string }> {
  const { orgId } = await seedBaseOrg(db, schema);
  people += 1;
  const userId = one(
    await db
      .insert(schema.user)
      .values({ name: `Ada ${String(people)}`, email: `ada-${String(people)}@example.test` })
      .returning({ id: schema.user.id }),
  ).id;
  await db.insert(schema.hub).values({ userId, preferences: { timezone: 'UTC' } });
  return { orgId, userId };
}

let seq = 0;

/** One canonical event on a given subject at a given time. */
async function seedEvent(
  orgId: string,
  userId: string,
  over: { subject?: string; title?: string; at?: string; kind?: 'completed' | 'comment' } = {},
): Promise<string> {
  seq += 1;
  const subject = over.subject ?? 'ENG-1';
  return one(
    await db
      .insert(schema.event)
      .values({
        organizationId: orgId,
        userId,
        sourceSystem: 'github',
        kind: over.kind ?? 'completed',
        occurredAt: new Date(over.at ?? '2026-08-12T09:00:00.000Z'),
        title: over.title ?? `Event ${String(seq)}`,
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
        dedupeKey: `test-${String(seq)}`,
      })
      .returning({ id: schema.event.id }),
  ).id;
}

async function highlightsFor(activityDayId: string) {
  return db
    .select()
    .from(schema.activityHighlight)
    .where(eq(schema.activityHighlight.activityDayId, activityDayId))
    .orderBy(asc(schema.activityHighlight.sort));
}

async function dayFor(userId: string) {
  const [row] = await db
    .select()
    .from(schema.activityDay)
    .where(and(eq(schema.activityDay.userId, userId), eq(schema.activityDay.localDate, DAY)))
    .limit(1);
  return row;
}

describe('reconcileDay', () => {
  it('turns a day of events into narrated episodes', async () => {
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId, { title: 'Merged the import fix' });

    const result = await reconcileDay(userId, DAY, NOW);

    expect(result.empty).toBe(false);
    expect(result.episodeCount).toBe(1);
    expect(result.narrated).toBe(1);

    const rows = await highlightsFor(result.activityDayId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.narrationState).toBe('ready');
    expect(rows[0]?.narration).not.toBeNull();
    expect(rows[0]?.kept).toBe(true);
    expect((await dayFor(userId))?.status).toBe('ready');
  });

  it('resolves the day from `now` when no date is named', async () => {
    // The sweep always names a day, but the read and the agent tool can ask for "today" without
    // computing it themselves \u2014 and computing it for them is the only way both agree on the
    // boundary, since a caller's idea of today may come from a different clock.
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId);

    const result = await reconcileDay(userId, undefined, NOW);

    // The row it built is the one for today, which is what proves the date was derived rather than
    // defaulted to something else.
    expect(result.episodeCount).toBeGreaterThan(0);
    const [day] = await db
      .select({ localDate: schema.activityDay.localDate })
      .from(schema.activityDay)
      .where(eq(schema.activityDay.id, result.activityDayId));
    expect(day?.localDate).toBe(DAY);
  });

  it('does not ask providers about a day that is already finished', async () => {
    // A finished day cannot gain activity, so polling for one spends quota re-reading history that is
    // already recorded. Asserted through `sync_run`, because the absence of a pull is the whole claim
    // and a returned tally would not show it.
    const { orgId, userId } = await seedPerson();
    const actorId = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Past', userId })
        .returning({ id: schema.actor.id }),
    ).id;
    const integrationId = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'github',
          pattern: 'connector',
          roles: ['code'],
          status: 'connected',
          createdBy: actorId,
        })
        .returning({ id: schema.integration.id }),
    ).id;

    // `NOW` is inside DAY, so reconciling the day before is reconciling a finished one.
    await reconcileDay(userId, '2026-08-11', NOW);

    const runs = await db
      .select({ id: schema.syncRun.id })
      .from(schema.syncRun)
      .where(eq(schema.syncRun.integrationId, integrationId));
    expect(runs).toHaveLength(0);
  });

  it('marks only the lines the model left out, and keeps the rest', async () => {
    // `reconcileHighlights` guarantees one entry per episode in order, and this is that guarantee at
    // the persistence layer: a model that answers about some episodes and not others must leave the
    // answered ones `ready` and the unanswered ones `failed`, never drop a row and never invent a
    // sentence for one it said nothing about.
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId, { subject: 'ENG-1' });
    await seedEvent(orgId, userId, { subject: 'ENG-2' });

    const { getContainer } = await import('../../../src/container');
    const spy = vi
      .spyOn(getContainer().summarizer, 'narrateDay')
      .mockImplementation(async (input) => ({
        // Only the first episode comes back with prose.
        highlights: input.episodes.slice(0, 1).map((episode) => ({
          key: episode.key,
          sentence: 'I did the first thing.',
        })),
      }));

    try {
      const result = await reconcileDay(userId, DAY, NOW);

      expect(result.narrated).toBe(1);
      expect(result.narrationFailed).toBe(1);
      const rows = await db
        .select({
          state: schema.activityHighlight.narrationState,
          narration: schema.activityHighlight.narration,
        })
        .from(schema.activityHighlight)
        .where(eq(schema.activityHighlight.activityDayId, result.activityDayId));
      // Both episodes still have a row: the day's record is complete even where its prose is not.
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.state === 'ready')).toHaveLength(1);
      expect(rows.filter((row) => row.state === 'failed')).toHaveLength(1);
      expect(rows.find((row) => row.state === 'failed')?.narration).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('takes back a narration claim that was stranded by a crash', async () => {
    // Narration claims rows by flipping them to `generating`, which stops two passes paying for the
    // same sentences. Without a reclaim window that claim is permanent: a process killed between the
    // claim and the write leaves its rows `generating`, no later pass touches them, and the client
    // polls a day that will never finish. Simulated by stranding the row directly, which is exactly
    // the state a crash leaves behind.
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId);
    const first = await reconcileDay(userId, DAY, NOW);

    const stranded = new Date(NOW.getTime() - 30 * 60 * 1000);
    await db
      .update(schema.activityHighlight)
      .set({ narrationState: 'generating', narration: null, narrationClaimedAt: stranded })
      .where(eq(schema.activityHighlight.activityDayId, first.activityDayId));

    const result = await reconcileDay(userId, DAY, NOW);

    expect(result.narrated).toBeGreaterThan(0);
    const rows = await db
      .select({ state: schema.activityHighlight.narrationState })
      .from(schema.activityHighlight)
      .where(eq(schema.activityHighlight.activityDayId, first.activityDayId));
    expect(rows.every((row) => row.state === 'ready')).toBe(true);
  });

  it('leaves a claim alone while it is still fresh', async () => {
    // The other half: a reclaim window that is too eager is just the duplicate-work bug it exists to
    // prevent. A claim taken moments ago belongs to a pass that is still running.
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId);
    const first = await reconcileDay(userId, DAY, NOW);
    await db
      .update(schema.activityHighlight)
      .set({ narrationState: 'generating', narrationClaimedAt: NOW })
      .where(eq(schema.activityHighlight.activityDayId, first.activityDayId));

    const result = await reconcileDay(userId, DAY, NOW);

    expect(result.narrated).toBe(0);
  });

  it('collapses a day of work on one subject into a single story', async () => {
    // The product premise: six commits on one pull request is one line, not six.
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId, { at: '2026-08-12T09:00:00.000Z' });
    await seedEvent(orgId, userId, { at: '2026-08-12T09:20:00.000Z', kind: 'comment' });
    await seedEvent(orgId, userId, { at: '2026-08-12T16:00:00.000Z', kind: 'comment' });

    const result = await reconcileDay(userId, DAY, NOW);

    expect(result.episodeCount).toBe(1);
    const rows = await highlightsFor(result.activityDayId);
    expect(rows).toHaveLength(1);
    // Even the one seven hours later: same subject, same day, one story.
    expect(rows[0]?.eventIds).toHaveLength(3);
  });

  it('keeps separate subjects as separate stories, ordered by when they began', async () => {
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId, { subject: 'ENG-late', at: '2026-08-12T15:00:00.000Z' });
    await seedEvent(orgId, userId, { subject: 'ENG-early', at: '2026-08-12T08:00:00.000Z' });

    const result = await reconcileDay(userId, DAY, NOW);

    const rows = await highlightsFor(result.activityDayId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.subjectTitle)).toEqual(['Subject ENG-early', 'Subject ENG-late']);
    expect(rows.map((r) => r.sort)).toEqual([0, 1]);
  });

  it('records a quiet day as empty, and spends nothing on it', async () => {
    const { userId } = await seedPerson();
    const { getContainer } = await import('../../../src/container');
    const spy = vi.spyOn(getContainer().summarizer, 'narrateDay');

    const result = await reconcileDay(userId, DAY, NOW);

    expect(result.empty).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect((await dayFor(userId))?.status).toBe('empty');
    spy.mockRestore();
  });

  it('narrates each episode once, however often the day is reconciled', async () => {
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId);
    await reconcileDay(userId, DAY, NOW);

    const { getContainer } = await import('../../../src/container');
    const spy = vi.spyOn(getContainer().summarizer, 'narrateDay');
    const second = await reconcileDay(userId, DAY, NOW);

    // Already narrated, so there is nothing to claim and no reason to call the model again.
    expect(spy).not.toHaveBeenCalled();
    expect(second.narrated).toBe(0);
    expect(await highlightsFor(second.activityDayId)).toHaveLength(1);
    spy.mockRestore();
  });

  it('never discards a rewrite or a drop when the day is reconciled again', async () => {
    // The guarantee behind "the record is fixed, the story is editable": a later-arriving event
    // extends an episode, and must not quietly overwrite what the person wrote about it.
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId, { at: '2026-08-12T09:00:00.000Z' });
    const first = await reconcileDay(userId, DAY, NOW);
    const before = one(await highlightsFor(first.activityDayId));

    await db
      .update(schema.activityHighlight)
      .set({ editedNarration: 'I wrote this myself.', kept: false, curatedAt: NOW })
      .where(eq(schema.activityHighlight.id, before.id));

    // A backfilled event on the same subject — exactly the case the episode key exists to survive.
    await seedEvent(orgId, userId, { at: '2026-08-12T08:00:00.000Z', kind: 'comment' });
    const second = await reconcileDay(userId, DAY, NOW);

    const after = one(await highlightsFor(second.activityDayId));
    expect(after.id).toBe(before.id);
    expect(after.episodeKey).toBe(before.episodeKey);
    expect(after.editedNarration).toBe('I wrote this myself.');
    expect(after.kept).toBe(false);
    // The derived facts did move: the episode now covers both events.
    expect(after.eventIds).toHaveLength(2);
  });

  it('keeps the record when narration fails, and says so rather than pretending', async () => {
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId);

    const { getContainer } = await import('../../../src/container');
    const spy = vi
      .spyOn(getContainer().summarizer, 'narrateDay')
      .mockRejectedValueOnce(new Error('model unavailable'));

    const result = await reconcileDay(userId, DAY, NOW);

    expect(result.narrationFailed).toBe(1);
    const rows = await highlightsFor(result.activityDayId);
    // The episode exists and is complete; only its sentence is missing.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.narrationState).toBe('failed');
    expect(rows[0]?.narration).toBeNull();
    expect(rows[0]?.eventIds).toHaveLength(1);
    const day = await dayFor(userId);
    expect(day?.status).toBe('ready');
    expect(day?.narratedAt).toBeNull();
    spy.mockRestore();
  });

  it('retries a failed narration on the next pass', async () => {
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId);

    const { getContainer } = await import('../../../src/container');
    const spy = vi
      .spyOn(getContainer().summarizer, 'narrateDay')
      .mockRejectedValueOnce(new Error('model unavailable'));
    const failed = await reconcileDay(userId, DAY, NOW);
    spy.mockRestore();

    // `failed` must be reachable again, or a transient outage would strand the day forever.
    await db
      .update(schema.activityHighlight)
      .set({ narrationState: 'pending' })
      .where(eq(schema.activityHighlight.activityDayId, failed.activityDayId));

    const retried = await reconcileDay(userId, DAY, NOW);
    expect(retried.narrated).toBe(1);
    expect((await highlightsFor(retried.activityDayId))[0]?.narration).not.toBeNull();
  });

  it('leaves events from other days and other people out of the day', async () => {
    const { orgId, userId } = await seedPerson();
    const other = await seedPerson();
    await seedEvent(orgId, userId, { at: '2026-08-11T09:00:00.000Z', subject: 'ENG-yesterday' });
    await seedEvent(other.orgId, other.userId, { subject: 'ENG-theirs' });
    await seedEvent(orgId, userId, { subject: 'ENG-mine' });

    const result = await reconcileDay(userId, DAY, NOW);

    const rows = await highlightsFor(result.activityDayId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectTitle).toBe('Subject ENG-mine');
  });
});

describe('refreshDayInBackground', () => {
  it('does not start a second reconcile for a day already being rebuilt', async () => {
    // The client re-reads every four seconds while narration is in flight, and each of those reads
    // asks for a refresh. Without this guard every poll would start another reconcile of the same
    // day — not incorrect, since the claim is atomic, but a pile of duplicated provider calls.
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId);

    const { getContainer } = await import('../../../src/container');
    let inFlight: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (inFlight = resolve));
    const spy = vi
      .spyOn(getContainer().summarizer, 'narrateDay')
      .mockImplementation(async (input) => {
        await gate;
        return { highlights: input.episodes.map((e) => ({ key: e.key, sentence: 'I did it.' })) };
      });

    try {
      refreshDayInBackground(userId, DAY, NOW);
      // Three more while the first is still inside `narrateDay`.
      refreshDayInBackground(userId, DAY, NOW);
      refreshDayInBackground(userId, DAY, NOW);
      inFlight?.();

      await vi.waitFor(async () => {
        const [day] = await db
          .select({ status: schema.activityDay.status })
          .from(schema.activityDay)
          .where(eq(schema.activityDay.userId, userId));
        expect(day?.status).toBe('ready');
      });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('swallows a failure rather than breaking the read that triggered it', async () => {
    // A refresh is a side errand of a read. If it cannot run, the day is stale — which the payload
    // already says honestly — and that is not a reason to fail the request that asked for it. An
    // unhandled rejection here would take down the process instead.
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId);

    const { getContainer } = await import('../../../src/container');
    const spy = vi
      .spyOn(getContainer().summarizer, 'narrateDay')
      .mockRejectedValue(new Error('model unavailable'));

    try {
      expect(() => {
        refreshDayInBackground(userId, DAY, NOW);
      }).not.toThrow();
      // The day's record still stands; only its prose is missing.
      await vi.waitFor(async () => {
        const rows = await db
          .select({ state: schema.activityHighlight.narrationState })
          .from(schema.activityHighlight);
        expect(rows.some((row) => row.state === 'failed')).toBe(true);
      });
    } finally {
      spy.mockRestore();
    }
  });
});
