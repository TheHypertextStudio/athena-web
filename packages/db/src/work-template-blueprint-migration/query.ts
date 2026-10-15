import type { SQL } from 'drizzle-orm';
import type { Database } from '../client';

/** Frozen checkpoint transaction surface; SQL projections name every historical column. */
export type BlueprintMigrationConnection = Pick<Database, 'execute'>;
/** Typed raw SQL rows for the frozen migration island. */
export async function migrationRows<T>(
  connection: BlueprintMigrationConnection,
  query: SQL,
): Promise<T[]> {
  const result: unknown = await connection.execute(query);
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray(result.rows))
    return result.rows as T[];
  throw new Error('Unexpected blueprint migration query result.');
}
