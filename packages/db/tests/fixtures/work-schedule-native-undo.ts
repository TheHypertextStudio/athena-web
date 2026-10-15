import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import type { BlueprintRetainedFixture } from './work-template-blueprint-migration';

/** Prove only an exact, active, same-tenant persisted native receipt can restore a manual pin. */
export async function exerciseNativeScheduleUndo(
  database: Database,
  fixture: BlueprintRetainedFixture,
  occurrenceId: string,
): Promise<void> {
  const receiptId = genId();
  await database.execute(
    sql`insert into change_set(id,organization_id,actor_id,origin,summary) values(${receiptId},${fixture.organizationId},${fixture.actorId},'{"channel":"ui","surface":"task","actorId":"fixture"}'::jsonb,'Native date edit')`,
  );
  await database.execute(sql`insert into change_set_entry(change_set_id,entity_kind,entity_id,op,before,after)
    select ${receiptId},'native_schedule_date_ownership',o.id || ':' || (fact->>'id') || ':' || (fact->>'field'),'update',
      jsonb_build_object('occurrenceId',o.id,'workKind',fact->>'kind','workId',fact->>'id','field',fact->>'field','manual',false,'lastDerivedDate',fact->'lastDerivedDate'),
      jsonb_build_object('occurrenceId',o.id,'workKind',fact->>'kind','workId',fact->>'id','field',fact->>'field','manual',true,'lastDerivedDate',fact->'lastDerivedDate')
    from process_occurrence o cross join lateral jsonb_array_elements(o.schedule_date_ownership) fact where o.id=${occurrenceId}`);
  const restore = (proof: string) =>
    database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('docket.native_date_undo_entry',${proof},true)`);
      await tx.execute(
        sql`update process_occurrence set schedule_date_ownership=jsonb_set(schedule_date_ownership,'{0,manual}','false') where id=${occurrenceId}`,
      );
    });
  await assert.rejects(restore('forged-receipt'));
  await database.execute(
    sql`update change_set_entry set after=jsonb_set(after,'{workId}','"unrelated-work"') where change_set_id=${receiptId}`,
  );
  await assert.rejects(restore(receiptId));
  await database.execute(
    sql`update change_set_entry set after=jsonb_set(after,'{workId}',before->'workId') where change_set_id=${receiptId}`,
  );
  await restore(receiptId);
  const [row] = await migrationRows<{ manual: boolean }>(
    database,
    sql`select (schedule_date_ownership->0->>'manual')::boolean manual from process_occurrence where id=${occurrenceId}`,
  );
  assert.equal(row?.manual, false);
  await database.execute(
    sql`update process_occurrence set schedule_date_ownership=jsonb_set(schedule_date_ownership,'{0,manual}','true') where id=${occurrenceId}`,
  );
  await database.execute(sql`update change_set set undone_at=now() where id=${receiptId}`);
  await assert.rejects(restore(receiptId));
  console.log(
    'PASS native undo exact active receipt; forged, unrelated and already-undone proof rejected',
  );
}
