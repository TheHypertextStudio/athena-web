import { or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/** Narrow candidates through the existing facet GIN index before visibility and pagination. */
export function searchWorkTemplateCondition(
  facet: SQLWrapper,
  ids: readonly string[],
): SQL | undefined {
  if (ids.length === 0) return undefined;
  return or(...ids.map((id) => sql`${facet} @> ${JSON.stringify({ workTypeId: id })}::jsonb`));
}

/** The identity migration preserves authored freshness, so this facet needs its own repair check. */
export function missingWorkTemplateIdentity(
  sourceTable: string,
  row: { workTypeId?: unknown },
  facet: Record<string, unknown>,
): boolean {
  return (
    ['task', 'project', 'program', 'initiative'].includes(sourceTable) &&
    typeof row.workTypeId === 'string' &&
    facet['workTypeId'] !== row.workTypeId
  );
}
