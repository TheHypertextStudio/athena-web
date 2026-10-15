import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { hashScheduleArchive } from '../../src/work-schedule-archive';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import type { BlueprintRetainedFixture } from './work-template-blueprint-migration';

/** Exercise accepted claim immutability, monotonic ordinal, failed-work survival and stale attempt CAS. */
export async function exerciseScheduleClaims(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  const [selection] = await migrationRows<{ id: string; versionId: string }>(
    database,
    sql`select id,latest_published_version_id as "versionId" from template where organization_id=${fixture.organizationId} and target_type='task' and is_base`,
  );
  assert.ok(selection);
  const series = genId(),
    revision = genId(),
    occurrence = genId();
  const { draft, roots, fallback, claim } = scheduleClaimDocuments(fixture, selection, revision);
  await database.execute(
    sql`insert into recurrence_series(id,organization_id,name) values(${series},${fixture.organizationId},'Canonical schedule')`,
  );
  await database.execute(
    sql`insert into recurrence_series_revision(id,organization_id,series_id,number,effective_from,trigger_kind,schedule_draft,authoring_fallback) values(${revision},${fixture.organizationId},${series},1,'2026-10-15','manual',${JSON.stringify(draft)}::jsonb,${JSON.stringify(fallback)}::jsonb)`,
  );
  await database.execute(
    sql`insert into process_occurrence(id,organization_id,series_id,series_revision_id,scheduled_for,accepted_claim) values(${occurrence},${fixture.organizationId},${series},${revision},'2026-10-15',${JSON.stringify(claim)}::jsonb)`,
  );
  const [accepted] = await migrationRows<{ ordinal: number; claim: unknown }>(
    database,
    sql`select acceptance_ordinal::integer as ordinal,accepted_claim as claim from process_occurrence where id=${occurrence}`,
  );
  assert.ok(accepted && accepted.ordinal > 0);
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set accepted_claim=jsonb_set(accepted_claim,'{runDate}','"2026-10-16"') where id=${occurrence}`,
    ),
  );
  await assert.rejects(
    database.execute(
      sql`update recurrence_series_revision set authoring_fallback=null where id=${revision}`,
    ),
  );
  await database.execute(
    sql`update process_occurrence set attempt=1,status='failed',failed_at=now(),failure_code='creation_failed' where id=${occurrence} and attempt=0`,
  );
  await database.execute(
    sql`update process_occurrence set attempt=2 where id=${occurrence} and attempt=1`,
  );
  const stale = await migrationRows<{ id: string }>(
    database,
    sql`update process_occurrence set status='completed' where id=${occurrence} and attempt=1 returning id`,
  );
  assert.equal(stale.length, 0);
  const [retained] = await migrationRows<{ claim: unknown }>(
    database,
    sql`select accepted_claim as claim from process_occurrence where id=${occurrence}`,
  );
  assert.deepEqual(retained?.claim, accepted.claim);
  const createdRoot = genId();
  await database.execute(
    sql`insert into task(id,organization_id,title,team_id,state,status_id,work_type_id,work_type_version_id) select ${createdRoot},organization_id,'Accepted actual task',team_id,state,status_id,${selection.id},${selection.versionId} from task where id=${fixture.taskId}`,
  );
  const actual = [
    {
      key: 'root',
      kind: 'task',
      id: createdRoot,
      resolvedManifest: roots[0]?.resolvedManifest,
      selectedWork: [{ path: [], kind: 'task', id: createdRoot }],
    },
  ];
  await database.execute(
    sql`update process_occurrence set blueprint_root_refs=${JSON.stringify(actual)}::jsonb,blueprint_applied_at=now(),status='materialized' where id=${occurrence} and attempt=2`,
  );
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set blueprint_root_refs='[]'::jsonb where id=${occurrence}`,
    ),
  );
  await assertNoHistoricalScheduling(database, fixture, series);
}

function scheduleClaimDocuments(
  fixture: BlueprintRetainedFixture,
  selection: { id: string; versionId: string },
  revision: string,
) {
  const draft = {
    kind: 'schedule',
    revision: 1,
    template: { targetType: 'task', workTypeId: selection.id, selection: { kind: 'latest' } },
    titlePattern: 'Accepted task',
    timezone: 'UTC',
    root: { kind: 'task', fields: {}, dates: {}, placement: {}, teamId: fixture.teamId },
    stepOverrides: [],
    optionalChoices: [],
  };
  const roots = [
    {
      key: 'root',
      kind: 'task',
      workTypeId: selection.id,
      versionId: selection.versionId,
      resolvedManifest: [{ path: [], workTypeId: selection.id, versionId: selection.versionId }],
      optionalChoices: [],
      selectedPaths: [{ path: [], kind: 'task' }],
    },
  ];
  const fallback = {
    kind: 'schedule_fallback',
    revision: 1,
    seriesRevisionId: revision,
    sourceInvocationId: null,
    draftFingerprint: hashScheduleArchive(draft),
    roots,
  };
  const claim = {
    kind: 'schedule',
    revision: 1,
    seriesRevisionId: revision,
    sourceInvocationId: null,
    runDate: '2026-10-15',
    timezone: 'UTC',
    draftFingerprint: hashScheduleArchive(draft),
    roots,
  };
  return { draft, roots, fallback, claim };
}

async function assertNoHistoricalScheduling(
  database: Database,
  fixture: BlueprintRetainedFixture,
  series: string,
): Promise<void> {
  await assert.rejects(
    database.execute(
      sql`insert into process_occurrence(id,organization_id,run_kind,legacy_instance_id,scheduled_for,status) values(${genId()},${fixture.organizationId},'historical',${genId()},'2026-10-15','expected')`,
    ),
  );
  await assert.rejects(
    database.execute(
      sql`update recurrence_series set owner_program_id=${genId()} where id=${series}`,
    ),
  );
}
