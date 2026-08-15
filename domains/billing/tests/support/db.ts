/**
 * An embedded database for the billing application tests.
 *
 * @remarks
 * `lifecycle.ts` and `entitlement.ts` are state machines expressed as guarded SQL — the behavior
 * that matters is which rows a `WHERE` clause refuses to touch, so a hand-written fake would
 * assert nothing real. Both modules take the {@link Database} explicitly precisely so a test can
 * hand them an embedded PGlite client, which is what this does.
 *
 * The schema is created by executing the generated migration SQL rather than by running Drizzle's
 * migrator: tests need the migrated shape, not the journal bookkeeping, and this keeps the schema
 * byte-identical to production's. Mirrors `apps/api/tests/support/db.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type * as DbModule from '@docket/db';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let migrated: Promise<typeof DbModule> | undefined;

/** The minimum surface this needs from the underlying embedded client. */
interface ExecutesSql {
  exec(sql: string): Promise<unknown>;
}

/**
 * Load `@docket/db` once per worker with its schema already applied.
 *
 * @returns The `@docket/db` module, backed by a migrated embedded database.
 * @throws {Error} When `DATABASE_URL` does not select the embedded driver.
 */
export async function getMigratedDb(): Promise<typeof DbModule> {
  migrated ??= (async () => {
    const dbmod = await import('@docket/db');
    const client: unknown = Reflect.get(dbmod.db, '$client');
    if (!client || typeof (client as ExecutesSql).exec !== 'function') {
      throw new Error('billing tests require the embedded PGlite driver (DATABASE_URL=pglite:).');
    }
    const sql = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .map((file) => readFileSync(resolve(MIGRATIONS, file), 'utf8'))
      .join('\n');
    await (client as ExecutesSql).exec(sql);
    return dbmod;
  })();
  return migrated;
}
