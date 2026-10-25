import { afterAll, beforeAll, expect, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { rawResultRows } from '../../src/lib/raw-result';

// The dedicated PostgreSQL runner migrates and seeds its disposable database before this entry.
// Reuse the ordinary service/route assertions with the actual driver instead of a PGlite template.
vi.mock('../support/db', () => ({ getMigratedDb: async () => await import('@docket/db') }));

import './work-schedule-root-placement.test';
import '../lib/private-definition-publication.test';

beforeAll(async () => {
  expect(process.env['DATABASE_URL']).toMatch(/^postgres(?:ql)?:/);
  const schema = await import('@docket/db');
  const [server] = rawResultRows<{ database: string; version: string }>(
    await schema.db.execute(sql`select current_database() as database, version() as version`),
  );
  const expectedDatabase = process.env['DOCKET_SCHEDULE_POSTGRES_DATABASE'];
  expect(expectedDatabase).toBeTruthy();
  expect(server?.database).toBe(expectedDatabase);
  console.log(server?.version);
});
afterAll(async () => {
  const schema = await import('@docket/db');
  await schema.closeDb();
});
