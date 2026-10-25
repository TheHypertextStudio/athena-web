import { sql } from 'drizzle-orm';
import { hashScheduleArchive, readProvedScheduleSource } from './work-schedule-archive';
import { ScheduleSourceProofError } from './work-schedule-archive-source';
import type { ImportedHistoryReceipt } from '@docket/work/work-schedule-import-receipt';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';

/** Private retryable review codes; source uncertainty never becomes an execution disposition. */
export type ScheduleHistoryReviewCode =
  'current_run_requires_barrier' | 'original_source_unproved' | 'history_identity_unproved';
/** Same-row preparation review; mutable so a later independently proved retry can clear it. */
export interface ScheduleHistoryImportReview {
  readonly kind: 'history_import_review';
  readonly revision: 1;
  readonly execution: 'nonexecuting';
  readonly code: ScheduleHistoryReviewCode;
}
/** Fully locked occurrence metadata and original source pointers for history preparation. */
export interface ScheduleHistoryImportProof {
  readonly identity: ImportedHistoryReceipt['identity'];
  readonly source: ImportedHistoryReceipt['source'];
  readonly historicalArchiveHash: string;
  readonly originalRootRefs: ImportedHistoryReceipt['originalRootRefs'];
  readonly referenceCount: number;
}
type HistoryProofRow = ScheduleHistoryImportProof & {
  prepared: boolean;
  archive: unknown;
  archiveHash: string | null;
  sourceArchive: unknown;
  sourceArchiveHash: string | null;
  originalProved: boolean;
  historyProved: boolean;
};
/**
 * Lock source before head, series, revision and occurrence, then independently prove immutable evidence.
 * Source NO KEY UPDATE stays compatible with registered creation's source-FK KEY SHARE.
 * @returns Null if another committed importer already prepared this occurrence.
 * @throws Source-proof errors for reviewable uncertainty; integrity/storage failures remain fatal.
 */
export async function proveScheduleHistoryImport(
  tx: BlueprintMigrationConnection,
  id: string,
): Promise<ScheduleHistoryImportProof | null> {
  const [source] = await migrationRows<{
    definitionId: string;
    revisionId: string;
    seriesId: string | null;
    seriesRevisionId: string | null;
  }>(
    tx,
    sql`
    select i.definition_id as "definitionId",i.revision_id as "revisionId",o.series_id as "seriesId",o.series_revision_id as "seriesRevisionId"
    from process_occurrence o join process_instance i on i.id=o.legacy_instance_id and i.organization_id=o.organization_id where o.id=${id}`,
  );
  if (!source) throw new ScheduleSourceProofError('history_identity_unproved');
  await tx.execute(
    sql`select id from process_definition where id=${source.definitionId} for no key update`,
  );
  await tx.execute(
    sql`select id from process_revision where id=${source.revisionId} for no key update`,
  );
  await tx.execute(
    sql`select id from work_template_invocation_head where id=${source.definitionId} for update`,
  );
  if (source.seriesId)
    await tx.execute(sql`select id from recurrence_series where id=${source.seriesId} for update`);
  if (source.seriesRevisionId)
    await tx.execute(
      sql`select id from recurrence_series_revision where id=${source.seriesRevisionId} for update`,
    );
  const [row] = await migrationRows<HistoryProofRow>(
    tx,
    sql`
    select o.imported_history_receipt is not null as prepared,
      jsonb_build_object('organizationId',o.organization_id,'occurrenceId',o.id,'seriesId',o.series_id,
        'seriesRevisionId',o.series_revision_id,'instanceAlias',o.legacy_instance_id,'externalOccurrenceKey',o.external_occurrence_key,
        'scheduledFor',o.scheduled_for::text,'originalScheduledFor',o.original_scheduled_for::text,'runKind',o.run_kind,'status',o.status::text) as identity,
      jsonb_build_object('kind','retained_source','revision',1,'revisionAlias',v.id,'invocationId',v.invocation_id,
        'originalFingerprint',v.original_source_fingerprint,'archiveHash',v.source_archive_hash) as source,
      o.historical_archive_hash as "historicalArchiveHash",coalesce(o.blueprint_root_refs,'null'::jsonb) as "originalRootRefs",
      jsonb_array_length(o.historical_archive->'references') as "referenceCount",o.historical_archive as archive,o.historical_archive_hash as "archiveHash",
      c.source_archive as "sourceArchive",c.source_archive_hash as "sourceArchiveHash",
      coalesce(o.historical_archive->'instance'->>'id'=o.legacy_instance_id
        and o.historical_archive->'instance'->>'organization_id'=o.organization_id
        and o.historical_archive->'instance'->>'revision_id'=${source.revisionId}
        and o.historical_archive->'instance'->>'definition_id'=${source.definitionId}
        and (o.run_kind='historical' and o.historical_archive->'instance'->>'occurrence_id' is null
          or o.run_kind='scheduled' and o.historical_archive->'instance'->>'occurrence_id'=o.id)
        and docket_schedule_history_references_proved(o.historical_archive,c.source_archive->'source',o.organization_id,o.legacy_instance_id),false) as "historyProved",
      coalesce(v.source_archive_hash=c.source_archive_hash and v.original_source_fingerprint=c.source_fingerprint
        and md5((c.source_archive->'source')::text)=v.original_source_fingerprint
        and (docket_blueprint_retained_source(v.id)-'definition')=((c.source_archive->'source')-'definition'),false) as "originalProved"
    from process_occurrence o left join work_template_invocation_revision v on v.id=${source.revisionId} and v.organization_id=o.organization_id and v.invocation_id=o.blueprint_invocation_id and v.head_id=${source.definitionId}
    left join work_template_blueprint_conversion c on c.legacy_process_revision_id=v.id and c.organization_id=v.organization_id and c.invocation_id=v.invocation_id
    where o.id=${id} for update of o`,
  );
  if (!row) throw new ScheduleSourceProofError('history_identity_unproved');
  if (row.prepared) return null;
  assertHistoryProof(row);
  await readProvedScheduleSource(tx, source.revisionId, true, false);
  return row;
}

function assertHistoryProof(row: HistoryProofRow): void {
  if (!row.archive || row.archiveHash !== hashScheduleArchive(row.archive))
    throw new Error('Historical archive integrity failed.');
  if (row.sourceArchive && row.sourceArchiveHash !== hashScheduleArchive(row.sourceArchive))
    throw new Error('Original source archive integrity failed.');
  if (
    row.identity.runKind !== 'historical' &&
    !['completed', 'canceled', 'skipped'].includes(row.identity.status)
  )
    throw new ScheduleSourceProofError('current_run_requires_barrier');
  if (!row.historyProved) throw new ScheduleSourceProofError('history_identity_unproved');
  if (!row.originalProved) throw new ScheduleSourceProofError('original_source_unproved');
}
