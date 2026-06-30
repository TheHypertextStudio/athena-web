import * as schema from '@docket/db';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { USER_KEYED_NO_FK_TABLES } from '../../src/account/lifecycle';

/**
 * Enumerate every schema table that has a `user_id` column with NO foreign key on it — exactly
 * the tables a raw `DELETE user` would orphan, which {@link purgeUser} must clean up by hand.
 */
function tablesWithUnreferencedUserId(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (!config.columns.some((c) => c.name === 'user_id')) continue;
    const fkColumns = new Set(
      config.foreignKeys.flatMap((fk) => fk.reference().columns.map((c) => c.name)),
    );
    if (!fkColumns.has('user_id')) names.push(config.name);
  }
  return names.sort();
}

describe('purgeUser no-FK coverage (schema-drift guard)', () => {
  it('covers exactly the tables with a no-FK user_id column', () => {
    const covered = USER_KEYED_NO_FK_TABLES.map((t) => getTableConfig(t).name).sort();
    // If a new table gains a no-FK user_id column, add it to USER_KEYED_NO_FK_TABLES — otherwise
    // a purge would silently orphan its rows and this assertion fails.
    expect(tablesWithUnreferencedUserId()).toEqual(covered);
  });
});
