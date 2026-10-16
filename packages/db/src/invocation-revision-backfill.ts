import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { registerInvocationRevision } from './invocation-revision-proof';
import { ScheduleSourceProofError } from './work-schedule-archive-source';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';

/** Committed private alias progress; deferred original proof never authorizes canonical ownership. */
export interface InvocationRevisionProgress {
  readonly revisions: number;
  readonly heads: number;
  readonly deferred: number;
}
/** Bounded alias checkpoint; observers run only after a committed transaction. */
export interface InvocationRevisionBackfillOptions {
  readonly batchSize?: number;
  readonly onInvocationRevisionBatch?: (
    progress: InvocationRevisionProgress,
  ) => void | Promise<void>;
}
/** Lock existing source/head identity without replacing an explicitly private null owner. */
export async function lockInvocationRevisionHead(
  tx: BlueprintMigrationConnection,
  definitionId: string,
): Promise<void> {
  const source = await migrationRows(
    tx,
    sql`select id from process_definition where id=${definitionId} for update`,
  );
  if (!source.length) throw new Error('Invocation source definition disappeared.');
  await tx.execute(sql`insert into work_template_invocation_head(id,organization_id,created_by,created_at,updated_at,archived_at,owner_actor_id,name,description,status)
    select id,organization_id,created_by,created_at,updated_at,archived_at,created_by,name,description,'draft' from process_definition where id=${definitionId} on conflict(id) do nothing`);
  await tx.execute(
    sql`select id from work_template_invocation_head where id=${definitionId} for update`,
  );
}
async function finalizeHead(tx: BlueprintMigrationConnection, id: string): Promise<number> {
  const rows = await migrationRows(
    tx,
    sql`update work_template_invocation_head h set
      name=d.name,description=d.description,status=d.status::text,archived_at=d.archived_at,created_at=d.created_at,updated_at=d.updated_at,
      draft_invocation_id=(select invocation_id from work_template_invocation_revision where head_id=h.id and organization_id=h.organization_id order by number desc limit 1),
      published_invocation_id=(select invocation_id from work_template_invocation_revision where head_id=h.id and organization_id=h.organization_id and state='published' order by number desc limit 1),
      canonical_authoring_at=now(),revision=h.revision+1
    from process_definition d where h.id=${id} and d.id=h.id and d.organization_id=h.organization_id and h.canonical_authoring_at is null
      and exists(select 1 from process_revision r where r.definition_id=h.id and r.organization_id=h.organization_id)
      and not exists(select 1 from process_revision r where r.definition_id=h.id and r.organization_id=h.organization_id and not exists(select 1 from work_template_invocation_revision v where v.id=r.id and v.head_id=h.id and v.organization_id=h.organization_id)) returning h.id`,
  );
  return rows.length;
}
async function registerHeadPage(
  database: Database,
  id: string,
  after: string | null,
  size: number,
) {
  return database.transaction(async (tx) => {
    await lockInvocationRevisionHead(tx, id);
    const rows = await migrationRows<{ id: string }>(
      tx,
      sql`select r.id from process_revision r where r.definition_id=${id} and (${after}::text is null or r.id>${after}) and not exists(select 1 from work_template_invocation_revision v where v.id=r.id) order by r.id limit ${size} for update of r`,
    );
    const progress = { revisions: 0, heads: 0, deferred: 0 };
    for (const row of rows) {
      try {
        if (await registerInvocationRevision(tx, row.id)) progress.revisions++;
      } catch (error) {
        if (!(error instanceof ScheduleSourceProofError)) throw error;
        progress.deferred++;
      }
    }
    if (!rows.length) progress.heads = await finalizeHead(tx, id);
    return { ...progress, after: rows.at(-1)?.id ?? null };
  });
}
/** Register proved immutable aliases resumably, taking metadata ownership only after complete head history. */
export async function backfillInvocationRevisionAliases(
  database: Database,
  options: InvocationRevisionBackfillOptions = {},
): Promise<InvocationRevisionProgress> {
  const size = options.batchSize ?? 100;
  if (!Number.isInteger(size) || size < 1 || size > 1000)
    throw new RangeError('Alias batches contain 1 through 1000 revisions.');
  const totals = { revisions: 0, heads: 0, deferred: 0 };
  let after: string | null = null;
  for (;;) {
    const ids: { id: string }[] = await migrationRows<{ id: string }>(
      database,
      sql`select d.id from process_definition d left join work_template_invocation_head h on h.id=d.id and h.organization_id=d.organization_id where (${after}::text is null or d.id>${after}) and (h.canonical_authoring_at is null or exists(select 1 from process_revision r where r.definition_id=d.id and not exists(select 1 from work_template_invocation_revision v where v.id=r.id))) order by d.id limit ${size}`,
    );
    if (!ids.length) return totals;
    for (const { id } of ids) {
      const progress = await backfillHeadAliases(database, id, size, options);
      totals.revisions += progress.revisions;
      totals.heads += progress.heads;
      totals.deferred += progress.deferred;
    }
    after = ids.at(-1)?.id ?? null;
  }
}

async function backfillHeadAliases(
  database: Database,
  id: string,
  size: number,
  options: InvocationRevisionBackfillOptions,
): Promise<InvocationRevisionProgress> {
  const totals = { revisions: 0, heads: 0, deferred: 0 };
  let after: string | null = null;
  for (;;) {
    const page = await registerHeadPage(database, id, after, size);
    totals.revisions += page.revisions;
    totals.heads += page.heads;
    totals.deferred += page.deferred;
    await options.onInvocationRevisionBatch?.(page);
    after = page.after;
    if (after === null) return totals;
  }
}
