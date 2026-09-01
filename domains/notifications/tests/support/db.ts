/**
 * Test-only PGlite schema bootstrap for `@docket/notifications`'s DB-backed `dispatch/*` tests.
 *
 * @remarks
 * Mirrors `apps/api/tests/support/db.ts`: rather than hand-rolling SQL (which drifts from the
 * real schema) or running Drizzle's slower migration-journal bookkeeping, this executes the
 * exact generated migration SQL directly against the embedded PGlite instance `@docket/db`
 * already opened for `DATABASE_URL=pglite://memory` (see `vite.config.ts`). One bootstrap per
 * test file (Vitest isolates module state per file, so the lazy `@docket/db` singleton and this
 * module's cache are both fresh each time).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type * as DbModule from '@docket/db';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let bootstrapSql: string | undefined;
let migratedDb: Promise<typeof DbModule> | undefined;

/** Read the generated migration SQL once per worker. */
function loadBootstrapSql(): string {
  bootstrapSql ??= readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(resolve(MIGRATIONS, file), 'utf8'))
    .join('\n');
  return bootstrapSql;
}

function pgliteClient(db: typeof DbModule.db): Pick<PGlite, 'exec'> {
  const client: unknown = Reflect.get(db, '$client');
  if (!(client instanceof PGlite)) {
    throw new Error('Notification dispatch tests require the PGlite test driver from @docket/db.');
  }
  return client;
}

/**
 * Load `@docket/db` once for this test file and bootstrap its PGlite schema.
 *
 * @returns the migrated `@docket/db` module (tables + the ready `db` client).
 */
export async function getMigratedDb(): Promise<typeof DbModule> {
  migratedDb ??= (async () => {
    const dbmod = await import('@docket/db');
    await pgliteClient(dbmod.db).exec(loadBootstrapSql());
    return dbmod;
  })();
  return migratedDb;
}
