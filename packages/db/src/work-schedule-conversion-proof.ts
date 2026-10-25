import { sql } from 'drizzle-orm';
import { compileLegacyScheduleImport } from '@docket/work/schedule-import-compiler';
import { hashScheduleArchive, readProvedScheduleSource } from './work-schedule-archive';
import { ScheduleSourceProofError } from './work-schedule-archive-source';
import { compileScheduleConversionInput } from './work-schedule-conversion-source';
import { readScheduleConversionClosure } from './work-schedule-conversion-publications';
import { ScheduleConversionReceipt } from './work-schedule-conversion-types';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';

interface Identity {
  readonly organizationId: string;
  readonly seriesId: string;
  readonly seriesRevisionId: string;
  readonly headId: string;
  readonly revisionAlias: string;
  readonly invocationId: string;
}
interface SourceRow {
  readonly identity: Identity;
  readonly prepared: boolean;
  readonly registered: boolean;
  readonly source: ScheduleConversionReceipt['candidate']['source'];
  readonly archive: unknown;
  readonly archiveHash: string | null;
  readonly originalProved: boolean;
  readonly triggerKind: string;
  readonly timezone: string | null;
}
async function lockSource(tx: BlueprintMigrationConnection, id: string): Promise<void> {
  await tx.execute(
    sql`select d.id from recurrence_series_revision sr join process_revision r on r.id=sr.process_revision_id and r.organization_id=sr.organization_id join process_definition d on d.id=r.definition_id and d.organization_id=r.organization_id where sr.id=${id} for no key update of d`,
  );
  await tx.execute(
    sql`select r.id from recurrence_series_revision sr join process_revision r on r.id=sr.process_revision_id and r.organization_id=sr.organization_id where sr.id=${id} for no key update of r`,
  );
  await tx.execute(
    sql`select h.id from recurrence_series_revision sr join recurrence_series s on s.id=sr.series_id and s.organization_id=sr.organization_id join work_template_invocation_head h on h.id=s.definition_id and h.organization_id=s.organization_id where sr.id=${id} for update of h`,
  );
  await tx.execute(
    sql`select s.id from recurrence_series_revision sr join recurrence_series s on s.id=sr.series_id and s.organization_id=sr.organization_id where sr.id=${id} for update of s`,
  );
}
/**
 * Prove a bound original revision and exact pinned logical closure under source/head/series/revision locks.
 * The returned immutable description grants no accepted claim, actual-work authority or dispatch.
 * @returns Null for an already committed preparation.
 * @throws Reviewable original-proof errors; archive integrity and storage failures remain fatal.
 */
export async function proveScheduleConversion(
  tx: BlueprintMigrationConnection,
  id: string,
): Promise<ScheduleConversionReceipt | null> {
  await lockSource(tx, id);
  const [row] = await migrationRows<SourceRow>(
    tx,
    sql`
    select jsonb_build_object('organizationId',sr.organization_id,'seriesId',sr.series_id,'seriesRevisionId',sr.id,'headId',s.definition_id,'revisionAlias',sr.process_revision_id,'invocationId',sr.blueprint_invocation_id) as identity,
      sr.conversion_receipt is not null as prepared,v.id is not null as registered,
      jsonb_build_object('kind','retained_source','revision',1,'revisionAlias',v.id,'invocationId',v.invocation_id,'originalFingerprint',v.original_source_fingerprint,'archiveHash',v.source_archive_hash) as source,
      c.source_archive as archive,c.source_archive_hash as "archiveHash",
      coalesce(v.origin='retained' and v.original_source_fingerprint=c.source_fingerprint and v.source_archive_hash=c.source_archive_hash
        and md5((c.source_archive->'source')::text)=v.original_source_fingerprint
        and (docket_blueprint_retained_source(v.id)-'definition')=((c.source_archive->'source')-'definition'),false) as "originalProved",
      sr.trigger_kind::text as "triggerKind",sr.timezone
    from recurrence_series_revision sr join recurrence_series s on s.id=sr.series_id and s.organization_id=sr.organization_id
    left join work_template_invocation_revision v on v.id=sr.process_revision_id and v.organization_id=sr.organization_id and v.head_id=s.definition_id and v.invocation_id=sr.blueprint_invocation_id
    left join work_template_blueprint_conversion c on c.legacy_process_revision_id=v.id and c.organization_id=v.organization_id and c.invocation_id=v.invocation_id
    where sr.id=${id} for update of sr`,
  );
  if (!row?.registered) throw new ScheduleSourceProofError('alias_unproved');
  if (row.prepared) return null;
  if (row.archive !== null && hashScheduleArchive(row.archive) !== row.archiveHash)
    throw new Error('Original source archive integrity failed.');
  if (!row.originalProved) throw new ScheduleSourceProofError('original_source_unproved');
  const source = await readProvedScheduleSource(tx, row.identity.revisionAlias, true, false);
  if (source.manifest.kind === 'pending_draft')
    throw new ScheduleSourceProofError('pending_source');
  const closure = await readScheduleConversionClosure(tx, row.identity.organizationId, source);
  const input = compileScheduleConversionInput(
    source,
    row.source,
    closure.selectedWork,
    closure.references,
  );
  const compiled = compileLegacyScheduleImport(input);
  if (compiled.kind !== 'compiled_import')
    throw new ScheduleSourceProofError(compiled.pending.disposition);
  if (row.triggerKind !== 'calendar' || !row.timezone)
    throw new ScheduleSourceProofError('timezone_unproved');
  const parsed = ScheduleConversionReceipt.safeParse({
    kind: 'schedule_conversion',
    revision: 1,
    execution: 'nonexecuting',
    compiler: 'legacy_schedule_v2.1',
    identity: row.identity,
    candidate: compiled.candidate,
    publications: closure.publications,
    timezone: { kind: 'calendar_revision', timezone: row.timezone },
  });
  if (!parsed.success) throw new ScheduleSourceProofError('invalid_structure');
  return parsed.data;
}
