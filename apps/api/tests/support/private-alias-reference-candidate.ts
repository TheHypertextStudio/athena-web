import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Database } from '@docket/db';
import { sql } from 'drizzle-orm';

/**
 * Apply the unjournaled alias-reference enforcement candidate to a test database.
 * Production keeps this boundary closed until the migration is journaled with its runtime consumers.
 */
export async function installPrivateAliasReferenceCandidate(database: Database): Promise<void> {
  const body = await readFile(
    resolve(import.meta.dirname, 'private-alias-reference-candidate.sql'),
    'utf8',
  );
  for (const statement of body.split('--> statement-breakpoint')) {
    if (statement.trim()) await database.execute(sql.raw(statement));
  }
}
