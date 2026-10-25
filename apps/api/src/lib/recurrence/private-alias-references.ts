import type { Database } from '@docket/db';
import { sql } from 'drizzle-orm';
import { rawResultRows } from '../raw-result';

/**
 * Select canonical authoring only after the actual installed alias constraints and writer barrier verify.
 * The private migration reader accepts no caller flag or identity; expansion/deferred upgrades remain retained.
 */
export async function canonicalAliasReferencesEnforced(database: Database): Promise<boolean> {
  const [installed] = rawResultRows<{ present: boolean }>(
    await database.execute(
      sql`select to_regprocedure('public.docket_private_alias_references_enforced()') is not null as present`,
    ),
  );
  if (!installed?.present) return false;
  const [state] = rawResultRows<{ ready: boolean }>(
    await database.execute(sql`select public.docket_private_alias_references_enforced() as ready`),
  );
  return state?.ready === true;
}
