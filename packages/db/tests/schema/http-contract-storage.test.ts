import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, describe, expect, it } from 'vitest';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');

describe('public HTTP contract storage', () => {
  let client: PGlite | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('creates a versioned receipt store and a work-schedule aggregate revision', async () => {
    client = new PGlite('memory://');
    const database = drizzle(client);
    await migrate(database, { migrationsFolder });

    const result = await client.query<{
      receipt: string | null;
      scheduleRevision: string | null;
    }>(`
      select
        to_regclass('public.api_idempotency_receipt')::text as receipt,
        to_regclass('public.work_schedule_aggregate_revision')::text as "scheduleRevision"
    `);

    expect(result.rows[0]).toEqual({
      receipt: 'api_idempotency_receipt',
      scheduleRevision: 'work_schedule_aggregate_revision',
    });
  });
});
