/**
 * `@docket/db` — the Drizzle database client, with driver selected from the URL scheme.
 *
 * @remarks
 * The database is real Postgres in every mode (never mocked);
 * only the driver swaps, chosen from the `DATABASE_URL` scheme:
 *   - `pglite:`              embedded in-process Postgres (zero-account build/tests)
 *   - `postgres:`/`postgresql:` node-postgres-js (local Docker, or Neon over TCP)
 *   - `neon:`                rewritten to `postgres:` and served by postgres-js
 *
 * Flipping to production is purely supplying a Neon `DATABASE_URL`. The exported
 * {@link db} is typed against the full schema + relations so `db.query.*` works.
 */
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';

import * as relations from './relations';
import * as schema from './schema';

/** The combined drizzle schema namespace (tables + relations). */
export const fullSchema = { ...schema, ...relations };

/** The drizzle client type, parameterized over the full Docket schema. */
export type Database = PgDatabase<PgQueryResultHKT, typeof fullSchema>;

/**
 * Absolute monorepo root, derived from this file's location
 * (`<root>/packages/db/src/client.ts` → three levels up).
 *
 * @remarks
 * Used to anchor a relative `pglite:` data dir so the migration runner (cwd
 * `packages/db`) and the API (cwd `apps/api`) resolve to the **same** on-disk database
 * — `process.cwd()` would otherwise point each at a different file.
 */
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Resolve the data dir / `memory://` target from a `pglite:` URL.
 *
 * @remarks
 * `memory`/`:memory:`/empty → an ephemeral in-memory database. A relative on-disk path
 * (e.g. `.data/docket`) is anchored to {@link WORKSPACE_ROOT} (NOT `process.cwd()`) so
 * every process opens the identical database file regardless of its working directory.
 * Absolute paths are returned verbatim. Exported so the migration runner reuses the exact
 * same resolution.
 *
 * @param url - The `pglite:`-scheme `DATABASE_URL`.
 * @returns the PGlite data-dir argument.
 */
export function pgliteDataDir(url: string): string {
  const rest = url.replace(/^pglite:(\/\/)?/, '');
  if (!rest || rest === 'memory' || rest === ':memory:' || rest === 'memory://') return 'memory://';
  return isAbsolute(rest) ? rest : resolve(WORKSPACE_ROOT, rest);
}

/**
 * Open a PGlite client from a `pglite:` URL, creating the on-disk data dir's parent first.
 *
 * @remarks
 * PGlite's `mkdir` for the data dir is non-recursive, so an on-disk target like
 * `<root>/.data/docket` fails with `ENOENT` unless its parent (`<root>/.data`) already
 * exists. This pre-creates that parent (idempotent) so the first migration/boot succeeds
 * on a clean checkout. `memory://` targets need no directory. Shared by {@link createDb}
 * and the migration runner so both open the database identically.
 *
 * @param url - The `pglite:`-scheme `DATABASE_URL`.
 * @returns a ready PGlite client.
 */
export function openPglite(url: string): PGlite {
  const dataDir = pgliteDataDir(url);
  if (dataDir !== 'memory://') {
    mkdirSync(dirname(dataDir), { recursive: true });
  }
  return new PGlite(dataDir);
}

/** Construct the driver-appropriate drizzle client from `DATABASE_URL`. */
function createDb(): Database {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set — see .env.example (local: pglite://.data/docket).');
  }

  if (url.startsWith('pglite:')) {
    const client = openPglite(url);
    closeCached = () => client.close();
    return drizzlePglite(client, { schema: fullSchema });
  }

  /* v8 ignore start -- live-DB driver IO boundary: opening a real postgres/Neon
     connection can only be exercised against a running service (or a low-value
     mock-wiring test), so it is verified by really connecting in dev/prod. */
  const pgUrl = url.startsWith('neon:') ? url.replace(/^neon:/, 'postgres:') : url;
  // `prepare:false` keeps the client compatible with Neon's pooled (pgbouncer) endpoint.
  const client = postgres(pgUrl, { prepare: false });
  closeCached = () => client.end();
  return drizzlePostgres(client, { schema: fullSchema });
  /* v8 ignore stop */
}

let cached: Database | undefined;
let closeCached: (() => Promise<void>) | undefined;

/** Lazily construct (once) and return the driver-appropriate client. */
function initDb(): Database {
  return (cached ??= createDb());
}

/**
 * The shared Drizzle database client.
 *
 * @remarks
 * Lazy: the underlying connection is constructed on first property access, not at
 * import time — so importing `@docket/db` is side-effect-free (drizzle-kit reads the
 * schema, and tests can set `DATABASE_URL` before the first query).
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, _receiver) {
    const real = initDb();
    const value = Reflect.get(real, prop, real) as unknown;
    return typeof value === 'function' ? (value.bind(real) as unknown) : value;
  },
});

/**
 * Close the lazily opened database client and clear the singleton.
 *
 * @remarks
 * Production processes normally keep {@link db} open for their lifetime. Tests and
 * short-lived scripts need a deterministic teardown path so embedded PGlite workers
 * and postgres sockets cannot survive past the owning process/task.
 */
export async function closeDb(): Promise<void> {
  const close = closeCached;
  cached = undefined;
  closeCached = undefined;
  if (close) await close();
}
