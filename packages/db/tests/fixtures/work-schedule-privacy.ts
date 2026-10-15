import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import type { BlueprintRetainedFixture } from './work-template-blueprint-migration';

async function visibleRows(
  database: Database,
  fixture: BlueprintRetainedFixture,
  actorId: string,
  seriesId: string,
): Promise<number> {
  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('docket.organization_id',${fixture.organizationId},true),set_config('docket.actor_id',${actorId},true)`,
    );
    await tx.execute(sql`set local role schedule_privacy_reader`);
    const [row] = await migrationRows<{ count: number; series: number; revisions: number }>(
      tx,
      sql`select (select count(*)::integer from recurrence_series where id=${seriesId}) as series,(select count(*)::integer from recurrence_series_revision where series_id=${seriesId}) as revisions,count(*)::integer as count from process_occurrence where series_id=${seriesId}`,
    );
    assert.equal(row?.series, row?.count, 'Private schedule metadata must share run visibility.');
    assert.equal(row?.revisions, row?.count, 'Private authoring drafts must share run visibility.');
    return row?.count ?? 0;
  });
}
/** Real restricted-role proof: a tenant grant never exposes another person's private accepted claim. */
export async function exerciseSchedulePrivacy(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  await database.execute(
    sql`do $$ begin if not exists(select 1 from pg_roles where rolname='schedule_privacy_reader') then create role schedule_privacy_reader nologin nobypassrls; end if; end $$`,
  );
  await database.execute(sql`grant usage on schema public to schedule_privacy_reader`);
  await database.execute(
    sql`grant select on actor,role,"grant",program,recurrence_series,recurrence_series_revision,process_occurrence,work_template_blueprint_invocation to schedule_privacy_reader`,
  );
  const stranger = genId(),
    series = genId(),
    revision = genId();
  await database.execute(
    sql`insert into actor(id,organization_id,kind,display_name) values(${stranger},${fixture.organizationId},'human','Unrelated reader')`,
  );
  for (const actorId of [fixture.actorId, stranger])
    await database.execute(
      sql`insert into "grant"(id,organization_id,subject_kind,subject_id,resource_kind,resource_id,capabilities,cascades) values(${genId()},${fixture.organizationId},'actor',${actorId},'organization',${fixture.organizationId},'["view"]'::jsonb,false)`,
    );
  await database.execute(
    sql`insert into recurrence_series(id,organization_id,created_by,name) values(${series},${fixture.organizationId},${fixture.actorId},'Private accepted schedule')`,
  );
  await database.execute(
    sql`insert into recurrence_series_revision(id,organization_id,created_by,series_id,number,effective_from,trigger_kind) values(${revision},${fixture.organizationId},${fixture.actorId},${series},1,'2026-10-15','manual')`,
  );
  await database.execute(
    sql`insert into process_occurrence(id,organization_id,created_by,series_id,series_revision_id,scheduled_for) values(${genId()},${fixture.organizationId},${fixture.actorId},${series},${revision},'2026-10-15')`,
  );
  assert.equal(
    await visibleRows(database, fixture, fixture.actorId, series),
    1,
    'Live creator with current scope view reads their private schedule.',
  );
  assert.equal(
    await visibleRows(database, fixture, stranger, series),
    0,
    'Same-tenant view grant must not reveal private schedule claims.',
  );
  await database.execute(
    sql`update "grant" set capabilities='["manage"]'::jsonb where subject_id=${stranger}`,
  );
  assert.equal(
    await visibleRows(database, fixture, stranger, series),
    1,
    'Current workspace Manage reads private schedule.',
  );
  await database.execute(sql`update actor set status='suspended' where id=${stranger}`);
  assert.equal(
    await visibleRows(database, fixture, stranger, series),
    0,
    'Suspended manager cannot read private schedule.',
  );
}

/** Creator attribution never bypasses revoked Program view; direct Program Manage is sufficient. */
export async function exerciseOwnedSchedulePrivacy(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  const program = genId(),
    series = genId(),
    revision = genId(),
    manager = genId(),
    viewGrant = genId();
  await database.execute(
    sql`insert into program(id,organization_id,created_by,name,status,status_id,visibility) select ${program},${fixture.organizationId},${fixture.actorId},'Private Program',key,id,'private' from work_status where organization_id=${fixture.organizationId} and entity_type='program' and key='active' limit 1`,
  );
  await database.execute(
    sql`insert into actor(id,organization_id,kind,display_name) values(${manager},${fixture.organizationId},'human','Program manager')`,
  );
  await database.execute(
    sql`insert into "grant"(id,organization_id,subject_kind,subject_id,resource_kind,resource_id,capabilities) values(${viewGrant},${fixture.organizationId},'actor',${fixture.actorId},'program',${program},'["view"]'::jsonb),(${genId()},${fixture.organizationId},'actor',${manager},'program',${program},'["manage"]'::jsonb)`,
  );
  await database.execute(
    sql`insert into recurrence_series(id,organization_id,created_by,owner_program_id,name) values(${series},${fixture.organizationId},${fixture.actorId},${program},'Private Program schedule')`,
  );
  await database.execute(
    sql`insert into recurrence_series_revision(id,organization_id,created_by,series_id,number,effective_from,trigger_kind) values(${revision},${fixture.organizationId},${fixture.actorId},${series},1,'2026-10-15','manual')`,
  );
  await database.execute(
    sql`insert into process_occurrence(id,organization_id,created_by,series_id,series_revision_id,scheduled_for) values(${genId()},${fixture.organizationId},${fixture.actorId},${series},${revision},'2026-10-15')`,
  );
  assert.equal(
    await visibleRows(database, fixture, fixture.actorId, series),
    1,
    'Creator with current Program view reads private schedule.',
  );
  assert.equal(
    await visibleRows(database, fixture, manager, series),
    1,
    'Actual Program manager reads private schedule without fabricated workspace role.',
  );
  await database.execute(sql`delete from "grant" where id=${viewGrant}`);
  assert.equal(
    await visibleRows(database, fixture, fixture.actorId, series),
    0,
    'Revoked Program view removes creator schedule visibility.',
  );
  assert.equal(await visibleRows(database, fixture, manager, series), 1);
}
