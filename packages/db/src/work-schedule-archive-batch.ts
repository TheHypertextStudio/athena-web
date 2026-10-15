import { sql } from 'drizzle-orm';
import { ScheduleSourceProofError } from './work-schedule-archive-source';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';

/** A bounded archival pass retains every unproved source and advances its resumable scan. */
export interface ScheduleArchiveBatchResult {
  readonly archived: number;
  readonly deferred: number;
  readonly after: string | null;
}
/**
 * Archive a locked source page, deferring only explicit original-proof failures during ordinary upgrades.
 * @param archive - The existing source/instance writer on this same caller-owned transaction.
 * @throws For strict proof failures or any storage/archival failure other than deferred source proof.
 */
export async function archiveWorkScheduleSourceBatch(
  connection: BlueprintMigrationConnection,
  input: {
    readonly kind: 'revisions' | 'instances';
    readonly size: number;
    readonly after: string | null;
    readonly verification: 'checkpoint' | 'retirement';
  },
  archive: (id: string) => Promise<void>,
): Promise<ScheduleArchiveBatchResult> {
  const rows = await migrationRows<{ id: string }>(
    connection,
    input.kind === 'revisions'
      ? sql`select r.id from process_revision r join work_template_blueprint_conversion c on c.legacy_process_revision_id=r.id where c.source_archive is null and (${input.after}::text is null or r.id>${input.after}) order by r.id limit ${input.size} for update of r skip locked`
      : sql`select i.id from process_instance i where (${input.after}::text is null or i.id>${input.after}) and not exists(select 1 from process_occurrence o where o.organization_id=i.organization_id and o.legacy_instance_id=i.id and o.historical_archive is not null) order by i.id limit ${input.size} for update of i skip locked`,
  );
  let archived = 0,
    deferred = 0;
  for (const row of rows) {
    try {
      await archive(row.id);
      archived += 1;
    } catch (error) {
      if (input.verification !== 'checkpoint' || !(error instanceof ScheduleSourceProofError))
        throw error;
      deferred += 1;
    }
  }
  return { archived, deferred, after: rows.at(-1)?.id ?? null };
}
