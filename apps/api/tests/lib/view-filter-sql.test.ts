/**
 * `view-filter-sql` — translating a stored `ViewFilter[]` into the SQL the Stream actually runs.
 *
 * @remarks
 * These are behavioral, not structural: each case seeds a couple of `event` rows and asserts on
 * which ones a built condition keeps, because a SQL expression that "looks right" and a SQL
 * expression that filters the right rows are not the same claim. The pure codecs (`decodeFilter`,
 * `encodeCursor`/`decodeCursor`) are asserted directly, since there is nothing to query for those.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ViewFilter } from '@docket/db';

import { ApiError } from '../../src/error';
import {
  buildFilterConditions,
  cursorCondition,
  decodeCursor,
  decodeFilter,
  encodeCursor,
} from '../../src/lib/view-filter-sql';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

let seq = 0;

async function seedEvent(orgId: string, over: Partial<typeof schema.event.$inferInsert>) {
  seq += 1;
  const [row] = await db
    .insert(schema.event)
    .values({
      organizationId: orgId,
      sourceSystem: 'github',
      kind: 'completed',
      occurredAt: new Date('2026-08-12T09:00:00.000Z'),
      title: `Event ${String(seq)}`,
      dedupeKey: `dedupe-${String(seq)}`,
      ...over,
    })
    .returning();
  if (!row) throw new Error('failed to seed event');
  return row;
}

async function orgId(): Promise<string> {
  const { orgId: id } = await seedBaseOrg(db, schema);
  return id;
}

/** Read back the events an AND of these conditions keeps, within one org. */
async function matched(orgId: string, filters: readonly ViewFilter[]) {
  const conds = buildFilterConditions(filters);
  const rows = await db
    .select({ title: schema.event.title })
    .from(schema.event)
    .where(and(eq(schema.event.organizationId, orgId), ...conds));
  return rows.map((r) => r.title).sort();
}

describe('buildFilterConditions', () => {
  it('refuses a field that is not on the whitelist', () => {
    expect(() => buildFilterConditions([{ field: 'secretColumn', op: 'eq', value: 'x' }])).toThrow(
      ApiError,
    );
  });

  it('refuses an operator the closed enum does not define', () => {
    expect(() =>
      buildFilterConditions([{ field: 'kind', op: 'startswith' as never, value: 'x' }]),
    ).toThrow(ApiError);
  });

  it('matches an exact value with eq, and the complement with neq', async () => {
    const org = await orgId();
    await seedEvent(org, { kind: 'completed', title: 'Done' });
    await seedEvent(org, { kind: 'created', title: 'New' });

    expect(await matched(org, [{ field: 'kind', op: 'eq', value: 'completed' }])).toEqual(['Done']);
    expect(await matched(org, [{ field: 'kind', op: 'neq', value: 'completed' }])).toEqual(['New']);
  });

  it('matches a set with in, and its complement with nin', async () => {
    const org = await orgId();
    await seedEvent(org, { kind: 'completed', title: 'A' });
    await seedEvent(org, { kind: 'created', title: 'B' });
    await seedEvent(org, { kind: 'comment', title: 'C' });

    expect(
      await matched(org, [{ field: 'kind', op: 'in', value: ['completed', 'created'] }]),
    ).toEqual(['A', 'B']);
    expect(
      await matched(org, [{ field: 'kind', op: 'nin', value: ['completed', 'created'] }]),
    ).toEqual(['C']);
  });

  it('wraps a bare scalar for in/nin as a single-element set', async () => {
    // A saved view can legally store one value for a multi-select field; `asArray` is what makes
    // that not a validation error.
    const org = await orgId();
    await seedEvent(org, { kind: 'completed', title: 'Solo' });
    await seedEvent(org, { kind: 'created', title: 'Other' });

    expect(await matched(org, [{ field: 'kind', op: 'in', value: 'completed' }])).toEqual(['Solo']);
  });

  it('coerces gt/lt on occurredAt from an ISO string rather than comparing strings', async () => {
    const org = await orgId();
    await seedEvent(org, { occurredAt: new Date('2026-08-01T00:00:00.000Z'), title: 'Early' });
    await seedEvent(org, { occurredAt: new Date('2026-08-20T00:00:00.000Z'), title: 'Late' });

    expect(
      await matched(org, [{ field: 'occurredAt', op: 'gt', value: '2026-08-10T00:00:00.000Z' }]),
    ).toEqual(['Late']);
    expect(
      await matched(org, [{ field: 'occurredAt', op: 'lt', value: '2026-08-10T00:00:00.000Z' }]),
    ).toEqual(['Early']);
  });

  it('matches a substring case-insensitively with contains', async () => {
    const org = await orgId();
    await seedEvent(org, { title: 'Ship the launch plan' });
    await seedEvent(org, { title: 'Unrelated' });

    expect(await matched(org, [{ field: 'title', op: 'contains', value: 'LAUNCH' }])).toEqual([
      'Ship the launch plan',
    ]);
  });

  it('reaches into the entity and actor jsonb for the facet fields', async () => {
    const org = await orgId();
    await seedEvent(org, {
      title: 'With actor',
      actor: {
        source: 'docket',
        externalId: 'u1',
        displayName: 'Ada',
        avatarUrl: null,
        docketActorId: null,
      },
    });
    await seedEvent(org, { title: 'No actor' });

    expect(await matched(org, [{ field: 'actor', op: 'eq', value: 'Ada' }])).toEqual([
      'With actor',
    ]);
  });

  it('ANDs multiple predicates together, narrowing rather than unioning', async () => {
    const org = await orgId();
    await seedEvent(org, { kind: 'completed', title: 'Match both' });
    await seedEvent(org, { kind: 'completed', title: 'Wrong title' });
    await seedEvent(org, { kind: 'created', title: 'Match both title only' });

    expect(
      await matched(org, [
        { field: 'kind', op: 'eq', value: 'completed' },
        { field: 'title', op: 'contains', value: 'Match both' },
      ]),
    ).toEqual(['Match both']);
  });
});

describe('decodeFilter', () => {
  it('round-trips what encodeCursor-style base64url would carry', () => {
    const filters: ViewFilter[] = [{ field: 'kind', op: 'eq', value: 'completed' }];
    const encoded = Buffer.from(JSON.stringify(filters)).toString('base64url');
    expect(decodeFilter(encoded)).toEqual(filters);
  });

  it('returns an empty set for an absent param rather than throwing', () => {
    expect(decodeFilter(undefined)).toEqual([]);
  });

  it('returns an empty set for a value that is not base64url JSON at all', () => {
    expect(decodeFilter('not valid base64url json')).toEqual([]);
  });

  it('returns an empty set for JSON that decoded to something other than an array', () => {
    const encoded = Buffer.from(JSON.stringify({ not: 'an array' })).toString('base64url');
    expect(decodeFilter(encoded)).toEqual([]);
  });
});

describe('cursor codec', () => {
  it('round-trips occurredAt and id through encode/decode', () => {
    const occurredAt = new Date('2026-08-12T09:00:00.000Z');
    const encoded = encodeCursor(occurredAt, 'evt_1');
    expect(decodeCursor(encoded)).toEqual({ occurredAt, id: 'evt_1' });
  });

  it('treats an absent cursor as the first page', () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('rejects a cursor with no separator', () => {
    expect(decodeCursor(Buffer.from('nothingtosplit').toString('base64url'))).toBeNull();
  });

  it('rejects a cursor whose timestamp half does not parse as a date', () => {
    expect(decodeCursor(Buffer.from('not-a-date|evt_1').toString('base64url'))).toBeNull();
  });

  it('rejects a cursor that is not valid base64url at all', () => {
    expect(decodeCursor('%%%not-base64%%%')).toBeNull();
  });
});

describe('cursorCondition', () => {
  it('keeps only rows strictly after the cursor in ascending order', async () => {
    const org = await orgId();
    const first = await seedEvent(org, {
      occurredAt: new Date('2026-08-01T00:00:00.000Z'),
      title: 'First',
    });
    await seedEvent(org, { occurredAt: new Date('2026-08-02T00:00:00.000Z'), title: 'Second' });

    const cursor = { occurredAt: first.occurredAt, id: first.id };
    const rows = await db
      .select({ title: schema.event.title })
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, org), cursorCondition(cursor, 'asc')));
    expect(rows.map((r) => r.title)).toEqual(['Second']);
  });

  it('breaks a tie on occurredAt using the id column', async () => {
    // Two rows at the exact same instant are only orderable by the tiebreaker.
    const org = await orgId();
    const at = new Date('2026-08-01T00:00:00.000Z');
    const a = await seedEvent(org, { occurredAt: at, title: 'A' });
    const b = await seedEvent(org, { occurredAt: at, title: 'B' });
    const [lower, higher] = a.id < b.id ? [a, b] : [b, a];

    const rows = await db
      .select({ title: schema.event.title })
      .from(schema.event)
      .where(
        and(
          eq(schema.event.organizationId, org),
          cursorCondition({ occurredAt: at, id: lower.id }, 'asc'),
        ),
      );
    expect(rows.map((r) => r.title)).toEqual([higher.title]);
  });

  it('reverses direction for a descending page', async () => {
    const org = await orgId();
    await seedEvent(org, { occurredAt: new Date('2026-08-01T00:00:00.000Z'), title: 'Earlier' });
    const later = await seedEvent(org, {
      occurredAt: new Date('2026-08-02T00:00:00.000Z'),
      title: 'Later',
    });

    const cursor = { occurredAt: later.occurredAt, id: later.id };
    const rows = await db
      .select({ title: schema.event.title })
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, org), cursorCondition(cursor, 'desc')));
    expect(rows.map((r) => r.title)).toEqual(['Earlier']);
  });
});
