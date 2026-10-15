import { foreignKey, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Same-tenant owning Program reference without coupling schedule drafts to work table initialization. */
export function scheduleSeriesIdentityConstraints(
  t: { id: AnyPgColumn; organizationId: AnyPgColumn; ownerProgramId: AnyPgColumn },
  program: { id: AnyPgColumn; organizationId: AnyPgColumn },
) {
  return [
    uniqueIndex('schedule_series_identity_unique').on(t.id, t.organizationId),
    foreignKey({
      name: 'schedule_series_program_tenant_fk',
      columns: [t.ownerProgramId, t.organizationId],
      foreignColumns: [program.id, program.organizationId],
    }).onDelete('restrict'),
  ];
}
/** Exact occurrence-to-series revision relationship and independently unique historical/run acceptance aliases. */
export function scheduleOccurrenceIdentityConstraints(
  t: {
    organizationId: AnyPgColumn;
    legacyInstanceId: AnyPgColumn;
    acceptanceOrdinal: AnyPgColumn;
    seriesRevisionId: AnyPgColumn;
    seriesId: AnyPgColumn;
    scheduledFor: AnyPgColumn;
    externalOccurrenceKey: AnyPgColumn;
    continuedFromOccurrenceId: AnyPgColumn;
  },
  revision: { id: AnyPgColumn; seriesId: AnyPgColumn; organizationId: AnyPgColumn },
) {
  return [
    uniqueIndex('process_occurrence_revision_date_uq')
      .on(t.seriesId, t.seriesRevisionId, t.scheduledFor)
      .where(sql`${t.externalOccurrenceKey} is null and ${t.continuedFromOccurrenceId} is null`),
    uniqueIndex('process_occurrence_series_external_uq')
      .on(t.seriesId, t.externalOccurrenceKey)
      .where(sql`${t.externalOccurrenceKey} is not null`),
    uniqueIndex('schedule_occurrence_legacy_instance_unique').on(
      t.organizationId,
      t.legacyInstanceId,
    ),
    uniqueIndex('schedule_occurrence_acceptance_unique').on(t.acceptanceOrdinal),
    foreignKey({
      name: 'schedule_occurrence_revision_tenant_fk',
      columns: [t.seriesRevisionId, t.seriesId, t.organizationId],
      foreignColumns: [revision.id, revision.seriesId, revision.organizationId],
    }).onDelete('restrict'),
  ];
}

/** Same-tenant revision identity, independent of the legacy process revision alias. */
export function scheduleRevisionIdentityConstraints(
  t: { id: AnyPgColumn; seriesId: AnyPgColumn; organizationId: AnyPgColumn },
  series: { id: AnyPgColumn; organizationId: AnyPgColumn },
) {
  return [
    uniqueIndex('schedule_revision_identity_unique').on(t.id, t.seriesId, t.organizationId),
    foreignKey({
      name: 'schedule_revision_series_tenant_fk',
      columns: [t.seriesId, t.organizationId],
      foreignColumns: [series.id, series.organizationId],
    }).onDelete('cascade'),
  ];
}
