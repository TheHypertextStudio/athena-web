import assert from 'node:assert/strict';
import { exerciseNativeScheduleUndo } from './work-schedule-native-undo';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import type { BlueprintRetainedFixture } from './work-template-blueprint-migration';

/** Prove native private date registration, immutable policy, explicit pin retention and exact continuation guards. */
export async function exerciseNativeScheduleDates(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  const [run] = await migrationRows<{ id: string; series: string; revision: string }>(
    database,
    sql`select o.id,o.series_id as series,o.series_revision_id as revision from process_occurrence o join recurrence_series s on s.id=o.series_id where o.organization_id=${fixture.organizationId} and s.name='Canonical schedule' and o.blueprint_applied_at is not null`,
  );
  assert.ok(run);
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set schedule_date_ownership='[]'::jsonb where id=${run.id}`,
    ),
  );
  await database.execute(
    sql`update process_occurrence o set schedule_date_ownership=docket_native_schedule_date_policy(o.organization_id,r.schedule_draft,o.blueprint_root_refs) from recurrence_series_revision r where o.id=${run.id} and r.id=o.series_revision_id`,
  );
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set schedule_date_ownership=jsonb_set(schedule_date_ownership,'{0,anchor}','{"kind":"work","id":"forged","offsetDays":0}') where id=${run.id}`,
    ),
  );
  await database.execute(
    sql`update process_occurrence set schedule_date_ownership=jsonb_set(jsonb_set(schedule_date_ownership,'{0,manual}','true'),'{0,lastDerivedDate}','null') where id=${run.id}`,
  );
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set schedule_date_ownership=jsonb_set(schedule_date_ownership,'{0,manual}','false') where id=${run.id}`,
    ),
  );
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set schedule_date_ownership=null where id=${run.id}`,
    ),
  );
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set external_occurrence_key='forged' where id=${run.id}`,
    ),
  );
  await database.execute(
    sql`update process_occurrence set status='completed',completed_at=now() where id=${run.id}`,
  );
  await assert.rejects(
    database.execute(sql`update process_occurrence set status='materialized' where id=${run.id}`),
  );
  await assert.rejects(
    database.execute(
      sql`insert into process_occurrence(id,organization_id,series_id,series_revision_id,scheduled_for,continued_from_occurrence_id) values(${genId()},${fixture.organizationId},${run.series},${run.revision},'2026-10-16',${run.id})`,
    ),
  );
  const revision = genId(),
    source = genId(),
    successor = genId();
  await database.execute(
    sql`insert into recurrence_series_revision(id,organization_id,series_id,number,effective_from,trigger_kind,interval,interval_unit,schedule_draft,authoring_fallback) select ${revision},organization_id,series_id,2,'2026-11-01','after_completion',1,'day',schedule_draft,jsonb_set(authoring_fallback,'{seriesRevisionId}',to_jsonb(${revision}::text)) from recurrence_series_revision where id=${run.revision}`,
  );
  await database.execute(
    sql`insert into process_occurrence(id,organization_id,series_id,series_revision_id,scheduled_for,accepted_claim,blueprint_root_refs,blueprint_applied_at,status,completed_at) select ${source},organization_id,series_id,${revision},'2026-11-15',jsonb_set(jsonb_set(accepted_claim,'{seriesRevisionId}',to_jsonb(${revision}::text)),'{runDate}','"2026-11-15"'),blueprint_root_refs,now(),'completed',now() from process_occurrence where id=${run.id}`,
  );
  await database.execute(
    sql`insert into process_occurrence(id,organization_id,series_id,series_revision_id,scheduled_for,continued_from_occurrence_id) values(${successor},${fixture.organizationId},${run.series},${revision},'2026-11-16',${source})`,
  );
  await assert.rejects(
    database.execute(
      sql`insert into process_occurrence(id,organization_id,series_id,series_revision_id,scheduled_for,continued_from_occurrence_id) values(${genId()},${fixture.organizationId},${run.series},${revision},'2026-11-17',${source})`,
    ),
  );
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set continued_from_occurrence_id=${run.id} where id=${successor}`,
    ),
  );
  await exerciseNativeScheduleUndo(database, fixture, run.id);
  console.log(
    'PASS native actual date policy, explicit null pin, immutable identity/terminal facts and non-completion source rejection and unique immutable continuation',
  );
}
