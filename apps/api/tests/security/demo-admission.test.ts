import { resolve } from 'node:path';
import {
  actor,
  db,
  demo,
  demoWorkspace,
  organization,
  demoBudget,
  rateLimit,
  user,
} from '@docket/db';
import { acquireDemoStream, consumeDemoBudget, DemoBudgetExceeded } from '@docket/auth';
import { eq, lt } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { onError } from '../../src/error';
import { admitDemoRequest, boundedDemoStream } from '../../src/lib/demo-admission';
import { withDemoRuntimeBudget } from '../../src/lib/demo-runtime-budget';

const subject = { userId: 'demo-budget-user' };
beforeAll(async () => {
  await migrate(db as never, {
    migrationsFolder: resolve(import.meta.dirname, '../../../../packages/db/drizzle'),
  });
  await db
    .insert(user)
    .values({ id: subject.userId, email: 'budget-review@example.com', name: 'Reviewer' });
  await db
    .insert(organization)
    .values({ id: 'demo-budget-org', name: 'Review workspace', slug: 'budget-review' });
  await db.insert(actor).values({
    id: 'demo-budget-actor',
    organizationId: 'demo-budget-org',
    kind: 'human',
    userId: subject.userId,
    displayName: 'Reviewer',
  });
  await db.insert(demo).values({
    id: 'demo-budget-demo',
    slug: 'budget-review',
    name: 'Review',
    sourceOrganizationId: 'demo-budget-org',
    mode: 'shared',
    allowedEmails: ['budget-review@example.com'],
  });
  await db
    .insert(demoWorkspace)
    .values({ demoId: 'demo-budget-demo', organizationId: 'demo-budget-org' });
});
beforeEach(async () => {
  await db.delete(demoBudget);
  await db.delete(rateLimit);
});

function app(): Hono {
  const result = new Hono();
  result.onError(onError);
  result.use('*', async (c, next) => {
    await admitDemoRequest(c, subject);
    await next();
  });
  result.get('/work', (c) => c.json({ accessible: true }));
  result.post('/work', async (c) => c.json(await c.req.json()));
  result.post('/v1/orgs', (c) => c.json({ created: true }));
  return result;
}

describe('reviewer abuse admission', () => {
  it('shares an atomic request bucket across simultaneous callers and rejects work before dispatch', async () => {
    const handler = app();
    const responses = await Promise.all(
      Array.from({ length: 125 }, async () => handler.request('/work')),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(120);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5);
    expect(
      Number(responses.find((response) => response.status === 429)?.headers.get('retry-after')),
    ).toBeGreaterThan(0);
  });
  it('counts bulk items and preserves admitted request bodies', async () => {
    const handler = app();
    const response = await handler.request('/work', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A real task' }),
    });
    expect(await response.json()).toEqual({ title: 'A real task' });
    const refused = await handler.request('/work', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: Array.from({ length: 100 }, () => ({ title: 'Bulk task' })),
      }),
    });
    expect(refused.status).toBe(429);
  });
  it('caps actual bytes without trusting a missing or false Content-Length and confines workspace creation', async () => {
    const handler = app();
    const oversized = await handler.request('/work', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '1' },
      body: JSON.stringify({ title: 'x'.repeat(1024 * 1024) }),
    });
    expect(oversized.status).toBe(413);
    expect((await handler.request('/v1/orgs', { method: 'POST', body: '{}' })).status).toBe(403);
  });
  it('retains daily limits across minute resets and leaves ordinary identities unaffected', async () => {
    const now = Date.UTC(2026, 9, 26, 1);
    for (let minute = 0; minute < 8; minute++)
      await consumeDemoBudget(subject, [{ kind: 'writes', amount: 30 }], now + minute * 60_000);
    await expect(
      consumeDemoBudget(subject, [{ kind: 'writes', amount: 11 }], now + 9 * 60_000),
    ).rejects.toBeInstanceOf(DemoBudgetExceeded);
    await expect(
      consumeDemoBudget({ userId: 'ordinary-user' }, [{ kind: 'writes', amount: 10000 }], now),
    ).resolves.toBeNull();
    await expect(consumeDemoBudget(subject, [{ kind: 'writes' }], now + 86_400_000)).resolves.toBe(
      'demo-budget-demo',
    );
  });
  it('preserves daily allowances when auth prunes its expired rate-limit rows', async () => {
    const now = Date.UTC(2026, 9, 26, 1);
    await consumeDemoBudget(subject, [{ kind: 'bytes', amount: 20 * 1024 * 1024 }], now);
    await db
      .insert(rateLimit)
      .values({ id: 'expired-auth', key: 'expired-auth', count: 1, lastRequest: now - 120_000 });
    // Better Auth's database storage prunes by lastRequest without a key namespace filter.
    await db.delete(rateLimit).where(lt(rateLimit.lastRequest, now - 60_000));
    await expect(
      consumeDemoBudget(subject, [{ kind: 'bytes' }], now + 120_000),
    ).rejects.toBeInstanceOf(DemoBudgetExceeded);
  });
  it('retains the reviewer budget when workspace membership is removed', async () => {
    await db.delete(actor).where(eq(actor.id, 'demo-budget-actor'));
    try {
      await expect(
        consumeDemoBudget(subject, [{ kind: 'writes', amount: 31 }]),
      ).rejects.toBeInstanceOf(DemoBudgetExceeded);
      await expect(
        consumeDemoBudget({ organizationId: 'demo-budget-org' }, [{ kind: 'writes', amount: 31 }]),
      ).rejects.toBeInstanceOf(DemoBudgetExceeded);
    } finally {
      await db.insert(actor).values({
        id: 'demo-budget-actor',
        organizationId: 'demo-budget-org',
        kind: 'human',
        userId: subject.userId,
        displayName: 'Reviewer',
      });
    }
  });
  it('caps actual model calls rather than only the HTTP launch or one execution generation', async () => {
    let calls = 0;
    const runtime = await withDemoRuntimeBudget(
      {
        async *streamTurn() {
          calls++;
          yield { type: 'text' as const, text: 'Review' };
        },
      },
      subject,
    );
    const run = async (): Promise<void> => {
      for await (const event of runtime.streamTurn({ system: 'Review', messages: [], tools: [] }))
        expect(event.type).toBe('text');
    };
    for (let turn = 0; turn < 3; turn++) await run();
    await expect(run()).rejects.toBeInstanceOf(DemoBudgetExceeded);
    expect(calls).toBe(3);
  });
  it('shares three stream slots, releases them and fences stale cleanup after crash recovery', async () => {
    const now = Date.now();
    const releases = await Promise.all(
      Array.from({ length: 3 }, () => acquireDemoStream('demo-budget-demo', now)),
    );
    await expect(acquireDemoStream('demo-budget-demo', now)).rejects.toBeInstanceOf(
      DemoBudgetExceeded,
    );
    await releases[0]?.();
    const replacement = await acquireDemoStream('demo-budget-demo', now);
    const recovered = await acquireDemoStream('demo-budget-demo', now + 90_001);
    await replacement();
    await recovered();
    await Promise.all(releases.map((release) => release()));
  });
  it('closes the underlying stream and releases admission at the finite lifetime', async () => {
    vi.useFakeTimers();
    try {
      const canceled = vi.fn();
      const released = vi.fn(async () => undefined);
      const response = boundedDemoStream(
        new Response(new ReadableStream({ cancel: canceled })),
        released,
      );
      const read = response.body?.getReader().read();
      await vi.advanceTimersByTimeAsync(60_001);
      expect(await read).toMatchObject({ done: true });
      expect(canceled).toHaveBeenCalledOnce();
      expect(released).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
