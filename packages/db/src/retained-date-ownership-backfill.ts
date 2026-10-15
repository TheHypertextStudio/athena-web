import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { migrationRows } from './work-template-blueprint-migration/query';

/** Durable per-batch counts for the frozen private occurrence ownership checkpoint. */
export interface RetainedDateBackfillOptions {
  readonly retainedDateBatchSize?: number;
  readonly onRetainedDateBatch?: (count: number) => void | Promise<void>;
}
interface Source {
  organization_id: string;
  occurrence_id: string;
  source_step_id: string;
  field: string;
  invocation_id: string;
  work_kind: string;
  work_id: string;
  source_fingerprint: string;
}
/** Preserve old date values with conservative manual ownership; resume through missing-key scans. */
export async function backfillRetainedDateOwnership(
  database: Database,
  options: RetainedDateBackfillOptions = {},
): Promise<number> {
  const size = options.retainedDateBatchSize ?? 100;
  if (!Number.isInteger(size) || size < 1 || size > 1000)
    throw new RangeError('Use1 through1000 retained date rows per batch.');
  await database.execute(
    sql`select docket_check_retained_date_source(d.organization_id,d.occurrence_id,d.source_step_id,d.field,d.invocation_id,d.work_kind,d.work_id,d.source_fingerprint) from work_template_retained_date_ownership d`,
  );
  let total = 0;
  for (;;) {
    const count = await database.transaction(async (tx) => {
      const sources = await migrationRows<Source>(
        tx,
        sql`select s.* from docket_retained_date_sources s where not exists(select 1 from work_template_retained_date_ownership d where (d.organization_id,d.occurrence_id,d.source_step_id,d.field)=(s.organization_id,s.occurrence_id,s.source_step_id,s.field)) order by s.occurrence_id,s.source_step_id,s.field limit ${size}`,
      );
      for (const source of sources)
        await tx.execute(
          sql`insert into work_template_retained_date_ownership(organization_id,occurrence_id,source_step_id,field,invocation_id,work_kind,work_id,manual,last_derived_date,source_fingerprint) values(${source.organization_id},${source.occurrence_id},${source.source_step_id},${source.field},${source.invocation_id},${source.work_kind},${source.work_id},true,null,${source.source_fingerprint}) on conflict do nothing`,
        );
      return sources.length;
    });
    if (!count) return total;
    total += count;
    await options.onRetainedDateBatch?.(count);
  }
}
