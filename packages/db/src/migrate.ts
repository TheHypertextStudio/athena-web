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
 * Enum values that must be COMMITTED before Drizzle opens its all-migrations transaction.
 *
 * @remarks
 * PostgreSQL requires an `ALTER TYPE … ADD VALUE` to commit before that value can be *used*,
 * while Drizzle 0.45 runs every pending migration in one transaction. A migration that adds a
 * value and any later one that references it therefore deadlock (`55P04`) on a database paused
 * between the two. Each statement here is the idempotent pre-commit for one such value:
 *
 * - `integration_status.pending` — added by 0004, used as a column default by 0005.
 * - `sync_run_purpose.notion_mirror` — added by 0075, written by the Notion mirror's sync runs.
 * - `sync_run_purpose.activity_pull` — written by the activity poll's sync runs.
 * - `event_kind.meeting_attended` — written by the calendar activity projection.
 *
 * The last two are listed for consistency with the `notion_mirror` precedent and as defence in
 * depth, not because a migration references them today: 55P04 bites only when a *migration
 * statement* uses a value added in the same transaction, and these are only ever written by
 * application code, in a later transaction. What *is* load-bearing either way is the `IF NOT
 * EXISTS` — because these run first, the corresponding migration statement would otherwise fail on
 * a duplicate label on every database the preflight has already touched, so **every value listed
 * here must be added with `IF NOT EXISTS` in its migration too** (0004 line 3 is the precedent).
 *
 * Fresh databases create each enum complete in its own `CREATE TYPE`, so an undefined type
 * (`42704`) is the expected new-database case and is skipped rather than treated as a failure.
 */
const ENUM_PREFLIGHT: readonly string[] = [
  `ALTER TYPE "public"."integration_status" ADD VALUE IF NOT EXISTS 'pending' BEFORE 'connected'`,
  `ALTER TYPE "public"."sync_run_purpose" ADD VALUE IF NOT EXISTS 'notion_mirror'`,
  `ALTER TYPE "public"."sync_run_purpose" ADD VALUE IF NOT EXISTS 'activity_pull'`,
  `ALTER TYPE "public"."event_kind" ADD VALUE IF NOT EXISTS 'meeting_attended'`,
];

/**
 * Apply every {@link ENUM_PREFLIGHT} statement, tolerating a not-yet-created type.
 *
 * @param execute - Runs one SQL statement on the open connection, outside the migrator's
 *   transaction. Each statement is independent: one skipped type never suppresses the rest.
 */
async function ensureEnumValues(execute: (statement: string) => Promise<unknown>): Promise<void> {
  for (const statement of ENUM_PREFLIGHT) {
    try {
      await execute(statement);
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === '42704') {
        continue;
      }
      throw err;
    }
  }
}

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
  // Prefer the unpooled URL for migrations, but treat an empty string (the common local
  // case — `.env.local` sets `DATABASE_URL_UNPOOLED=`) as absent and fall back to DATABASE_URL.
  const unpooled = process.env['DATABASE_URL_UNPOOLED'];
  const appUrl = process.env['DATABASE_URL'];
  const url = unpooled !== undefined && unpooled !== '' ? unpooled : appUrl;
  if (!url) {
    throw new Error('DATABASE_URL is not set — see .env.example (local: pglite://.data/docket).');
  }

  // Refuse to migrate a *different database than the app reads*. The two URLs may legitimately
  // differ (prod pairs a pooled `neon:` app URL with an unpooled `postgres:` DDL endpoint — same
  // database, different endpoint), but the embedded `pglite:` backend is a different database
  // entirely: no endpoint of a TCP Postgres is ever the same store as a directory on disk. A
  // mismatch there migrates one database while the app reads the other, and nothing fails at the
  // time — the app simply drifts further behind on every run until a migration finally collides
  // with schema it never recorded applying.
  if (appUrl && url.startsWith('pglite:') !== appUrl.startsWith('pglite:')) {
    throw new Error(
      'DATABASE_URL_UNPOOLED and DATABASE_URL point at different database backends ' +
        `(migrating ${url.startsWith('pglite:') ? 'PGlite' : 'Postgres'} while the app reads ` +
        `${appUrl.startsWith('pglite:') ? 'PGlite' : 'Postgres'}). Leave DATABASE_URL_UNPOOLED ` +
        'empty for the embedded PGlite setup — see .env.example.',
    );
  }

  if (url.startsWith('pglite:')) {
    const client = openPglite(url);
    await ensureEnumValues((statement) => client.exec(statement));
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
        if (notice['code'] === '42P06' || notice['code'] === '42P07') return;
        console.warn(notice);
      },
    });
    await ensureEnumValues((statement) => client.unsafe(statement));
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
