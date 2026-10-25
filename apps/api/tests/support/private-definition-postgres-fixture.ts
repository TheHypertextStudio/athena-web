import { assertDefined } from '@docket/test-utils';
import { expect } from 'vitest';
import * as schema from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { rawResultRows } from '../../src/lib/raw-result';
import type { seedPrivatePublicationActor } from './private-publication-fixture';

/** Seeded real actor used by direct-connection PostgreSQL service proofs. */
export type PrivateRuntimeActor = Awaited<ReturnType<typeof seedPrivatePublicationActor>>;
/** Run real service-owned transactions as a directly connected source-denied nonowner. */
export async function withSourceDeniedPrivateActor<T>(
  f: PrivateRuntimeActor,
  operation: (tx: schema.Database) => Promise<T>,
): Promise<T> {
  const url = new URL(assertDefined(process.env['DATABASE_URL']));
  expect(url.pathname).toMatch(/^\/history_oct25_alias180_/);
  url.username = 'history_oct25_alias_actor';
  const client = postgres(url.toString(), { max: 1, prepare: false });
  const database = drizzle(client, { schema: schema.fullSchema });
  try {
    await database.execute(
      sql`select set_config('docket.organization_id',${f.orgId},false),set_config('docket.actor_id',${f.humanActorId},false)`,
    );
    expect(
      rawResultRows(
        await database.execute(
          sql`select rolsuper,rolcreaterole,rolbypassrls from pg_roles where rolname=current_user`,
        ),
      ),
    ).toEqual([{ rolsuper: false, rolcreaterole: false, rolbypassrls: false }]);
    return await operation(database);
  } finally {
    await client.end();
  }
}
/** Count normalized rows and reusable definitions through the task owner for no-allocation assertions. */
export async function privateSourceCounts(): Promise<readonly Record<string, unknown>[]> {
  return rawResultRows(
    await schema.db.execute(
      sql`select (select count(*) from process_definition)::integer definitions,(select count(*) from process_revision)::integer revisions,(select count(*) from process_step)::integer steps,(select count(*) from process_instance)::integer instances,(select count(*) from process_instance_task)::integer tasks,(select count(*) from process_instance_project)::integer projects,(select count(*) from work_template_blueprint_conversion)::integer conversions,(select count(*) from template)::integer templates`,
    ),
  );
}
/** Register a genuine pending alias as a negative control for SQL published admission. */
export async function registerPendingPrivateAlias(
  f: PrivateRuntimeActor,
  revisionId: string,
): Promise<{ id: string; invocationId: string }> {
  const [original] = await schema.db
    .select({ manifest: schema.blueprintInvocation.manifest })
    .from(schema.invocationRevision)
    .innerJoin(
      schema.blueprintInvocation,
      eq(schema.blueprintInvocation.id, schema.invocationRevision.invocationId),
    )
    .where(eq(schema.invocationRevision.id, revisionId));
  if (original?.manifest.kind !== 'private_definition')
    throw new Error('Missing actual authored fixture publication.');
  const id = schema.genId();
  const manifest = {
    ...original.manifest,
    state: 'pending_draft' as const,
    authoring: { ...original.manifest.authoring, revisionAlias: id },
  };
  const [invocation] = await schema.db
    .insert(schema.blueprintInvocation)
    .values({ organizationId: f.orgId, ownerActorId: f.humanActorId, manifest, overrides: [] })
    .returning();
  if (!invocation) throw new Error('Missing pending fixture invocation.');
  await schema.db.insert(schema.invocationRevision).values({
    id,
    organizationId: f.orgId,
    headId: manifest.authoring.definitionAlias,
    invocationId: invocation.id,
    number: 2,
    state: 'pending_draft',
    creationMode: manifest.creationMode,
    origin: 'authored',
    authoredPayloadHash: schema.hashScheduleArchive(manifest),
    projection: sql`docket_authored_invocation_projection(${JSON.stringify(manifest)}::jsonb)`,
    createdBy: f.humanActorId,
    createdAt: new Date(),
    publishedAt: null,
  });
  return { id, invocationId: invocation.id };
}

/** Prepare only the owned task database's test role; no source table permission is granted. */
export async function initializePrivateRuntimePostgres(): Promise<void> {
  expect(process.env['DATABASE_URL']).toMatch(/^postgres(?:ql)?:/);
  expect(
    rawResultRows<{ ready: boolean }>(
      await schema.db.execute(sql`select docket_private_alias_references_enforced() as ready`),
    )[0]?.ready,
  ).toBe(true);
  await schema.db.execute(
    sql.raw(
      'DO $$ BEGIN CREATE ROLE history_oct25_alias_actor NOLOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$',
    ),
  );
  for (const statement of [
    'ALTER ROLE history_oct25_alias_actor LOGIN',
    'GRANT USAGE ON SCHEMA public TO history_oct25_alias_actor',
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO history_oct25_alias_actor',
    'GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO history_oct25_alias_actor',
    'GRANT EXECUTE ON FUNCTION docket_template_has_copy_reservation(text,text) TO history_oct25_alias_actor',
    'GRANT EXECUTE ON FUNCTION docket_copy_definition_view(text,text,text) TO history_oct25_alias_actor',
    'REVOKE ALL ON process_definition,process_revision,process_step,process_project_spec,process_milestone_spec,process_task_spec,process_task_label_spec,process_project_label_spec,process_dependency,process_instance,process_instance_project,process_instance_milestone,process_instance_task FROM history_oct25_alias_actor',
  ])
    await schema.db.execute(sql.raw(statement));
}
