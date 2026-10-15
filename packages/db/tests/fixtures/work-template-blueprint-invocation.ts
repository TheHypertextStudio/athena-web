import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type {
  BlueprintInvocationManifest,
  BlueprintInvocationOverride,
} from '../../src/blueprint-invocation';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import type { BlueprintRetainedFixture } from './work-template-blueprint-migration';

interface StoredInvocation {
  readonly manifest: BlueprintInvocationManifest;
  readonly overrides: readonly BlueprintInvocationOverride[];
}

async function insertInvocation(
  database: Database,
  fixture: BlueprintRetainedFixture,
  value: StoredInvocation,
  ownerActorId: string | null,
) {
  const id = genId();
  await database.execute(
    sql`insert into work_template_blueprint_invocation(id,organization_id,owner_actor_id,manifest,overrides) values(${id},${fixture.organizationId},${ownerActorId},${JSON.stringify(value.manifest)}::jsonb,${JSON.stringify(value.overrides)}::jsonb)`,
  );
  const [saved] = await migrationRows<StoredInvocation>(
    database,
    sql`select manifest,overrides from work_template_blueprint_invocation where id=${id}`,
  );
  assert.deepEqual(saved, value);
}

/** Exercise valid, nonempty invocation writes after enforcement rather than only pre-enforce backfill. */
export async function exerciseBlueprintInvocationWrites(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  const rows = await migrationRows<StoredInvocation>(
    database,
    sql`select i.manifest,i.overrides from work_template_blueprint_invocation i join work_template_blueprint_conversion c on c.invocation_id=i.id where c.legacy_process_revision_id in(${fixture.forestRevisionId},${fixture.draftRevisionId})`,
  );
  const published = rows.find((row) => row.manifest.kind === 'published');
  const draft = rows.find((row) => row.manifest.kind === 'pending_draft');
  assert.ok(published);
  assert.ok(draft);
  assert.ok(published.manifest.roots.length > 1);
  assert.ok(published.manifest.steps.length > 1);
  assert.ok(published.manifest.dependencies.length > 0);
  assert.ok(published.overrides.length > 0);
  await insertInvocation(database, fixture, published, fixture.actorId);
  await insertInvocation(database, fixture, published, null);
  await insertInvocation(database, fixture, draft, fixture.actorId);
  const [base] = await migrationRows<{ id: string; version_id: string }>(
    database,
    sql`select id,latest_published_version_id as version_id from template where organization_id=${fixture.organizationId} and is_base and target_type='task'`,
  );
  assert.ok(base);
  const edge = published.manifest.dependencies[0];
  assert.ok(edge);
  const overrides = published.overrides.map((override) => {
    if (override.sourceStepId === fixture.forestTaskStepId)
      return {
        ...override,
        fields: {
          ...override.fields,
          team_id: fixture.teamId,
          assignee_id: fixture.actorId,
          project_id: fixture.projectId,
          milestone_id: fixture.milestoneId,
          work_type_id: base.id,
          work_type_version_id: base.version_id,
        },
      };
    if (override.sourceStepId === edge.blockedStepId)
      return {
        ...override,
        timing: {
          kind: 'after_step_completion' as const,
          offsetDays: 2,
          afterStepId: edge.blockerStepId,
        },
      };
    return override;
  });
  await insertInvocation(database, fixture, { ...published, overrides }, fixture.actorId);
  const invalid = published.overrides.map((override) =>
    override.sourceStepId === fixture.forestTaskStepId
      ? { ...override, fields: { ...override.fields, team_id: genId() } }
      : override,
  );
  await assert.rejects(
    insertInvocation(database, fixture, { ...published, overrides: invalid }, fixture.actorId),
  );
}
