import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from './client';
import {
  ScheduleSourceProofError,
  verifyOriginalScheduleSource,
  type ScheduleArchiveSource,
} from './work-schedule-archive-source';
import {
  archiveHistoricalSelections,
  verifyHistoricalMappingArchives,
} from './work-schedule-archive-selections';
import { genId } from './id';
import type {
  ScheduleHistoricalArchive,
  ScheduleSourceArchive,
} from './schema/work-schedule-storage';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';
import { archiveWorkScheduleSourceBatch } from './work-schedule-archive-batch';

/** Frozen v1 serialization: recursive lexical object keys, ordered arrays, JSON scalar encoding. */
export function serializeScheduleArchive(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serializeScheduleArchive).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${serializeScheduleArchive(item)}`)
      .join(',')}}`;
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol')
    throw new TypeError('Archive contains an unsupported JSON value.');
  return JSON.stringify(value);
}
/** Independently versioned archival integrity; original conversion fingerprints are never rewritten. */
export function hashScheduleArchive(value: unknown): string {
  return `sha256:${createHash('sha256').update(serializeScheduleArchive(value)).digest('hex')}`;
}
/** Bounded conversion progress after each committed source transaction. */
export interface ScheduleArchiveProgress {
  readonly revisions: number;
  readonly instances: number;
  /** Unproved source revisions retained for an explicit later retirement review. */
  readonly deferredRevisions?: number;
}
/** Resumable observer; throwing simulates interruption after committed archival batches. */
export interface ScheduleArchiveOptions {
  readonly batchSize?: number;
  /** Ordinary upgrades verify frozen integrity; explicit retirement retains strict source equality. */
  readonly verification?: 'checkpoint' | 'retirement';
  readonly onScheduleArchiveBatch?: (progress: ScheduleArchiveProgress) => void | Promise<void>;
}

async function lockScheduleSource(
  connection: BlueprintMigrationConnection,
  id: string,
): Promise<void> {
  // Match history import and alias registration: never hold a revision before its definition.
  // NO KEY UPDATE permits registered creation's source-FK KEY SHARE without a later upgrade.
  await connection.execute(sql`select d.id from process_revision r join process_definition d
    on d.id=r.definition_id and d.organization_id=r.organization_id where r.id=${id} for no key update of d`);
  await connection.execute(sql`select id from process_revision where id=${id} for no key update`);
}

/**
 * Read and independently prove current or frozen original source without changing its conversion evidence.
 * @param lockSource Disable only after acquiring source locks before the canonical head/series locks.
 */
export async function readProvedScheduleSource(
  connection: BlueprintMigrationConnection,
  id: string,
  archived = false,
  lockSource = true,
): Promise<ScheduleArchiveSource> {
  if (lockSource) await lockScheduleSource(connection, id);
  const [row] = await migrationRows<ScheduleArchiveSource>(
    connection,
    sql`
    select case when ${archived} then c.source_archive->'source' else docket_blueprint_retained_source(r.id) end as source,
      case when ${archived} then c.source_archive->'header' else to_jsonb(d) end as header,
      case when ${archived} then c.source_archive->'revisionAudit' else to_jsonb(r) end as "revisionAudit",
      case when ${archived} then md5((c.source_archive->'source')::text) else docket_blueprint_source_fingerprint(r.id) end as fingerprint,c.source_fingerprint as "originalFingerprint",i.manifest,i.overrides,
      coalesce((select jsonb_agg(jsonb_build_object(
        'sourceStepId',entry.value->>'sourceStepId','blueprintStepId',projection.id,
        'sourceVersionId',version.id,'key',projection.key,'kind',projection.kind,'sort',projection.sort,
        'stepSort',projection.step->'sort','definitionSort',(
          select published_step.value->'sort' from jsonb_array_elements(version.definition->'blueprint'->'steps') published_step(value)
          where published_step.value->>'key'=projection.key and published_step.value->>'kind'=projection.kind
        ))) from jsonb_array_elements(i.manifest->'steps') entry(value)
        left join blueprint_step projection on projection.id=entry.value->>'blueprintStepId'
          and projection.version_id=entry.value->>'sourceVersionId' and projection.organization_id=r.organization_id
        left join work_type_version version on version.id=projection.version_id and version.organization_id=r.organization_id
        where entry.value->>'blueprintStepId' is not null),'[]'::jsonb) as "originalStepOrders"
    from process_revision r join process_definition d on d.id=r.definition_id and d.organization_id=r.organization_id
      join work_template_blueprint_conversion c on c.legacy_process_revision_id=r.id and c.organization_id=r.organization_id
      join work_template_blueprint_invocation i on i.id=c.invocation_id and i.organization_id=r.organization_id
    where r.id=${id}`,
  );
  if (!row)
    throw new ScheduleSourceProofError('Schedule source lacks its original conversion receipt.');
  verifyOriginalScheduleSource(row);
  return row;
}
/** Capture one independently proved immutable revision archive on the caller transaction. */
export async function archiveWorkScheduleRevision(
  connection: BlueprintMigrationConnection,
  id: string,
): Promise<void> {
  const row = await readProvedScheduleSource(connection, id);
  const archive: ScheduleSourceArchive = {
    revision: 1,
    source: row.source,
    header: row.header,
    revisionAudit: row.revisionAudit,
  };
  await connection.execute(
    sql`update work_template_blueprint_conversion set source_archive=${JSON.stringify(archive)}::jsonb,source_archive_hash=${hashScheduleArchive(archive)},source_archive_hash_version=1 where legacy_process_revision_id=${id} and source_archive is null`,
  );
}

async function instanceArchive(
  connection: BlueprintMigrationConnection,
  id: string,
): Promise<void> {
  const [row] = await migrationRows<{
    instance: Record<string, unknown>;
    occurrenceId: string | null;
    invocationId: string;
    organizationId: string;
    revisionId: string;
    definitionId: string;
    date: string;
    status: string;
  }>(
    connection,
    sql`
    select to_jsonb(i) as instance,i.occurrence_id as "occurrenceId",i.organization_id as "organizationId",i.revision_id as "revisionId",i.definition_id as "definitionId",i.triggered_at::date::text as date,i.status::text as status,c.invocation_id as "invocationId" from process_instance i join work_template_blueprint_conversion c on c.legacy_process_revision_id=i.revision_id and c.organization_id=i.organization_id where i.id=${id} for update of i`,
  );
  if (!row) throw new Error('Historical instance disappeared during archival.');
  const references = await migrationRows<Record<string, unknown>>(
    connection,
    sql`
    select entry from (select jsonb_build_object('kind','project','mapping',to_jsonb(m),'sourceKey',s.key,'deleted',p.id is null) as entry from process_instance_project m join process_step s on s.id=m.step_id left join project p on p.id=m.project_id where m.instance_id=${id}
    union all select jsonb_build_object('kind','task','mapping',to_jsonb(m),'sourceKey',s.key,'deleted',t.id is null) from process_instance_task m join process_step s on s.id=m.step_id left join task t on t.id=m.task_id where m.instance_id=${id}
    union all select jsonb_build_object('kind','milestone','mapping',to_jsonb(m),'sourceKey',s.key,'deleted',mstone.id is null) from process_instance_milestone m join process_step s on s.id=m.step_id left join milestone mstone on mstone.id=m.milestone_id where m.instance_id=${id}) references_archive
    order by entry::text`,
  );
  const mapped = references.map((entry) => entry['entry'] as Record<string, unknown>);
  const retained = await archiveHistoricalSelections(connection, row.occurrenceId, mapped);
  const archive: ScheduleHistoricalArchive = {
    revision: 1,
    instance: row.instance,
    references: [...mapped, ...retained],
  };
  const archiveJson = JSON.stringify(archive),
    hash = hashScheduleArchive(archive);
  if (row.occurrenceId) {
    await connection.execute(
      sql`update process_occurrence set legacy_instance_id=${id},historical_archive=${archiveJson}::jsonb,historical_archive_hash=${hash},completed_at=${row.instance['completed_at']}::timestamptz,failed_at=${row.instance['failed_at']}::timestamptz,failure_code=${row.instance['failure_code']} where id=${row.occurrenceId} and organization_id=${row.organizationId} and historical_archive is null`,
    );
  } else {
    const status =
      row.status === 'completed' || row.status === 'canceled' || row.status === 'failed'
        ? row.status
        : 'needs_resolution';
    await connection.execute(
      sql`insert into process_occurrence(id,organization_id,created_by,scheduled_for,status,run_kind,blueprint_invocation_id,legacy_instance_id,historical_archive,historical_archive_hash,completed_at,failed_at,failure_code) values(${genId()},${row.organizationId},${row.instance['created_by']},${row.date},${status}::process_occurrence_status,'historical',${row.invocationId},${id},${archiveJson}::jsonb,${hash},${row.instance['completed_at']}::timestamptz,${row.instance['failed_at']}::timestamptz,${row.instance['failure_code']})`,
    );
  }
}

/**
 * Capture private facts without running work or altering immutable invocations.
 * Default retirement verification remains strict; checkpoints retain and report unproved sources.
 */
export async function backfillWorkScheduleArchives(
  database: Database,
  options: ScheduleArchiveOptions = {},
): Promise<ScheduleArchiveProgress> {
  const size = options.batchSize ?? 100;
  if (!Number.isInteger(size) || size < 1 || size > 1000)
    throw new RangeError('Archive batches contain 1 through 1000 sources.');
  const verification = options.verification ?? 'retirement';
  const revisions = await archiveSources(
    database,
    { kind: 'revisions', size, verification },
    options,
  );
  const instances = await archiveSources(
    database,
    { kind: 'instances', size, verification },
    options,
  );
  await populateInvocationHeads(database);
  if (verification === 'checkpoint') await verifyWorkScheduleArchiveIntegrity(database);
  else await verifyWorkScheduleArchives(database);
  return {
    revisions: revisions.archived,
    instances: instances.archived,
    ...(verification === 'checkpoint' ? { deferredRevisions: revisions.deferred } : {}),
  };
}

async function archiveSources(
  database: Database,
  input: {
    kind: 'revisions' | 'instances';
    size: number;
    verification: 'checkpoint' | 'retirement';
  },
  options: ScheduleArchiveOptions,
): Promise<{ archived: number; deferred: number }> {
  const totals = { archived: 0, deferred: 0 };
  let after: string | null = null;
  for (;;) {
    const batch = await database.transaction((tx) =>
      archiveWorkScheduleSourceBatch(tx, { ...input, after }, (id) =>
        input.kind === 'revisions' ? archiveWorkScheduleRevision(tx, id) : instanceArchive(tx, id),
      ),
    );
    if (batch.after === null) return totals;
    after = batch.after;
    totals.archived += batch.archived;
    totals.deferred += batch.deferred;
    await options.onScheduleArchiveBatch?.({
      revisions: input.kind === 'revisions' ? batch.archived : 0,
      instances: input.kind === 'instances' ? batch.archived : 0,
      ...(input.verification === 'checkpoint' ? { deferredRevisions: batch.deferred } : {}),
    });
  }
}

/** Fail closed on incomplete receipts, source mutation, or independently corrupted archive hashes. */
export async function verifyWorkScheduleArchives(
  connection: BlueprintMigrationConnection,
): Promise<void> {
  const revisions = await migrationRows<{
    id: string;
    archive: ScheduleSourceArchive | null;
    hash: string | null;
    source: Record<string, unknown>;
    header: Record<string, unknown>;
    revisionAudit: Record<string, unknown>;
  }>(
    connection,
    sql`select r.id,c.source_archive as archive,c.source_archive_hash as hash,docket_blueprint_retained_source(r.id) as source,to_jsonb(d) as header,to_jsonb(r) as "revisionAudit" from process_revision r join process_definition d on d.id=r.definition_id left join work_template_blueprint_conversion c on c.legacy_process_revision_id=r.id`,
  );
  for (const row of revisions) {
    const current = {
      revision: 1,
      source: row.source,
      header: row.header,
      revisionAudit: row.revisionAudit,
    };
    if (
      !row.archive ||
      row.hash !== hashScheduleArchive(row.archive) ||
      hashScheduleArchive(current) !== row.hash
    )
      throw new Error('Schedule source archive is incomplete or stale.');
    // A resumed checkpoint must also reject an unproved snapshot accepted by an older archiver.
    await readProvedScheduleSource(connection, row.id);
  }
  const missing = await migrationRows<{ id: string }>(
    connection,
    sql`select i.id from process_instance i left join process_occurrence o on o.legacy_instance_id=i.id and o.organization_id=i.organization_id where o.id is null or o.historical_archive is null limit 1`,
  );
  if (missing.length) throw new Error('Schedule instance archive is incomplete.');
  const instances = await migrationRows<{
    current: Record<string, unknown>;
    archived: Record<string, unknown>;
  }>(
    connection,
    sql`select to_jsonb(i) as current,o.historical_archive->'instance' as archived from process_instance i join process_occurrence o on o.legacy_instance_id=i.id and o.organization_id=i.organization_id`,
  );
  for (const row of instances)
    if (serializeScheduleArchive(row.current) !== serializeScheduleArchive(row.archived))
      throw new Error('Historical instance source changed after archival.');
  await verifyHistoricalMappingArchives(connection);
  const receipts = await migrationRows<{ archive: ScheduleHistoricalArchive; hash: string }>(
    connection,
    sql`select historical_archive as archive,historical_archive_hash as hash from process_occurrence where historical_archive is not null`,
  );
  for (const row of receipts)
    if (hashScheduleArchive(row.archive) !== row.hash)
      throw new Error('Historical receipt archive integrity failed.');
}

async function populateInvocationHeads(connection: BlueprintMigrationConnection): Promise<void> {
  await connection.execute(sql`insert into work_template_invocation_head(id,organization_id,created_by,created_at,updated_at,archived_at,owner_actor_id,name,description,status,draft_invocation_id,published_invocation_id)
    select d.id,d.organization_id,d.created_by,d.created_at,d.updated_at,d.archived_at,d.created_by,d.name,d.description,
      case when d.status::text='archived' then 'archived' when published.invocation_id is not null then 'published' else 'draft' end,
      draft.invocation_id,published.invocation_id from process_definition d
    left join lateral(select c.invocation_id from process_revision r join work_template_blueprint_conversion c on c.legacy_process_revision_id=r.id where r.definition_id=d.id and r.organization_id=d.organization_id and c.source_archive is not null order by r.number desc limit 1) draft on true
    left join lateral(select c.invocation_id from process_revision r join work_template_blueprint_conversion c on c.legacy_process_revision_id=r.id join work_template_blueprint_invocation i on i.id=c.invocation_id where r.definition_id=d.id and r.organization_id=d.organization_id and i.manifest->>'kind'='published' and c.source_archive is not null order by r.number desc limit 1) published on true
    on conflict(id) do nothing`);
}

/**
 * Verify frozen receipt integrity without comparing later mutable source/header/instance state.
 * This proves neither archival completeness nor safe source retirement; use verifyWorkScheduleArchives for that.
 * @throws When any existing source or historical receipt has a missing or mismatched archive hash.
 */
export async function verifyWorkScheduleArchiveIntegrity(
  connection: BlueprintMigrationConnection,
): Promise<void> {
  const receipts = await migrationRows<{ archive: unknown; hash: string | null }>(
    connection,
    sql`
    select source_archive as archive,source_archive_hash as hash from work_template_blueprint_conversion
      where source_archive is not null or source_archive_hash is not null
    union all
    select historical_archive as archive,historical_archive_hash as hash from process_occurrence
      where historical_archive is not null or historical_archive_hash is not null
  `,
  );
  for (const receipt of receipts)
    if (!receipt.archive || receipt.hash !== hashScheduleArchive(receipt.archive))
      throw new Error('Schedule receipt archive integrity failed.');
}
