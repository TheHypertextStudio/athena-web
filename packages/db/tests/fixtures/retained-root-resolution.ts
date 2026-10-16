import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import type {
  BlueprintInvocationManifest,
  BlueprintOccurrenceRoot,
} from '../../src/blueprint-invocation';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import type { BlueprintRetainedFixture } from './work-template-blueprint-migration';
import { recoverRetainedRootResolution } from '../../src/retained-root-resolution';
import { genId } from '../../src/id';

/** Recover from original creation evidence, never from current public work or another scope. */
export async function exerciseRetainedRootRecovery(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  const rollback = new Error('Roll back root recovery fixture');
  await assert.rejects(
    database.transaction(async (tx) => {
      const { occurrence, ref, root, manifest } = await resolutionFixture(tx, fixture);
      const identity = await readOccurrenceIdentity(tx, occurrence.id);
      const scope = {
        organizationId: fixture.organizationId,
        occurrenceId: occurrence.id,
        invocationId: identity.invocationId,
        sourceKey: ref.key,
        kind: ref.kind,
        workId: ref.id,
      };
      for (const mismatch of [
        { organizationId: genId() },
        { occurrenceId: genId() },
        { invocationId: genId() },
        { sourceKey: 'other' },
        { kind: 'task' as const },
        { workId: fixture.taskId },
      ])
        assert.equal(await recoverRetainedRootResolution(tx, { ...scope, ...mismatch }), undefined);
      assert.equal(await recoverRetainedRootResolution(tx, scope), undefined);
      await tx.execute(
        sql`update process_occurrence set blueprint_applied_at=now() where id=${occurrence.id}`,
      );
      assert.equal(await recoverRetainedRootResolution(tx, scope), undefined);
      const receipt = genId();
      const origin = {
        channel: 'rule',
        surface: 'recurrence',
        tool: 'recurrence_materialize',
        ref: { seriesId: identity.seriesId },
      };
      await tx.execute(
        sql`insert into change_set(id,organization_id,actor_id,origin,summary) values(${receipt},${fixture.organizationId},${fixture.actorId},${JSON.stringify(origin)}::jsonb,'Original retained creation')`,
      );
      const after = {
        workTypeId: root.workTypeId,
        workTypeVersionId: root.versionId,
        blueprintState: { generationKey: ref.id, resolvedManifest: manifest },
      };
      await tx.execute(
        sql`insert into change_set_entry(change_set_id,entity_kind,entity_id,op,after) values(${receipt},${ref.kind},${ref.id},'create',${JSON.stringify(after)}::jsonb)`,
      );
      await tx.execute(
        sql`update change_set_entry set after=jsonb_set(after,'{blueprintState,resolvedManifest}','[]'::jsonb) where change_set_id=${receipt}`,
      );
      await assert.rejects(
        recoverRetainedRootResolution(tx, scope),
        /Original retained resolution receipt is invalid/,
      );
      await tx.execute(
        sql`update change_set_entry set after=${JSON.stringify(after)}::jsonb where change_set_id=${receipt}`,
      );
      await replacePublicState(tx, fixture.organizationId, ref);
      assert.deepEqual(await recoverRetainedRootResolution(tx, scope), manifest);
      const [saved] = await migrationRows<{ roots: BlueprintOccurrenceRoot[] }>(
        tx,
        sql`select blueprint_root_refs as roots from process_occurrence where id=${occurrence.id}`,
      );
      assert.deepEqual(
        saved?.roots,
        occurrence.roots.map((value) =>
          value === ref ? { ...value, resolvedManifest: manifest } : value,
        ),
      );
      await tx.execute(sql`update change_set set undone_at=now() where id=${receipt}`);
      assert.deepEqual(await recoverRetainedRootResolution(tx, scope), manifest);
      throw rollback;
    }),
    (error: unknown) => error === rollback,
  );
}

async function readOccurrenceIdentity(database: Database, occurrenceId: string) {
  const [identity] = await migrationRows<{ invocationId: string; seriesId: string }>(
    database,
    sql`select blueprint_invocation_id as "invocationId",series_id as "seriesId" from process_occurrence where id=${occurrenceId}`,
  );
  assert.ok(identity);
  return identity;
}

/** Prove original accepted private versions survive mutable public state and cannot be rebound. */
export async function exerciseRetainedRootResolution(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  const { occurrence, ref, root, manifest } = await resolutionFixture(database, fixture);
  const update = (value: unknown) =>
    database.execute(
      sql`update process_occurrence set blueprint_root_refs=${JSON.stringify(value)}::jsonb where id=${occurrence.id}`,
    );
  await update(occurrence.roots); // Exact historical three-member entries remain valid.
  for (const invalid of [
    null,
    [],
    [{ ...root, extra: true }],
    [{ ...root, path: ['missing'] }],
    [root, root],
    [{ ...root, workTypeId: 'foreign', versionId: 'foreign' }],
  ])
    await assert.rejects(
      update([
        { ...ref, resolvedManifest: invalid },
        ...occurrence.roots.filter((value) => value !== ref),
      ]),
    );
  const selectedWork = [
    { path: [], kind: ref.kind, id: ref.id },
    { path: ['checkpoint'], kind: 'milestone', id: fixture.milestoneId },
    { path: ['task'], kind: 'task', id: fixture.taskId },
  ];
  for (const invalid of [
    null,
    [],
    selectedWork.concat(selectedWork),
    selectedWork.filter((row) => row.kind !== 'milestone'),
    [...selectedWork, { path: ['pending'], kind: 'task', id: fixture.taskId }],
    [{ ...selectedWork[0], id: 'foreign-work' }],
    [{ ...selectedWork[0], path: ['missing'] }],
    [{ ...selectedWork[0], kind: 'milestone' }],
    [{ ...selectedWork[0], extra: true }],
    selectedWork.map((row) => (row.kind === 'task' ? { ...row, id: fixture.projectId } : row)),
    selectedWork.map((row) => (row.kind === 'milestone' ? { ...row, path: ['other'] } : row)),
  ])
    await assert.rejects(
      update([
        { ...ref, resolvedManifest: manifest, selectedWork: invalid },
        ...occurrence.roots.filter((value) => value !== ref),
      ]),
    );
  const accepted = [
    { ...ref, resolvedManifest: manifest, selectedWork },
    ...occurrence.roots.filter((value) => value !== ref),
  ];
  await update(accepted);
  await update(accepted);
  for (const invalid of [
    occurrence.roots,
    [
      { ...ref, resolvedManifest: [{ ...root, versionId: 'different' }] },
      ...occurrence.roots.filter((value) => value !== ref),
    ],
    [],
    null,
  ])
    await assert.rejects(update(invalid));
  await replacePublicState(database, fixture.organizationId, ref);
  await update(accepted);
  const [saved] = await migrationRows<{ roots: unknown }>(
    database,
    sql`select blueprint_root_refs as roots from process_occurrence where id=${occurrence.id}`,
  );
  assert.deepEqual(saved?.roots, accepted);
}

async function resolutionFixture(database: Database, fixture: BlueprintRetainedFixture) {
  const [occurrence] = await migrationRows<{
    id: string;
    roots: BlueprintOccurrenceRoot[];
    manifest: BlueprintInvocationManifest;
  }>(
    database,
    sql`select o.id,o.blueprint_root_refs as roots,i.manifest from process_occurrence o join work_template_blueprint_invocation i on i.id=o.blueprint_invocation_id and i.organization_id=o.organization_id where o.organization_id=${fixture.organizationId} order by o.id limit 1`,
  );
  assert.ok(occurrence);
  const ref = occurrence.roots.find((value) => value.kind === 'project');
  assert.ok(ref);
  const original = occurrence.manifest.roots.find((root) => root.sourceKey === ref.key);
  assert.ok(original?.workTypeId && original.workTypeVersionId);
  const root = { path: [], workTypeId: original.workTypeId, versionId: original.workTypeVersionId };
  const [taskBase] = await migrationRows<{ id: string; work_type_id: string }>(
    database,
    sql`select v.id,v.work_type_id from template t join work_type_version v on v.id=t.latest_published_version_id where t.organization_id=${fixture.organizationId} and t.is_base and t.target_type='task'`,
  );
  assert.ok(taskBase);
  const projections = await migrationRows<{ key: string; kind: 'task' | 'milestone' }>(
    database,
    sql`select key,kind from blueprint_step where organization_id=${fixture.organizationId} and version_id=${original.workTypeVersionId} and key in('checkpoint','task') order by sort`,
  );
  assert.equal(projections.length, 2);
  const manifest = [
    root,
    { path: ['task'], workTypeId: taskBase.work_type_id, versionId: taskBase.id },
  ];
  return { occurrence, ref, root, manifest };
}

async function replacePublicState(
  database: Database,
  organizationId: string,
  ref: BlueprintOccurrenceRoot,
): Promise<void> {
  const [base] = await migrationRows<{ id: string; work_type_id: string }>(
    database,
    sql`select v.id,v.work_type_id from template t join work_type_version v on v.id=t.latest_published_version_id and v.organization_id=t.organization_id where t.organization_id=${organizationId} and t.is_base and t.target_type::text=${ref.kind}`,
  );
  assert.ok(base);
  const state = {
    revision: 1,
    generationKey: ref.id,
    resolvedManifest: [{ path: [], workTypeId: base.work_type_id, versionId: base.id }],
    optionalChoices: [],
    creationTimezone: 'UTC',
    workingWeekdays: [1, 2, 3, 4, 5],
    lastApplicationChangeSetId: null,
  };
  await database.execute(
    sql`update ${sql.identifier(ref.kind)} set blueprint_state=${JSON.stringify(state)}::jsonb where organization_id=${organizationId} and id=${ref.id}`,
  );
}
