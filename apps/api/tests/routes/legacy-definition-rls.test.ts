/** A hidden converted head must never revive stale legacy creator authority. */
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { NotFoundError } from '../../src/error';
import { requireLegacyDefinitionAccess } from '../../src/lib/recurrence/legacy-definition-access';
import { rawResultRows } from '../../src/lib/raw-result';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { getDb } from '../support/routes-harness';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
it('denies stale old creator fallback for a null-owner converted head hidden by actual RLS', async () => {
  const f = await seedMcpUpdateOrg(schema.db, schema, ['manage']);
  const definition = await createPublishedProcessDefinition(schema.db, {
    organizationId: f.orgId,
    actorId: f.actorId,
    definition: ProcessDefinitionCreate.parse({
      name: 'Private legacy',
      creationMode: 'all_at_once',
      tasks: [{ key: 'work', title: 'Private body', teamId: f.teamId }],
    }),
  });
  await schema.db.insert(schema.invocationHead).values({
    id: definition.definitionId,
    organizationId: f.orgId,
    ownerActorId: null,
    name: 'Private converted head',
  });
  await schema.db
    .delete(schema.grant)
    .where(and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectKind, 'role')));
  await schema.db.insert(schema.grant).values({
    organizationId: f.orgId,
    subjectKind: 'actor',
    subjectId: f.actorId,
    resourceKind: 'organization',
    resourceId: f.orgId,
    capabilities: ['view', 'contribute'],
    effect: 'allow',
    cascades: false,
  });
  await schema.db.execute(sql`create role legacy_definition_reader nologin nobypassrls`);
  await schema.db.execute(sql`grant usage on schema public to legacy_definition_reader`);
  await schema.db.execute(
    sql`grant select on actor,organization,role,"grant",work_template_invocation_head,process_definition to legacy_definition_reader`,
  );
  await schema.db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('docket.organization_id',${f.orgId},true),set_config('docket.actor_id',${f.actorId},true)`,
    );
    await tx.execute(sql`set local role legacy_definition_reader`);
    const result = await tx.execute(
      sql`select row_security_active('work_template_invocation_head') as active`,
    );
    expect(rawResultRows<{ active: boolean }>(result)[0]?.active).toBe(true);
    expect(
      await tx
        .select()
        .from(schema.invocationHead)
        .where(eq(schema.invocationHead.id, definition.definitionId)),
    ).toHaveLength(0);
    expect(
      await tx
        .select()
        .from(schema.processDefinition)
        .where(eq(schema.processDefinition.id, definition.definitionId)),
    ).toHaveLength(1);
    await expect(
      requireLegacyDefinitionAccess(tx, {
        organizationId: f.orgId,
        actorId: f.actorId,
        definitionId: definition.definitionId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
