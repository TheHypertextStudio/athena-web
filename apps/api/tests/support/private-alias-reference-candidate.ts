import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Database } from '@docket/db';
import { sql } from 'drizzle-orm';
import { rawResultRows } from '../../src/lib/raw-result';

/** Apply the reviewed candidate on a disposable predecessor fixture; installed normal schemas are left untouched. */
export async function installPrivateAliasReferenceCandidate(database: Database): Promise<void> {
  const [state] = rawResultRows<{ present: boolean }>(
    await database.execute(
      sql`select to_regprocedure('public.docket_enforce_private_alias_references()') is not null as present`,
    ),
  );
  if (state?.present) return;
  const path =
    process.env['DOCKET_ALIAS_REFERENCE_MIGRATION'] ??
    resolve(
      import.meta.dirname,
      '../../../../packages/db/drizzle/0180_private_definition_alias_references.sql',
    );
  await database.transaction(async (tx) => {
    for (const statement of readFileSync(path, 'utf8').split('--> statement-breakpoint'))
      if (statement.trim()) await tx.execute(sql.raw(statement));
  });
}
