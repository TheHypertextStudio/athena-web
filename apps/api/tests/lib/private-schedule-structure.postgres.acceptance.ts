import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as schema from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { rawResultRows } from '../../src/lib/raw-result';
import { installPrivateAliasReferenceCandidate } from '../support/private-alias-reference-candidate';
import { publishAndRunCommunityDinner } from '../support/private-schedule-run-fixture';

vi.mock('../support/db', () => ({ getMigratedDb: async () => schema }));
beforeAll(async () => {
  expect(process.env['DATABASE_URL']).toMatch(/^postgres(?:ql)?:/);
  await installPrivateAliasReferenceCandidate(schema.db);
  await schema.db.execute(sql`select docket_enforce_private_alias_references()`);
  await schema.db.execute(
    sql.raw(
      'DO $$ BEGIN CREATE ROLE private_structure_reader NOLOGIN NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$; GRANT USAGE ON SCHEMA public TO private_structure_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO private_structure_reader',
    ),
  );
});
afterAll(async () => {
  await schema.closeDb();
});

async function visibleSteps(organizationId: string, actorId: string): Promise<number> {
  return schema.db.transaction(async (tx) => {
    await tx.execute(sql.raw('SET LOCAL ROLE private_structure_reader'));
    await tx.execute(
      sql`select set_config('docket.organization_id',${organizationId},true),set_config('docket.actor_id',${actorId},true)`,
    );
    const [row] = rawResultRows<{ count: number }>(
      await tx.execute(
        sql`select count(*)::integer as count from work_template_private_step where organization_id=${organizationId}`,
      ),
    );
    return row?.count ?? -1;
  });
}

it('runs private structure on PostgreSQL and keeps registered steps from a workspace viewer without bypass', async () => {
  const dinner = await publishAndRunCommunityDinner(schema);
  const viewer = assertDefined(
    (
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: dinner.orgId, kind: 'human', displayName: 'Viewer' })
        .returning()
    )[0],
  );
  await schema.db.insert(schema.grant).values({
    organizationId: dinner.orgId,
    subjectKind: 'actor',
    subjectId: viewer.id,
    resourceKind: 'organization',
    resourceId: dinner.orgId,
    capabilities: ['view'],
    effect: 'allow',
    cascades: true,
  });
  expect(await visibleSteps(dinner.orgId, dinner.actorId)).toBe(4);
  expect(await visibleSteps(dinner.orgId, viewer.id)).toBe(0);
  const milestones = await schema.db
    .select({ alias: schema.milestone.privateStepAlias })
    .from(schema.milestone)
    .where(eq(schema.milestone.organizationId, dinner.orgId));
  expect(milestones).toEqual([{ alias: dinner.publication.stepIdsByKey['prep'] }]);
  const [ready] = rawResultRows<{ ready: boolean }>(
    await schema.db.execute(sql`select docket_private_structure_schema_ready() as ready`),
  );
  expect(ready?.ready).toBe(true);
});
