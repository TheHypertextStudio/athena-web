import { beforeAll, describe, expect, it } from 'vitest';
import type * as Db from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import { WorkTemplateCreate, WorkTemplateDraftUpdate } from '@docket/work/work-template-contract';
import { mayAuthorTemplates } from '../../src/lib/templates/authorization';
import { getMigratedDb } from '../support/db';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import {
  createWorkTemplate,
  editWorkTemplateDraft,
  publishWorkTemplate,
} from '../../src/lib/templates/service';
let schema: typeof Db;
beforeAll(async () => {
  schema = await getMigratedDb();
  await schema.db.execute(sql`create role template_body_reader nologin`);
  await schema.db.execute(sql`grant usage on schema public to template_body_reader`);
  await schema.db.execute(
    sql`grant select,update,delete,insert on template,work_type_version,work_type_team to template_body_reader`,
  );
});
async function fixture() {
  const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
  await schema.db.insert(schema.grant).values({
    organizationId: f.orgId,
    subjectKind: 'actor',
    subjectId: f.sarahId,
    resourceKind: 'organization',
    resourceId: f.orgId,
    capabilities: ['view'],
    effect: 'allow',
  });
  const author = { orgId: f.orgId, actorId: f.actorId };
  const make = (scope: 'personal' | 'team' | 'organization', name: string) =>
    createWorkTemplate(
      author,
      WorkTemplateCreate.parse({
        targetType: 'project',
        scope,
        teamId: scope === 'team' ? f.teamId : undefined,
        definition: { name, payload: { targetType: 'project', description: name } },
      }),
    );
  await schema.db
    .insert(schema.teamMember)
    .values({ organizationId: f.orgId, teamId: f.teamId, actorId: f.actorId });
  const personal = await make('personal', 'Owner secret');
  const team = await make('team', 'Team secret');
  const draft = await make('organization', 'Unpublished secret');
  const published = await make('personal', 'Public publication');
  await publishWorkTemplate(author, published.id, 0);
  await editWorkTemplateDraft(
    author,
    published.id,
    WorkTemplateDraftUpdate.parse({
      expectedRevision: 1,
      definition: {
        name: 'Unpublished edit secret',
        payload: { targetType: 'project', description: 'Unpublished edit secret' },
      },
    }),
  );
  return { ...f, author, personal, team, draft, published };
}
async function asReader<T>(
  f: Awaited<ReturnType<typeof fixture>>,
  actorId: string,
  operation: (tx: Db.Database) => Promise<T>,
  orgId = f.orgId,
): Promise<T> {
  return schema.db.transaction(async (tx) => {
    await tx.execute(sql`set local role template_body_reader`);
    await tx.execute(
      sql`select set_config('docket.organization_id',${orgId},true),set_config('docket.actor_id',${actorId},true)`,
    );
    return operation(tx);
  });
}
describe('canonical template raw-body privacy', () => {
  it('keeps personal, team and unpublished drafts out of another workspace member raw reads', async () => {
    const f = await fixture();
    const rows = await asReader(f, f.sarahId, (tx) =>
      tx.select().from(schema.template).where(eq(schema.template.organizationId, f.orgId)),
    );
    expect(rows).toHaveLength(0);
    const own = await asReader(f, f.actorId, (tx) =>
      tx.select().from(schema.template).where(eq(schema.template.id, f.personal.id)),
    );
    expect(own[0]?.draftDefinition.name).toBe('Owner secret');
  });
  it('offers immutable publication without exposing an unpublished edit, including after author capability revocation', async () => {
    const f = await fixture();
    const versions = await asReader(f, f.sarahId, (tx) =>
      tx
        .select()
        .from(schema.workTypeVersion)
        .where(eq(schema.workTypeVersion.workTypeId, f.published.id)),
    );
    expect(versions[0]?.definition.name).toBe('Public publication');
    const publication = await asReader(f, f.sarahId, (tx) =>
      tx.execute(sql`select definition from work_template_published where id=${f.published.id}`),
    );
    expect(JSON.stringify(publication)).toContain('Public publication');
    expect(JSON.stringify(publication)).not.toContain('Unpublished edit secret');
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'admins' })
      .where(eq(schema.organization.id, f.orgId));
    expect(
      await asReader(f, f.actorId, (tx) =>
        tx.select().from(schema.template).where(eq(schema.template.id, f.published.id)),
      ),
    ).toHaveLength(0);
    expect(
      await asReader(f, f.actorId, (tx) =>
        tx
          .select()
          .from(schema.workTypeVersion)
          .where(eq(schema.workTypeVersion.workTypeId, f.published.id)),
      ),
    ).toHaveLength(1);
  });
  it('retains actual team visibility and rejects foreign or inactive identities', async () => {
    const f = await fixture();
    await schema.db
      .insert(schema.teamMember)
      .values({ organizationId: f.orgId, teamId: f.teamId, actorId: f.sarahId });
    expect(
      await asReader(f, f.sarahId, (tx) =>
        tx.select().from(schema.template).where(eq(schema.template.id, f.team.id)),
      ),
    ).toHaveLength(1);
    expect(
      await asReader(f, f.sarahId, (tx) => tx.select().from(schema.template), 'foreign'),
    ).toHaveLength(0);
    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, f.sarahId));
    expect(await asReader(f, f.sarahId, (tx) => tx.select().from(schema.template))).toHaveLength(0);
    expect(
      await asReader(f, f.sarahId, (tx) => tx.select().from(schema.workTypeVersion)),
    ).toHaveLength(0);
  });
  it('cannot write a teammate draft with view capability or read personal drafts with contributor capability', async () => {
    const f = await fixture();
    await schema.db
      .insert(schema.teamMember)
      .values({ organizationId: f.orgId, teamId: f.teamId, actorId: f.sarahId });
    expect(
      await asReader(f, f.sarahId, (tx) =>
        tx
          .update(schema.template)
          .set({ description: 'changed' })
          .where(eq(schema.template.id, f.team.id))
          .returning(),
      ),
    ).toHaveLength(0);
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['view', 'contribute'] })
      .where(eq(schema.grant.subjectId, f.sarahId));
    expect(
      await asReader(f, f.sarahId, (tx) =>
        tx.select().from(schema.template).where(eq(schema.template.id, f.personal.id)),
      ),
    ).toHaveLength(0);
    expect(
      await asReader(f, f.sarahId, (tx) =>
        tx.select().from(schema.template).where(eq(schema.template.id, f.published.id)),
      ),
    ).toHaveLength(1);
  });
  it('matches explicit allow capability semantics for assign and deferred deny facts', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['assign'] })
      .where(eq(schema.grant.subjectId, f.sarahId));
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: f.sarahId,
      resourceKind: 'organization',
      resourceId: f.orgId,
      capabilities: ['contribute'],
      effect: 'deny',
    });
    // Deny precedence is explicitly deferred in the canonical evaluator; do not invent a second policy.
    expect(await mayAuthorTemplates({ orgId: f.orgId, actorId: f.sarahId })).toBe(true);
    expect(
      await asReader(f, f.sarahId, (tx) =>
        tx.select().from(schema.template).where(eq(schema.template.id, f.published.id)),
      ),
    ).toHaveLength(1);
  });
});
