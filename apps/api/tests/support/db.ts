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
    throw new Error('API tests require the PGlite test driver exposed by @docket/db.');
  }
  return client;
}

/**
 * Load `@docket/db` once for a worker and bootstrap its PGlite schema.
 *
 * @remarks
 * Test databases do not need Drizzle's migration journal; they need the migrated schema.
 * Executing the generated SQL statements directly avoids the slower migrator bookkeeping
 * on every API route/MCP suite while preserving the exact schema SQL production uses.
 */
export async function getMigratedDb(): Promise<typeof DbModule> {
  migratedDb ??= (async () => {
    const dbmod = await import('@docket/db');
    await pgliteClient(dbmod.db).exec(loadBootstrapSql());
    return dbmod;
  })();
  return migratedDb;
}
