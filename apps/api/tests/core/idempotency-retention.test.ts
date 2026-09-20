import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import { idempotencyFor } from '../../src/lib/idempotency';
import { fakeSession, getDb } from '../support/routes-harness';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  await getDb();
});

describe('idempotency receipt retention', () => {
  it('leases an in-progress request briefly and retains its completed receipt for 48 hours', async () => {
    const database = await getDb();
    const userId = `idempotency-object-retention-${crypto.randomUUID()}`;
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('session', fakeSession(userId));
      await next();
    });
    app.use('*', idempotencyFor('json-receipt'));
    app.onError(onError);
    const entered = deferred();
    const release = deferred();
    app.post('/creates', async (c) => {
      entered.resolve();
      await release.promise;
      return c.json({ id: 'created' }, 201);
    });
    const key = `retention-${crypto.randomUUID()}`;
    const pending = app.request('/creates', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body: '{}',
    });

    await entered.promise;
    const [claim] = await database.db
      .select()
      .from(database.apiIdempotencyReceipt)
      .where(
        and(
          eq(database.apiIdempotencyReceipt.userId, userId),
          eq(database.apiIdempotencyReceipt.key, key),
        ),
      );
    expect(claim?.status).toBe('in_progress');
    expect((claim?.expiresAt.getTime() ?? 0) - (claim?.createdAt.getTime() ?? 0)).toBeGreaterThan(
      4 * 60 * 1000,
    );

    release.resolve();
    expect((await pending).status).toBe(201);
    const [completed] = await database.db
      .select()
      .from(database.apiIdempotencyReceipt)
      .where(
        and(
          eq(database.apiIdempotencyReceipt.userId, userId),
          eq(database.apiIdempotencyReceipt.key, key),
        ),
      );
    expect(completed?.status).toBe('completed');
    expect(
      (completed?.expiresAt.getTime() ?? 0) - (completed?.createdAt.getTime() ?? 0),
    ).toBeGreaterThan(47 * 60 * 60 * 1000);
  });
});
