import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import type { BlueprintRetainedFixture } from './work-template-blueprint-migration';

interface RetainedIds {
  readonly headId: string;
  readonly invocationId: string;
  readonly revisionId: string;
}
async function visibleRetained(
  database: Database,
  organizationId: string,
  actorId: string,
  ids: RetainedIds,
): Promise<{ heads: number; invocations: number; archives: number }> {
  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('docket.organization_id',${organizationId},true),set_config('docket.actor_id',${actorId},true)`,
    );
    await tx.execute(sql`set local role schedule_privacy_reader`);
    const [row] = await migrationRows<{ heads: number; invocations: number; archives: number }>(
      tx,
      sql`select
        (select count(*)::integer from work_template_invocation_head where id=${ids.headId}) as heads,
        (select count(*)::integer from work_template_blueprint_invocation where id=${ids.invocationId}) as invocations,
        (select count(*)::integer from work_template_blueprint_conversion where legacy_process_revision_id=${ids.revisionId} and source_archive is not null) as archives`,
    );
    assert.ok(row, 'Retained visibility query must return a count.');
    return row;
  });
}
/** Restricted PostgreSQL access to private authoring and complete archives follows current grants. */
export async function exerciseRetainedSchedulePrivacy(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  await database.execute(
    sql`grant select on work_template_invocation_head,work_template_blueprint_conversion to schedule_privacy_reader`,
  );
  const [ids] = await migrationRows<RetainedIds>(
    database,
    sql`select r.definition_id as "headId",c.invocation_id as "invocationId",r.id as "revisionId"
      from process_revision r join work_template_blueprint_conversion c on c.legacy_process_revision_id=r.id and c.organization_id=r.organization_id
      where r.id=${fixture.forestRevisionId}`,
  );
  assert.ok(ids, 'Converted private source must exist before its privacy proof.');
  const visible = { heads: 1, invocations: 1, archives: 1 };
  const hidden = { heads: 0, invocations: 0, archives: 0 };
  assert.deepEqual(
    await visibleRetained(database, fixture.organizationId, fixture.actorId, ids),
    visible,
  );
  await database.execute(
    sql`delete from "grant" where organization_id=${fixture.organizationId} and subject_kind='actor' and subject_id=${fixture.actorId} and resource_kind='organization'`,
  );
  assert.deepEqual(
    await visibleRetained(database, fixture.organizationId, fixture.actorId, ids),
    hidden,
    'Historical ownership does not survive revocation of workspace visibility.',
  );
  const manager = genId(),
    role = genId(),
    grant = genId();
  await database.execute(
    sql`insert into role(id,organization_id,key,name,capabilities) values(${role},${fixture.organizationId},'retained-source-reader','Manage-labelled role','["manage"]'::jsonb)`,
  );
  await database.execute(
    sql`insert into actor(id,organization_id,kind,display_name,role_id) values(${manager},${fixture.organizationId},'human','Retained source reader',${role})`,
  );
  assert.deepEqual(
    await visibleRetained(database, fixture.organizationId, manager, ids),
    hidden,
    'A role label without a current grant cannot reveal private source.',
  );
  await database.execute(
    sql`insert into "grant"(id,organization_id,subject_kind,subject_id,resource_kind,resource_id,capabilities,effect,cascades) values(${grant},${fixture.organizationId},'actor',${manager},'organization',${fixture.organizationId},'["manage"]'::jsonb,'allow',false)`,
  );
  assert.deepEqual(await visibleRetained(database, fixture.organizationId, manager, ids), visible);
  await database.execute(sql`update "grant" set capabilities='["view"]'::jsonb where id=${grant}`);
  assert.deepEqual(
    await visibleRetained(database, fixture.organizationId, manager, ids),
    hidden,
    "Workspace View does not reveal another owner's private source.",
  );
  await database.execute(
    sql`update "grant" set capabilities='["manage"]'::jsonb where id=${grant}`,
  );
  await database.execute(sql`update actor set status='suspended' where id=${manager}`);
  assert.deepEqual(await visibleRetained(database, fixture.organizationId, manager, ids), hidden);
}
