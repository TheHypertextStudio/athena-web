import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type * as DbModule from '@docket/db';
import { sql } from 'drizzle-orm';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let bootstrapStatements: readonly string[] | undefined;
let migratedDb: Promise<typeof DbModule> | undefined;

/**
 * Set the environment contract required before the shared DB/env modules initialize.
 */
export function configureApiTestEnv(): void {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
}

function loadBootstrapStatements(): readonly string[] {
  bootstrapStatements ??= readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) =>
      readFileSync(resolve(MIGRATIONS, file), 'utf8').split('--> statement-breakpoint'),
    )
    .map((statement) => statement.trim())
    .filter(Boolean);
  return bootstrapStatements;
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
  configureApiTestEnv();
  migratedDb ??= (async () => {
    const dbmod = await import('@docket/db');
    for (const statement of loadBootstrapStatements()) {
      await dbmod.db.execute(sql.raw(statement));
    }
    return dbmod;
  })();
  return migratedDb;
}

configureApiTestEnv();
