import { sql } from 'drizzle-orm';
import type { Database } from './client';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';
/** Bounded source identity reservation; unresolved heads remain private explicit reviews, never authored authority. */
export interface PrivateIdentityNamespaceProgress {
  readonly reserved: number;
  readonly classified: number;
  readonly deferred: number;
  readonly ready: boolean;
}
/** Checkpoint observations run only after the reported batch commits. */
export interface PrivateIdentityNamespaceOptions {
  readonly batchSize?: number;
  readonly onPrivateIdentityBatch?: (
    progress: PrivateIdentityNamespaceProgress,
  ) => void | Promise<void>;
}
/** Recheck one locked head after genuine retained alias registration; unresolved identity never grants authored authority. */
export async function reconcilePrivateIdentityHead(
  database: BlueprintMigrationConnection,
  id: string,
  organizationId: string,
): Promise<{ classified: number; deferred: number }> {
  const [result] = await migrationRows<{ origin: string | null }>(
    database,
    sql`update work_template_invocation_head h set identity_origin=docket_invocation_head_identity_origin(h.id,h.organization_id),identity_review=docket_invocation_head_identity_review(h.id,h.organization_id),revision=h.revision+1 where h.id=${id} and h.organization_id=${organizationId} and h.identity_origin is null and (docket_invocation_head_identity_origin(h.id,h.organization_id) is not null or h.identity_review is distinct from docket_invocation_head_identity_review(h.id,h.organization_id)) returning identity_origin as origin`,
  );
  if (result) return { classified: result.origin ? 1 : 0, deferred: result.origin ? 0 : 1 };
  const [row] = await migrationRows<{ origin: string | null }>(
    database,
    sql`select identity_origin as origin from work_template_invocation_head where id=${id} and organization_id=${organizationId}`,
  );
  return { classified: 0, deferred: row?.origin === null ? 1 : 0 };
}
async function reserveSourcePage(database: Database, after: string | null, size: number) {
  return database.transaction(async (tx) => {
    const ids = await migrationRows<{ id: string; organizationId: string }>(
      tx,
      sql`select d.id,d.organization_id as "organizationId" from process_definition d left join work_template_invocation_head h on h.id=d.id and h.organization_id=d.organization_id where (${after}::text is null or d.id>${after}) and (h.id is null or h.identity_origin is null) order by d.id limit ${size} for no key update of d`,
    );
    const progress = { reserved: 0, classified: 0, deferred: 0, ready: false };
    for (const { id, organizationId } of ids) {
      const inserted = await migrationRows(
        tx,
        sql`insert into work_template_invocation_head(id,organization_id,owner_actor_id,created_by,name,description,status,created_at,updated_at,archived_at,identity_origin) select d.id,d.organization_id,d.created_by,d.created_by,d.name,d.description,'draft',d.created_at,d.updated_at,d.archived_at,'retained' from process_definition d where d.id=${id} and not exists(select 1 from work_template_invocation_head where id=d.id) returning id`,
      );
      progress.reserved += inserted.length;
      const matching = await migrationRows(
        tx,
        sql`select id from work_template_invocation_head where id=${id} and organization_id=${organizationId} for update`,
      );
      if (!matching.length) {
        progress.deferred++;
        continue;
      }
      const classified = await reconcilePrivateIdentityHead(tx, id, organizationId);
      progress.classified += classified.classified;
      progress.deferred += classified.deferred;
    }
    return { progress, after: ids.at(-1)?.id ?? null };
  });
}
async function classifyPrivatePage(database: Database, after: string | null, size: number) {
  return database.transaction(async (tx) => {
    const ids = await migrationRows<{ id: string; organizationId: string }>(
      tx,
      sql`select h.id,h.organization_id as "organizationId" from work_template_invocation_head h where h.identity_origin is null and (${after}::text is null or h.id>${after}) and not exists(select 1 from process_definition d where d.id=h.id and d.organization_id=h.organization_id) order by h.id limit ${size} for update of h`,
    );
    const progress = { reserved: 0, classified: 0, deferred: 0, ready: false };
    for (const { id, organizationId } of ids) {
      const result = await reconcilePrivateIdentityHead(tx, id, organizationId);
      progress.classified += result.classified;
      progress.deferred += result.deferred;
    }
    return { progress, after: ids.at(-1)?.id ?? null };
  });
}
async function finalizeNamespace(database: Database): Promise<boolean> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`lock table process_definition in share mode`);
    const [state] = await migrationRows<{ ready: boolean }>(
      tx,
      sql`select ready_at is not null as ready from work_template_identity_namespace where singleton for update`,
    );
    if (state?.ready) return true;
    const [coverage] = await migrationRows<{ missing: number }>(
      tx,
      sql`select count(*)::integer as missing from process_definition d left join work_template_invocation_head h on h.id=d.id and h.organization_id=d.organization_id where h.id is null`,
    );
    if (!state) throw new Error('Private identity namespace checkpoint is missing.');
    if (coverage?.missing !== 0) {
      await tx.execute(
        sql`update work_template_identity_namespace set review_code='identity_collision',unreserved_source_count=${coverage?.missing ?? 0} where singleton`,
      );
      return false;
    }
    await tx.execute(
      sql`update work_template_identity_namespace set ready_at=now(),review_code=null,unreserved_source_count=0,reserved_source_count=(select count(*)::integer from process_definition),coverage_hash=(select docket_schedule_fingerprint(jsonb_build_object('kind','identity_namespace_coverage','revision',1,'reservedSourceCount',count(*)::integer,'missingReservations',0,'reservationTrigger',1)) from process_definition) where singleton`,
    );
    return true;
  });
}
/**
 * Reserve all original IDs in committed batches, classify existing heads, then register only complete namespace coverage.
 * Readiness proves namespace uniqueness only; separately deferred head classification never grants authored authority.
 * The fixed-size receipt hashes coverage counts/version, while exact membership uses checked NOT EXISTS and uniqueness.
 * No alias FK, definition body, schedule claim or activation is changed. Re-running starts from the lowest unresolved ID.
 * @throws For invalid batch size or a database/integrity error; observers can interrupt only after a durable commit.
 */
export async function preparePrivateIdentityNamespace(
  database: Database,
  options: PrivateIdentityNamespaceOptions = {},
): Promise<PrivateIdentityNamespaceProgress> {
  const size = options.batchSize ?? 100;
  if (!Number.isInteger(size) || size < 1 || size > 1000)
    throw new RangeError('Identity batches contain 1 through 1000 heads.');
  const totals = { reserved: 0, classified: 0, deferred: 0, ready: false };
  for (const page of [reserveSourcePage, classifyPrivatePage]) {
    let after: string | null = null;
    for (;;) {
      const result = await page(database, after, size);
      totals.reserved += result.progress.reserved;
      totals.classified += result.progress.classified;
      totals.deferred += result.progress.deferred;
      await options.onPrivateIdentityBatch?.(result.progress);
      after = result.after;
      if (after === null) break;
    }
  }
  totals.ready = await finalizeNamespace(database);
  await options.onPrivateIdentityBatch?.(totals);
  return totals;
}
