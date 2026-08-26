/**
 * Install the Docket Pro fixture in the disposable database used by Playwright CI.
 *
 * @remarks
 * Product-surface regression tests predate paid product gates. They exercise fully enabled
 * workspaces unless a billing test states otherwise. The E2E workflow calls this script after
 * migrations and before the API starts. Production and ordinary local databases never call it.
 */
import { closeDb, db } from '../packages/db/src/index';

import { installTestProductEntitlementFixture } from '../apps/api/tests/support/product-entitlement';

interface BatchSqlClient {
  exec(sql: string): Promise<unknown>;
}

function batchSqlClient(): BatchSqlClient {
  const client: unknown = Reflect.get(db, '$client');
  if (
    typeof client !== 'object' ||
    client === null ||
    typeof Reflect.get(client, 'exec') !== 'function'
  ) {
    throw new Error('The E2E product fixture requires the disposable PGlite database.');
  }
  return client as BatchSqlClient;
}

try {
  await installTestProductEntitlementFixture(batchSqlClient());
} finally {
  await closeDb();
}
