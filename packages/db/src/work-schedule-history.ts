import { sql } from 'drizzle-orm';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';

/** Restricted immutable history page; caller must authorize the owning occurrence before reading. */
export interface ScheduleHistoricalReferencePage {
  readonly references: readonly Readonly<Record<string, unknown>>[];
  readonly nextOffset: number | null;
}
/** Read complete oversized historical forests in bounded pages without ever turning them into execution. */
export async function readScheduleHistoricalReferences(
  connection: BlueprintMigrationConnection,
  input: { organizationId: string; occurrenceId: string; offset?: number; limit?: number },
): Promise<ScheduleHistoricalReferencePage> {
  const offset = input.offset ?? 0,
    limit = input.limit ?? 100;
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 500
  )
    throw new RangeError('History pages need a nonnegative offset and 1 through 500 references.');
  const rows = await migrationRows<{ reference: Readonly<Record<string, unknown>> }>(
    connection,
    sql`
    select e.value as reference from process_occurrence o cross join lateral jsonb_array_elements(o.historical_archive->'references') with ordinality e(value,position)
    where o.id=${input.occurrenceId} and o.organization_id=${input.organizationId} and e.position>${offset}
    order by e.position limit ${limit + 1}`,
  );
  return {
    references: rows.slice(0, limit).map((row) => row.reference),
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}
