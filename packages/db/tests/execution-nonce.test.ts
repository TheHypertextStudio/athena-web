import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executionRequestNonce } from '../src/schema';
import type { ExecutionRequestDirection } from '../src/schema';

const client = new PGlite('memory://');
const db = drizzle(client);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
});

afterAll(async () => {
  await client.close();
});

describe('execution request nonce persistence', () => {
  it('rejects replay in one direction while keeping the two secrets independent', async () => {
    const expiresAt = new Date('2026-07-16T12:05:00.000Z');
    await db
      .insert(executionRequestNonce)
      .values({ direction: 'cloudflare_to_docket', nonce: 'nonce-1', expiresAt });

    await expect(
      db
        .insert(executionRequestNonce)
        .values({ direction: 'cloudflare_to_docket', nonce: 'nonce-1', expiresAt }),
    ).rejects.toThrow();

    await expect(
      db
        .insert(executionRequestNonce)
        .values({ direction: 'docket_to_cloudflare', nonce: 'nonce-1', expiresAt }),
    ).resolves.toBeDefined();
  });

  it('rejects unknown authentication directions at the database boundary', async () => {
    await expect(
      db.insert(executionRequestNonce).values({
        direction: 'unknown' as ExecutionRequestDirection,
        nonce: 'nonce-2',
        expiresAt: new Date('2026-07-16T12:05:00.000Z'),
      }),
    ).rejects.toThrow();
  });
});
