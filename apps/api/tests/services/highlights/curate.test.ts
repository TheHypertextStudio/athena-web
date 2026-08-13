import { asc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from '../../support/routes-harness';
import { curateHighlight } from '../../../src/services/highlights/curate';
import { buildHighlightsDayPayload } from '../../../src/services/highlights/read';
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
