/**
 * `@docket/db` — offline migration runner (`pnpm db:migrate`).
 *
 * @remarks
 * Applies the generated `./drizzle` migrations using the driver matching the
 * `DATABASE_URL` scheme, so the zero-external-accounts build can migrate an embedded
 * PGlite database in-process with no service, while prod migrates Neon/Postgres over
 * the unpooled string. This sidesteps `drizzle-kit migrate`'s driver coupling.
 */
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { openPglite } from './client';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

/**
 * Apply the generated `./drizzle` migrations using the driver matching the
 * `DATABASE_URL` (or `DATABASE_URL_UNPOOLED`) scheme, defaulting to an on-disk PGlite.
 *
 * @remarks
 * Exported so it is unit-testable in-process (call it with a `pglite://memory` URL);
 * the CLI entry point below invokes it as a boot side effect.
 *
 * @returns a promise that resolves once migrations are applied and the client closed.
 */
export async function main(): Promise<void> {
  const url = process.env['DATABASE_URL_UNPOOLED'] ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set — see .env.example (local: pglite://.data/docket).');
  }

  if (url.startsWith('pglite:')) {
    const client = openPglite(url);
    await migratePglite(drizzlePglite(client), { migrationsFolder });
    await client.close();
  } else {
    const pgUrl = url.startsWith('neon:') ? url.replace(/^neon:/, 'postgres:') : url;
    const client = postgres(pgUrl, {
      max: 1,
      prepare: false,
      // The drizzle migrator runs `CREATE SCHEMA/TABLE IF NOT EXISTS`, which Postgres
      // answers with benign NOTICEs (42P06 schema exists / 42P07 relation exists) on
      // every re-run. postgres.js prints NOTICEs by default; silence just these two so a
      // no-op migrate (the common case on `pnpm dev`) stays quiet. Real notices surface.
      onnotice: (notice) => {
        if (notice.code === '42P06' || notice.code === '42P07') return;
        console.warn(notice);
      },
    });
    await migratePostgres(drizzlePostgres(client), { migrationsFolder });
    await client.end();
  }

  console.log(`✓ migrations applied (${url.split(':')[0]})`);
}

/* v8 ignore start -- boot side effect: runs only as the `pnpm db:migrate` CLI entry, not on import (untestable in-process). */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
/* v8 ignore stop */
