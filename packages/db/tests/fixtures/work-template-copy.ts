import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';

/** Disposable actual tenant/principal for restricted-role copy acceptance. */
export interface CopyStorageWorkspace {
  readonly organizationId: string;
  readonly actorId: string;
  readonly userId: string;
}
/** Actual metadata identities returned without storing any source definition/version body. */
export interface CopyStorageFixture extends CopyStorageWorkspace {
  readonly bundleId: string;
  readonly entryId: string;
  readonly destinationId: string;
  readonly reservedId: string;
  readonly receiptId: string;
}
/** Stable fixture fingerprint; provenance points to an independent absent source draft revision zero. */
export const copyStorageFingerprint = `sha256:${'1'.repeat(64)}`;
/** Create only task-owned test records; canonical publication migration already ran. */
export async function seedCopyStorageWorkspace(database: Database): Promise<CopyStorageWorkspace> {
  const organizationId = genId(),
    actorId = genId(),
    userId = genId();
  await database.execute(
    sql`insert into organization(id,name,slug) values(${organizationId},'Copy storage fixture',${organizationId.toLowerCase()})`,
  );
  await database.execute(
    sql`insert into "user"(id,name,email) values(${userId},'Actual acceptor',${`${userId}@example.test`})`,
  );
  await database.execute(
    sql`insert into actor(id,organization_id,user_id,kind,display_name) values(${actorId},${organizationId},${userId},'human','Actual acceptor')`,
  );
  await database.execute(
    sql`insert into "grant"(id,organization_id,subject_kind,subject_id,resource_kind,resource_id,capabilities,effect,cascades) values(${genId()},${organizationId},'actor',${actorId},'organization',${organizationId},'["manage"]','allow',true)`,
  );
  return { organizationId, actorId, userId };
}
/** Install verified transaction-local context using only actual freshly seeded test identities. */
export async function copyStorageContext(
  database: Database,
  f: CopyStorageWorkspace,
): Promise<void> {
  await database.execute(
    sql`select set_config('docket.organization_id',${f.organizationId},true),set_config('docket.actor_id',${f.actorId},true)`,
  );
}
/** Reserve first, use canonical storage once, then finish with the existing aggregate receipt shape. */
export async function insertCopyStorageFixture(
  database: Database,
  workspace: CopyStorageWorkspace,
): Promise<CopyStorageFixture> {
  const f = {
    ...workspace,
    bundleId: genId(),
    entryId: genId(),
    destinationId: genId(),
    reservedId: genId(),
    receiptId: genId(),
  };
  await copyStorageContext(database, f);
  await insertCopyMetadata(database, f);
  const definition = WorkTemplateDefinition.parse({
    name: 'Private source copy',
    payload: { targetType: 'task', description: 'Private destination body' },
  });
  await database.execute(
    sql`insert into template(id,organization_id,created_by,target_type,name,scope,owner_actor_id,payload,draft_definition) values(${f.destinationId},${f.organizationId},${f.actorId},'task',${definition.name},'personal',${f.actorId},${JSON.stringify(definition.payload)}::jsonb,${JSON.stringify(definition)}::jsonb)`,
  );
  await database.execute(
    sql`insert into change_set(id,organization_id,actor_id,origin,summary) values(${f.receiptId},${f.organizationId},${f.actorId},'{"channel":"app","surface":"settings"}','Copy fixture')`,
  );
  await database.execute(
    sql`insert into change_set_entry(change_set_id,entity_kind,entity_id,op,after) values(${f.receiptId},'template',${f.destinationId},'create',${JSON.stringify({ name: definition.name })}::jsonb)`,
  );
  await database.execute(
    sql`update work_template_copy_entry set after_state_fingerprint=${copyStorageFingerprint} where id=${f.entryId}`,
  );
  await database.execute(
    sql`update work_template_copy_bundle set state='installed',receipt_key=${f.receiptId},receipt_id=${f.receiptId},installed_at=now() where id=${f.bundleId}`,
  );
  return f;
}
/** Insert deferred metadata before the destination exists; caller must complete the atomic installation. */
export async function insertCopyMetadata(database: Database, f: CopyStorageFixture): Promise<void> {
  const source = {
    kind: 'draft',
    organizationId: genId(),
    workTypeId: genId(),
    draftRevision: 0,
    draftFingerprint: copyStorageFingerprint,
  };
  await database.execute(
    sql`insert into work_template_copy_bundle(id,organization_id,accepting_actor_key,accepting_actor_id,request_id,request_fingerprint,review_fingerprint,choices_fingerprint,mode,root_entry_keys) values(${f.bundleId},${f.organizationId},${f.actorId},${f.actorId},${f.bundleId},${copyStorageFingerprint},${copyStorageFingerprint},${copyStorageFingerprint},'private_drafts',ARRAY['root'])`,
  );
  await database.execute(
    sql`insert into work_template_copy_entry(id,organization_id,bundle_id,entry_key,target_type,ordinal,destination_work_type_id,live_work_type_id,reserved_first_version_id,source_identity,source_fingerprint,dependency_entry_keys) values(${f.entryId},${f.organizationId},${f.bundleId},'root','task',0,${f.destinationId},${f.destinationId},${f.reservedId},${JSON.stringify(source)}::jsonb,${copyStorageFingerprint},ARRAY[]::text[])`,
  );
}
/** Actual matching first publication; ordinary header/projection checks still run. */
export async function publishCopyStorageFixture(
  database: Database,
  f: CopyStorageFixture,
  id = f.reservedId,
): Promise<void> {
  await copyStorageContext(database, f);
  await database.execute(
    sql`select * from docket_template_copy_reservation(${f.organizationId},${f.destinationId})`,
  );
  await database.execute(
    sql`update template set scope='organization',team_id=null where id=${f.destinationId}`,
  );
  await database.execute(
    sql`insert into work_type_version(id,organization_id,work_type_id,number,definition,published_by_actor_id) select ${id},organization_id,id,1,draft_definition,${f.actorId} from template where id=${f.destinationId}`,
  );
  await database.execute(
    sql`update template set publication_state='published',latest_published_version_id=${id},draft_revision=draft_revision+1 where id=${f.destinationId}`,
  );
  const [row] = await migrationRows<{ id: string | null }>(
    database,
    sql`select consumed_version_id as id from work_template_copy_entry where id=${f.entryId}`,
  );
  assert.equal(row?.id, id);
}
