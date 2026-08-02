/**
 * Browsing the one infinite conversation: derived topics, keyword search, date filtering.
 *
 * @remarks
 * The conversation seeded here spans three genuinely different subjects across three months, so
 * every assertion is about the derivation finding structure that is really there rather than
 * about it reproducing a fixture it was tuned on.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type {
  athenaConversationSearch as AthenaConversationSearch,
  athenaConversationSegments as AthenaConversationSegments,
} from '../../src/routes/me-athena-conversation';
import type { resolveCanonicalConversation as ResolveCanonicalConversation } from '../../src/routes/agent-dispatch';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let athenaConversationSegments!: typeof AthenaConversationSegments;
let athenaConversationSearch!: typeof AthenaConversationSearch;
let resolveCanonicalConversation!: typeof ResolveCanonicalConversation;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  ({ athenaConversationSegments, athenaConversationSearch } =
    await import('../../src/routes/me-athena-conversation'));
  ({ resolveCanonicalConversation } = await import('../../src/routes/agent-dispatch'));
});

/** Three subjects, one month apart each, so date filtering has real separation to work with. */
const SCRIPT: readonly (readonly ['user' | 'athena', string, string])[] = [
  [
    'user',
    'We need to hire a senior designer for the brand team this quarter.',
    '2026-04-02T09:00:00.000Z',
  ],
  [
    'athena',
    'I drafted a designer job description and a hiring scorecard for the brand team.',
    '2026-04-02T09:01:00.000Z',
  ],
  [
    'user',
    'Add a portfolio review round to the designer interview loop.',
    '2026-04-02T09:02:00.000Z',
  ],
  [
    'athena',
    'Added a portfolio review to the designer interview loop, before the onsite.',
    '2026-04-02T09:03:00.000Z',
  ],
  [
    'user',
    'Separately, the Postgres migration keeps timing out on the events table.',
    '2026-05-08T14:00:00.000Z',
  ],
  [
    'athena',
    'The Postgres migration on the events table needs a concurrent index build.',
    '2026-05-08T14:01:00.000Z',
  ],
  [
    'user',
    'Can we run that migration in batches instead of one transaction?',
    '2026-05-08T14:02:00.000Z',
  ],
  [
    'athena',
    'Batching the migration avoids the long transaction lock on Postgres.',
    '2026-05-08T14:03:00.000Z',
  ],
  [
    'user',
    "Let's hold the newsletter until Tuesday so the announcement lands first.",
    '2026-06-19T11:00:00.000Z',
  ],
  [
    'athena',
    'Holding the newsletter until Tuesday; the announcement goes out Monday evening.',
    '2026-06-19T11:01:00.000Z',
  ],
  ['user', 'Who writes the newsletter intro paragraph?', '2026-06-19T11:02:00.000Z'],
  [
    'athena',
    'You write the newsletter intro; I will assemble the rest of the issue.',
    '2026-06-19T11:03:00.000Z',
  ],
];

interface Seeded {
  readonly ownerUserId: string;
  readonly sessionId: string;
  readonly activityIds: readonly string[];
}

/** Seed one owner with the scripted conversation on their canonical Athena session. */
async function seedConversation(): Promise<Seeded> {
  const slug = `conv-${Math.random().toString(36).slice(2, 10)}`;
  const [owner] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({ userId: owner!.id, preferences: {} });
  const conversation = await resolveCanonicalConversation(owner!.id);

  const activityIds: string[] = [];
  for (const [author, text, at] of SCRIPT) {
    const [row] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: conversation.id,
        organizationId: null,
        type: 'response',
        body: { text, author },
        createdAt: new Date(at),
      })
      .returning({ id: schema.sessionActivity.id });
    activityIds.push(row!.id);
  }
  return { ownerUserId: owner!.id, sessionId: conversation.id, activityIds };
}

describe('automatic topic segmentation', () => {
  it('lists three named segments with no user action and no “new topic” control', async () => {
    const seeded = await seedConversation();
    const result = await athenaConversationSegments(seeded.ownerUserId, seeded.sessionId);
    expect(result.items).toHaveLength(3);
    expect(result.items.map((segment) => segment.title)).toEqual([
      'We need to hire a senior designer for the brand team this quart…',
      'Separately, the Postgres migration keeps timing out on the even…',
      "Let's hold the newsletter until Tuesday so the announcement lan…",
    ]);
  });

  it('puts each boundary at the topic change, addressable by activity id', async () => {
    const seeded = await seedConversation();
    const result = await athenaConversationSegments(seeded.ownerUserId, seeded.sessionId);
    expect(result.items.map((segment) => segment.startActivityId)).toEqual([
      seeded.activityIds[0],
      seeded.activityIds[4],
      seeded.activityIds[8],
    ]);
    expect(result.items.map((segment) => segment.endActivityId)).toEqual([
      seeded.activityIds[3],
      seeded.activityIds[7],
      seeded.activityIds[11],
    ]);
  });

  it('gives each segment the terms that distinguish it', async () => {
    const seeded = await seedConversation();
    const result = await athenaConversationSegments(seeded.ownerUserId, seeded.sessionId);
    expect(result.items[0]?.keywords).toContain('design');
    expect(result.items[1]?.keywords).toContain('migr');
    expect(result.items[2]?.keywords).toContain('newslett');
  });

  it('caches the derivation and reuses it while the conversation has not moved', async () => {
    const seeded = await seedConversation();
    const first = await athenaConversationSegments(seeded.ownerUserId, seeded.sessionId);
    const second = await athenaConversationSegments(seeded.ownerUserId, seeded.sessionId);
    expect(second.revision).toBe(first.revision);
    expect(second.items.map((segment) => segment.id)).toEqual(
      first.items.map((segment) => segment.id),
    );
  });

  it('recomputes into a new revision when the conversation moves on, keeping exactly one live', async () => {
    const seeded = await seedConversation();
    const first = await athenaConversationSegments(seeded.ownerUserId, seeded.sessionId);
    await db.insert(schema.sessionActivity).values({
      sessionId: seeded.sessionId,
      organizationId: null,
      type: 'response',
      body: { text: 'Also, renew the office lease before the end of the month.', author: 'user' },
      createdAt: new Date('2026-07-02T08:00:00.000Z'),
    });
    await db.insert(schema.sessionActivity).values({
      sessionId: seeded.sessionId,
      organizationId: null,
      type: 'response',
      body: { text: 'I put the office lease renewal on your list for Monday.', author: 'athena' },
      createdAt: new Date('2026-07-02T08:01:00.000Z'),
    });

    const second = await athenaConversationSegments(seeded.ownerUserId, seeded.sessionId);
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(second.items).toHaveLength(4);
    expect(second.items[3]?.title).toContain('office lease');

    const stored = await db
      .select({ revision: schema.athenaConversationSegment.revision })
      .from(schema.athenaConversationSegment)
      .where(eq(schema.athenaConversationSegment.sessionId, seeded.sessionId));
    expect(new Set(stored.map((row) => row.revision))).toEqual(new Set([second.revision]));
  });

  it('returns nothing for a conversation with no readable messages', async () => {
    const slug = `empty-${Math.random().toString(36).slice(2, 10)}`;
    const [owner] = await db
      .insert(schema.user)
      .values({ name: 'Empty', email: `${slug}@example.com` })
      .returning({ id: schema.user.id });
    const conversation = await resolveCanonicalConversation(owner!.id);
    const result = await athenaConversationSegments(owner!.id, conversation.id);
    expect(result.items).toEqual([]);
  });
});

describe('keyword search over conversation history', () => {
  it('returns every message containing the term and no message that does not', async () => {
    const seeded = await seedConversation();
    const result = await athenaConversationSearch(seeded.ownerUserId, {
      q: 'newsletter',
      limit: 50,
    });
    const expected = SCRIPT.filter(([, text]) => /newsletter/i.test(text)).length;
    expect(result.total).toBe(expected);
    expect(result.items).toHaveLength(expected);
    expect(result.items.every((hit) => /newsletter/i.test(hit.text))).toBe(true);
  });

  it('reports the matched character range so the term can be highlighted', async () => {
    const seeded = await seedConversation();
    const result = await athenaConversationSearch(seeded.ownerUserId, {
      q: 'Postgres',
      limit: 50,
    });
    const hit = result.items[0];
    expect(hit).toBeDefined();
    const span = hit?.highlights[0];
    expect(span).toBeDefined();
    expect(hit?.text.slice(span?.start ?? 0, span?.end ?? 0)).toBe('Postgres');
  });

  it('returns an explicit empty result rather than a blank partial one', async () => {
    const seeded = await seedConversation();
    const result = await athenaConversationSearch(seeded.ownerUserId, {
      q: 'kubernetes',
      limit: 50,
    });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('reports honestly that meaning-level ranking did not run', async () => {
    const seeded = await seedConversation();
    const result = await athenaConversationSearch(seeded.ownerUserId, {
      q: 'newsletter',
      limit: 50,
    });
    expect(result.semantic).toBe(false);
  });

  it('never returns another person’s conversation', async () => {
    const mine = await seedConversation();
    const theirs = await seedConversation();
    const result = await athenaConversationSearch(mine.ownerUserId, {
      q: 'newsletter',
      limit: 50,
    });
    expect(result.items.every((hit) => hit.sessionId === mine.sessionId)).toBe(true);
    expect(result.items.some((hit) => hit.sessionId === theirs.sessionId)).toBe(false);
  });

  it('returns nothing at all for an owner with no Athena history', async () => {
    const slug = `none-${Math.random().toString(36).slice(2, 10)}`;
    const [owner] = await db
      .insert(schema.user)
      .values({ name: 'Nobody', email: `${slug}@example.com` })
      .returning({ id: schema.user.id });
    const result = await athenaConversationSearch(owner!.id, { q: 'anything', limit: 50 });
    expect(result).toEqual({ items: [], total: 0, semantic: false, terms: [] });
  });
});

describe('date filtering over conversation history', () => {
  it('returns only messages inside an inclusive range, both boundary days included', async () => {
    const seeded = await seedConversation();
    const result = await athenaConversationSearch(seeded.ownerUserId, {
      from: '2026-05-08T00:00:00.000Z',
      to: '2026-05-08T23:59:59.999Z',
      limit: 50,
    });
    expect(result.total).toBe(4);
    expect(result.items.every((hit) => hit.createdAt.startsWith('2026-05-08'))).toBe(true);
  });

  it('composes with a search term so results satisfy both', async () => {
    const seeded = await seedConversation();
    const both = await athenaConversationSearch(seeded.ownerUserId, {
      q: 'migration',
      from: '2026-05-08T14:02:00.000Z',
      limit: 50,
    });
    expect(both.total).toBe(2);
    expect(both.items.every((hit) => /migration/i.test(hit.text))).toBe(true);
  });

  it('restores the unfiltered set when the range is cleared', async () => {
    const seeded = await seedConversation();
    const filtered = await athenaConversationSearch(seeded.ownerUserId, {
      q: 'migration',
      from: '2026-05-08T14:02:00.000Z',
      limit: 50,
    });
    const cleared = await athenaConversationSearch(seeded.ownerUserId, {
      q: 'migration',
      limit: 50,
    });
    expect(cleared.total).toBeGreaterThan(filtered.total);
  });

  it('returns the whole conversation newest-first for a bare date-only query', async () => {
    const seeded = await seedConversation();
    const result = await athenaConversationSearch(seeded.ownerUserId, { limit: 50 });
    expect(result.total).toBe(SCRIPT.length);
    expect(result.items[0]?.activityId).toBe(seeded.activityIds.at(-1));
    expect(result.terms).toEqual([]);
  });

  it('bounds a page without misreporting the total', async () => {
    const seeded = await seedConversation();
    const result = await athenaConversationSearch(seeded.ownerUserId, { limit: 3 });
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(SCRIPT.length);
  });
});

describe('conversation scoping', () => {
  it('restricts to one conversation when asked', async () => {
    const seeded = await seedConversation();
    const other = await seedConversation();
    const result = await athenaConversationSearch(
      seeded.ownerUserId,
      { q: 'newsletter', limit: 50 },
      seeded.sessionId,
    );
    expect(result.items.every((hit) => hit.sessionId === seeded.sessionId)).toBe(true);

    const wrong = await athenaConversationSearch(
      seeded.ownerUserId,
      { q: 'newsletter', limit: 50 },
      other.sessionId,
    );
    expect(wrong.items).toEqual([]);
  });

  it('keeps segments owner-scoped in the database', async () => {
    const seeded = await seedConversation();
    await athenaConversationSegments(seeded.ownerUserId, seeded.sessionId);
    const rows = await db
      .select({ ownerUserId: schema.athenaConversationSegment.ownerUserId })
      .from(schema.athenaConversationSegment)
      .where(
        and(
          eq(schema.athenaConversationSegment.sessionId, seeded.sessionId),
          eq(schema.athenaConversationSegment.ownerUserId, seeded.ownerUserId),
        ),
      );
    expect(rows.length).toBeGreaterThan(0);
  });
});
