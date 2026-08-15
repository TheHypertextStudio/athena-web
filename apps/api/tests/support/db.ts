import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type * as DbModule from '@docket/db';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let bootstrapSql: string | undefined;
let migratedDb: Promise<typeof DbModule> | undefined;

/**
 * Give legacy product-surface fixtures the product they implicitly exercised before product billing.
 *
 * @remarks
 * Most API tests insert organizations directly instead of entering through the organization
 * creation route. Those fixtures represent a fully enabled workspace; product-gating tests
 * explicitly delete this grant before asserting the free boundary. Keeping the compatibility in
 * the database fixture covers every direct insert without adding product setup to unrelated tests.
 */
const TEST_SHARED_PRODUCT_FIXTURE_SQL = `
CREATE OR REPLACE FUNCTION test_grant_docket_pro_to_shared_org()
RETURNS trigger AS $$
BEGIN
  INSERT INTO organization_product_entitlement (
    organization_id,
    product_key,
    status,
    source
  ) VALUES (
    NEW.id,
    'docket_pro',
    'active'::product_entitlement_status,
    'complimentary'::product_entitlement_source
  ) ON CONFLICT (organization_id, product_key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER test_shared_org_docket_pro
AFTER INSERT ON organization
FOR EACH ROW
EXECUTE FUNCTION test_grant_docket_pro_to_shared_org();
`;

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

/** Install the default Docket Pro grant used by fully enabled API test fixtures. */
export async function installTestProductFixture(db: typeof DbModule.db): Promise<void> {
  await pgliteClient(db).exec(TEST_SHARED_PRODUCT_FIXTURE_SQL);
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
    const client = pgliteClient(dbmod.db);
    await client.exec(loadBootstrapSql());
    await installTestProductFixture(dbmod.db);
    return dbmod;
  })();
  return migratedDb;
}
