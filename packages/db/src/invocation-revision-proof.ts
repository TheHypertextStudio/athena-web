import { sql } from 'drizzle-orm';
import {
  hashScheduleArchive,
  readProvedScheduleSource,
  archiveWorkScheduleRevision,
} from './work-schedule-archive';
import { ScheduleSourceProofError } from './work-schedule-archive-source';
import type { ScheduleSourceArchive } from './schema/work-schedule-storage';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';

/** Register one exact source alias only from independently proved original archive facts. */
export async function registerInvocationRevision(
  tx: BlueprintMigrationConnection,
  revisionId: string,
): Promise<boolean> {
  const [receipt] = await migrationRows<{
    archive: ScheduleSourceArchive | null;
    hash: string | null;
  }>(
    tx,
    sql`select source_archive as archive,source_archive_hash as hash from work_template_blueprint_conversion where legacy_process_revision_id=${revisionId}`,
  );
  if (!receipt)
    throw new ScheduleSourceProofError(
      'Invocation revision lacks its immutable conversion receipt.',
    );
  if (!receipt.archive) await archiveWorkScheduleRevision(tx, revisionId);
  else if (receipt.hash !== hashScheduleArchive(receipt.archive))
    throw new Error('Invocation revision archive integrity failed.');
  try {
    await readProvedScheduleSource(tx, revisionId, true);
  } catch (error) {
    if (error instanceof ScheduleSourceProofError)
      throw new Error('Stored invocation archive original proof is invalid.', { cause: error });
    throw error;
  }
  const rows = await migrationRows<{ id: string }>(
    tx,
    sql`
    insert into work_template_invocation_revision(id,organization_id,head_id,invocation_id,number,state,creation_mode,origin,
      original_source_fingerprint,source_archive_hash,projection,created_by,created_at,published_at)
    select c.legacy_process_revision_id,c.organization_id,c.source_archive->'source'->'revision'->>'definition_id',c.invocation_id,
      (c.source_archive->'source'->'revision'->>'number')::integer,i.manifest->>'kind',
      c.source_archive->'source'->'revision'->>'creation_mode','retained',c.source_fingerprint,c.source_archive_hash,
      docket_invocation_revision_projection(c.source_archive,i.manifest),c.source_archive->'revisionAudit'->>'created_by',
      (c.source_archive->'revisionAudit'->>'created_at')::timestamp at time zone 'UTC',
      (c.source_archive->'revisionAudit'->>'published_at')::timestamp at time zone 'UTC'
    from work_template_blueprint_conversion c join work_template_blueprint_invocation i on i.id=c.invocation_id and i.organization_id=c.organization_id
    where c.legacy_process_revision_id=${revisionId} on conflict(id) do nothing returning id`,
  );
  return rows.length === 1;
}
