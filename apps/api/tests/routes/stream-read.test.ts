/**
 * `@docket/api` — unified stream read surfaces: the cross-org personal `/v1/hub/stream`
 * (recipient-curated) and the per-workspace `/v1/orgs/:orgId/stream` firehose, plus the
 * ViewFilter→SQL translation, keyset pagination, relevance labels, and org isolation.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { EventKind, SourceSystemKind, StreamPageOut } from '@docket/types';
import type { z } from 'zod';

import { appWithActor, appWithSession, fakeSession, getDb, seedBaseOrg } from '../support/routes-harness';
import type hubRouter from '../../src/routes/hub';
import type streamRouter from '../../src/routes/stream';

type StreamPage = z.infer<typeof StreamPageOut>;

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let hub!: typeof hubRouter;
let stream!: typeof streamRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  hub = (await import('../../src/routes/hub')).default;
  stream = (await import('../../src/routes/stream')).default;
});

let seq = 0;

async function seedUser(): Promise<string> {
  seq += 1;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'U', email: `stream-${String(seq)}@e.com` })
    .returning({ id: schema.user.id });
  return u!.id;
}

async function joinOrg(userId: string, orgId: string): Promise<void> {
  await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'U', userId });
}

interface EventOpts {
  system?: SourceSystemKind;
  kind?: EventKind;
  title?: string;
  occurredAt: Date;
}

async function seedEvent(orgId: string, opts: EventOpts): Promise<string> {
  seq += 1;
  const [o] = await db
    .insert(schema.event)
    .values({
      organizationId: orgId,
      sourceSystem: opts.system ?? 'docket',
      kind: opts.kind ?? 'status_change',
      occurredAt: opts.occurredAt,
      title: opts.title ?? 'Event',
      dedupeKey: `k-${String(seq)}`,
    })
    .returning({ id: schema.event.id });
  return o!.id;
}

async function recip(eventId: string, userId: string, orgId: string, at: Date): Promise<void> {
  await db
    .insert(schema.eventRecipient)
    .values({ eventId, userId, organizationId: orgId, occurredAt: at, reason: 'owned' });
}

function b64(filters: unknown): string {
  return Buffer.from(JSON.stringify(filters)).toString('base64url');
}

async function page(res: Response): Promise<StreamPage> {
  return (await res.json()) as StreamPage;
}

const T1 = new Date('2026-06-29T10:00:00.000Z');
const T2 = new Date('2026-06-29T11:00:00.000Z');
const T3 = new Date('2026-06-29T12:00:00.000Z');

/** Seed a user joined to a base org with three recipient events (linear/docket/slack). */
async function seedPersonal(): Promise<{ userId: string; orgId: string }> {
  const userId = await seedUser();
  const { orgId } = await seedBaseOrg(db, schema);
  await joinOrg(userId, orgId);
  const a = await seedEvent(orgId, {
    system: 'linear',
    kind: 'mention',
    title: 'Mentioned',
    occurredAt: T1,
  });
  const b = await seedEvent(orgId, {
    system: 'docket',
    kind: 'status_change',
    title: 'Moved',
    occurredAt: T2,
  });
  const c = await seedEvent(orgId, {
    system: 'slack',
    kind: 'comment',
    title: 'Commented',
    occurredAt: T3,
  });
  await recip(a, userId, orgId, T1);
  await recip(b, userId, orgId, T2);
  await recip(c, userId, orgId, T3);
  return { userId, orgId };
}

describe('GET /v1/hub/stream (personal, recipient-curated)', () => {
  it('401 without a session', async () => {
    expect((await appWithSession(hub, null).request('/stream')).status).toBe(401);
  });

  it('returns the caller’s events newest-first with source + relevance', async () => {
    const { userId } = await seedPersonal();
    const res = await appWithSession(hub, fakeSession(userId)).request('/stream');
    const body = await page(res);
    expect(body.items.map((i) => i.kind)).toEqual(['comment', 'status_change', 'mention']);
    expect(body.items.map((i) => i.source.system)).toEqual(['slack', 'docket', 'linear']);
    expect(body.items.every((i) => i.relevance === 'owned')).toBe(true);
  });

  it('applies the system quick-filter', async () => {
    const { userId } = await seedPersonal();
    const res = await appWithSession(hub, fakeSession(userId)).request('/stream?system=linear');
    const body = await page(res);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.kind).toBe('mention');
  });

  it('applies an attribute filter (kind in […]) from the base64 filter param', async () => {
    const { userId } = await seedPersonal();
    const filter = b64([{ field: 'kind', op: 'in', value: ['mention', 'comment'] }]);
    const res = await appWithSession(hub, fakeSession(userId)).request(`/stream?filter=${filter}`);
    const body = await page(res);
    expect(body.items.map((i) => i.kind).sort()).toEqual(['comment', 'mention']);
  });

  it('keyset-paginates with a cursor', async () => {
    const { userId } = await seedPersonal();
    const app = appWithSession(hub, fakeSession(userId));
    const first = await page(await app.request('/stream?limit=2'));
    expect(first.items.map((i) => i.kind)).toEqual(['comment', 'status_change']);
    expect(first.nextCursor).toBeDefined();
    const second = await page(await app.request(`/stream?limit=2&cursor=${first.nextCursor!}`));
    expect(second.items.map((i) => i.kind)).toEqual(['mention']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('rejects an unknown filter field with 400', async () => {
    const { userId } = await seedPersonal();
    const filter = b64([{ field: 'bogus', op: 'eq', value: 'x' }]);
    const res = await appWithSession(hub, fakeSession(userId)).request(`/stream?filter=${filter}`);
    expect(res.status).toBe(400);
  });

  it('isolates other orgs the caller is not a member of', async () => {
    const { userId } = await seedPersonal();
    // A recipient row for the same user in an org they never joined must not leak.
    const other = await seedBaseOrg(db, schema);
    const o = await seedEvent(other.orgId, { kind: 'created', title: 'Other', occurredAt: T3 });
    await recip(o, userId, other.orgId, T3);
    const body = await page(await appWithSession(hub, fakeSession(userId)).request('/stream'));
    expect(body.items).toHaveLength(3);
    expect(body.items.some((i) => i.title === 'Other')).toBe(false);
  });
});

describe('GET /v1/orgs/:orgId/stream (workspace firehose)', () => {
  it('returns every org event with null relevance', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    await seedEvent(orgId, { system: 'github', kind: 'assignment', title: 'A', occurredAt: T1 });
    await seedEvent(orgId, { system: 'docket', kind: 'created', title: 'B', occurredAt: T2 });
    const app = appWithActor(stream, orgId, ['view']);
    const body = await page(await app.request('/'));
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i) => i.title)).toEqual(['B', 'A']);
    expect(body.items.every((i) => i.relevance === null)).toBe(true);
  });
});
