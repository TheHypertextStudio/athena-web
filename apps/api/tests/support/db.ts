import type * as DbModule from '@docket/db';
import { PGlite } from '@electric-sql/pglite';

import { loadPgliteTemplate } from './pglite-template';
import { installTestProductEntitlementFixture } from './product-entitlement';

let migratedDb: Promise<typeof DbModule> | undefined;

function pgliteClient(db: typeof DbModule.db): Pick<PGlite, 'exec'> {
  const client: unknown = Reflect.get(db, '$client');
  if (!(client instanceof PGlite)) {
    throw new Error('API tests require the PGlite test driver exposed by @docket/db.');
  }
  return client;
}

/** Install the default Docket Pro grant used by fully enabled API test fixtures. */
export async function installTestProductFixture(db: typeof DbModule.db): Promise<void> {
  await installTestProductEntitlementFixture(pgliteClient(db));
}

/**
 * Load `@docket/db` once for a worker, backed by a PGlite that already holds the migrated schema.
 *
 * @remarks
 * Every database-backed test file runs in its own process, so anything done here is paid once per
 * file: about 400 times per run. Replaying the ~140 generated migrations cost about three CPU
 * seconds each time, which is most of why the suite took over twenty minutes. The schema is built
 * once by the global setup (see `pglite-template.ts`) and each worker boots from that snapshot
 * instead. Test databases do not need Drizzle's migration journal, only the migrated schema, and
 * the snapshot is produced from the exact SQL production runs. The product fixture stays per-file
 * because it is one small statement, and not every suite that shares the snapshot wants it.
 */
export async function getMigratedDb(): Promise<typeof DbModule> {
  migratedDb ??= (async () => {
    const dbmod = await import('@docket/db');
    dbmod.setPgliteTemplate(await loadPgliteTemplate());
    await installTestProductFixture(dbmod.db);
    return dbmod;
  })();
  return migratedDb;
}
