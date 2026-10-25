import { templates, publications } from './template-authoring-test-queries';
/** Automated template writes derive authority from persisted sessions and stay unpublished. */
import type * as DbModule from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { openToolbox as OpenToolbox, Toolbox } from '../../src/agent/toolbox';
import { getMigratedDb } from '../support/db';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import { closeCatalogClients, connectCatalog, errorText } from '../mcp/mcp-catalog-harness';

let schema!: typeof DbModule;
let openToolbox!: typeof OpenToolbox;
const opened: Toolbox[] = [];
beforeAll(async () => {
  schema = await getMigratedDb();
  ({ openToolbox } = await import('../../src/agent/toolbox'));
});
afterEach(async () => {
  while (opened.length) await opened.pop()?.close();
  await closeCatalogClients();
});

async function fixture(
  mode: 'routine_autonomy' | 'ask_before_acting' | 'suggest_only' = 'routine_autonomy',
) {
  const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
  if (f.ctx.principal.kind !== 'user') throw new Error('Expected a human fixture');
  const ownerUserId = f.ctx.principal.userId;
  await schema.db.insert(schema.hub).values({
    userId: ownerUserId,
    preferences: { athena: { approvalMode: mode } },
  });
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId,
      contextOrganizationId: f.orgId,
      trigger: 'delegation',
      status: 'running',
    })
    .returning();
  if (!session) throw new Error('Expected a session');
  const toolbox = await openToolbox({ kind: 'athena', ownerUserId }, session.id);
  opened.push(toolbox);
  return { ...f, ownerUserId, session, toolbox };
}
const definition = {
  name: 'Event preparation',
  scope: 'organization',
  payload: { targetType: 'project', description: '## Overview\nPrepare the event.' },
};

describe('trusted automated template authoring', () => {
  it('turns omitted legacy action into an owner-private canonical draft with a reversible receipt', async () => {
    const f = await fixture();
    const result = await f.toolbox.callTool('define_template', { orgId: f.orgId, ...definition });
    expect(result.isError, result.content).toBe(false);
    const [saved] = await templates(schema, f.orgId);
    expect(saved).toMatchObject({
      scope: 'personal',
      ownerActorId: f.actorId,
      publicationState: 'draft',
      latestPublishedVersionId: null,
    });
    expect(saved?.draftDefinition.payload).toMatchObject(definition.payload);
    expect(await publications(schema, f.orgId)).toHaveLength(0);
    const notices = await schema.db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.userId, f.ownerUserId));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.body).toMatchObject({ templateReview: { sessionId: f.session.id } });
    expect(JSON.stringify(notices[0]?.body)).not.toContain('Prepare the event.');
    expect(JSON.parse(result.content)).toMatchObject({
      publicationState: 'draft',
      changeSetId: expect.any(String),
    });
  });

  it.each(['publish', 'archive'] as const)(
    'refuses automated %s even when a canonical draft exists',
    async (action) => {
      const f = await fixture();
      await f.toolbox.callTool('define_template', {
        orgId: f.orgId,
        action: 'draft',
        ...definition,
      });
      const [saved] = await templates(schema, f.orgId);
      const result = await f.toolbox.callTool('define_template', {
        orgId: f.orgId,
        action,
        template: saved?.id,
        expectedRevision: saved?.draftRevision,
      });
      expect(result.isError).toBe(true);
      expect(await publications(schema, f.orgId)).toHaveLength(0);
      expect(await templates(schema, f.orgId)).toEqual([saved]);
    },
  );

  it.each(['ask_before_acting', 'suggest_only'] as const)(
    'does not claim a draft or proposal was saved in %s mode',
    async (mode) => {
      const f = await fixture(mode);
      const result = await f.toolbox.callTool('define_template', {
        orgId: f.orgId,
        action: 'draft',
        ...definition,
      });
      expect(result.isError).toBe(true);
      expect(await templates(schema, f.orgId)).toHaveLength(0);
    },
  );

  it('checks the actual target workspace entitlement on every call after toolbox creation', async () => {
    const f = await fixture();
    await schema.db
      .delete(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, f.orgId));
    const result = await f.toolbox.callTool('define_template', {
      orgId: f.orgId,
      action: 'draft',
      ...definition,
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('product_required');
    expect(await templates(schema, f.orgId)).toHaveLength(0);
  });

  it('rejects a forged executor whose supplied owner does not own the persisted session', async () => {
    const f = await fixture();
    const other = await fixture();
    const toolbox = await openToolbox(
      { kind: 'athena', ownerUserId: other.ownerUserId },
      f.session.id,
    );
    opened.push(toolbox);
    const result = await toolbox.callTool('define_template', {
      orgId: other.orgId,
      action: 'draft',
      ...definition,
    });
    expect(result.isError).toBe(true);
    expect(await templates(schema, other.orgId)).toHaveLength(0);
  });

  it('rechecks policy and membership when an existing toolbox resumes', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'admins' })
      .where(eq(schema.organization.id, f.orgId));
    expect(
      (await f.toolbox.callTool('define_template', { orgId: f.orgId, ...definition })).isError,
    ).toBe(true);
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'contributors' })
      .where(eq(schema.organization.id, f.orgId));
    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(and(eq(schema.actor.id, f.actorId), eq(schema.actor.organizationId, f.orgId)));
    expect(
      (await f.toolbox.callTool('define_template', { orgId: f.orgId, ...definition })).isError,
    ).toBe(true);
    expect(await templates(schema, f.orgId)).toHaveLength(0);
  });

  it('allows the exact persisted human-approved action and refuses altered definitions', async () => {
    const f = await fixture('ask_before_acting');
    const input = { orgId: f.orgId, action: 'draft', ...definition };
    const [activity] = await schema.db
      .insert(schema.sessionActivity)
      .values({
        sessionId: f.session.id,
        organizationId: f.orgId,
        type: 'action',
        approvalStatus: 'executing',
        body: {
          action: {
            kind: 'define_template',
            summary: 'Draft Event preparation',
            mode: 'proposal',
            toolCall: {
              connection: 'docket',
              tool: 'define_template',
              input,
              toolUseId: 'event-definition',
            },
          },
        },
      })
      .returning();
    if (!activity) throw new Error('Expected an activity');
    // An executing row alone is insufficient: autonomous claims have no human approval audit.
    expect((await f.toolbox.callTool('define_template', input)).isError).toBe(true);
    await schema.db.insert(schema.auditEvent).values({
      organizationId: f.orgId,
      actorId: f.actorId,
      subjectType: 'agent_session',
      subjectId: f.session.id,
      type: 'approved',
      metadata: { activityId: activity.id, approverActorId: f.actorId },
    });
    expect(
      (
        await f.toolbox.callTool('define_template', {
          ...input,
          payload: { targetType: 'project', description: 'Changed after review' },
        })
      ).isError,
    ).toBe(true);
    const result = await f.toolbox.callTool('define_template', input);
    expect(result.isError, result.content).toBe(false);
    expect(await templates(schema, f.orgId)).toHaveLength(1);
    expect(await publications(schema, f.orgId)).toHaveLength(0);
  });

  it('preserves manual human MCP maintenance despite caller-supplied Athena labels', async () => {
    const f = await fixture();
    const { registerTools } = await import('../../src/mcp/tools');
    const client = await connectCatalog(registerTools, f.ctx);
    const result = await client.callTool({
      name: 'define_template',
      arguments: {
        orgId: f.orgId,
        action: 'draft',
        ...definition,
        scope: 'personal',
        executorKind: 'athena',
        sessionId: f.session.id,
        ownerActorId: f.sarahId,
      },
    });
    expect(result.isError, errorText(result)).not.toBe(true);
    expect(await templates(schema, f.orgId)).toMatchObject([
      { ownerActorId: f.actorId, publicationState: 'draft' },
    ]);
  });

  it('refuses missing sessions and stopped sessions even with forged JSON proof', async () => {
    const f = await fixture();
    const noSession = await openToolbox({ kind: 'athena', ownerUserId: f.ownerUserId });
    opened.push(noSession);
    const input = {
      orgId: f.orgId,
      ...definition,
      sessionId: f.session.id,
      trusted: true,
      ownerActorId: f.actorId,
    };
    expect((await noSession.callTool('define_template', input)).isError).toBe(true);
    await schema.db
      .update(schema.agentSession)
      .set({ status: 'canceled' })
      .where(eq(schema.agentSession.id, f.session.id));
    expect((await f.toolbox.callTool('define_template', input)).isError).toBe(true);
    expect(await templates(schema, f.orgId)).toHaveLength(0);
  });

  it('creates a separate private draft when editing a published shared template', async () => {
    const f = await fixture();
    const { createWorkTemplate, publishWorkTemplate } =
      await import('../../src/lib/templates/service');
    const { WorkTemplateCreate } = await import('@docket/work/work-template-contract');
    const draft = await createWorkTemplate(
      { orgId: f.orgId, actorId: f.actorId },
      WorkTemplateCreate.parse({
        scope: 'organization',
        targetType: 'project',
        definition: {
          name: 'Existing Event',
          payload: { targetType: 'project', description: 'Published original' },
        },
      }),
    );
    const published = await publishWorkTemplate(
      { orgId: f.orgId, actorId: f.actorId },
      draft.id,
      draft.draftRevision,
    );
    const result = await f.toolbox.callTool('define_template', {
      orgId: f.orgId,
      template: published.id,
      expectedRevision: published.draftRevision,
      name: 'Tailored Event',
    });
    expect(result.isError, result.content).toBe(false);
    const rows = await templates(schema, f.orgId);
    expect(rows.find((row) => row.id === published.id)).toEqual(published);
    expect(rows.find((row) => row.id !== published.id)).toMatchObject({
      name: 'Tailored Event',
      scope: 'personal',
      publicationState: 'draft',
      ownerActorId: f.actorId,
    });
    expect(await publications(schema, f.orgId)).toHaveLength(1);
  });

  it('checks the actual target tenant rather than a paid session context tenant', async () => {
    const f = await fixture();
    const target = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    await schema.db
      .update(schema.actor)
      .set({ userId: f.ownerUserId })
      .where(eq(schema.actor.id, target.actorId));
    await schema.db
      .delete(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, target.orgId));
    const result = await f.toolbox.callTool('define_template', {
      orgId: target.orgId,
      ...definition,
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('product_required');
    expect(await templates(schema, target.orgId)).toHaveLength(0);
  });

  it('keeps a registered agent draft private to its real active actor', async () => {
    const f = await fixture();
    const [member] = await schema.db
      .insert(schema.actor)
      .values({ organizationId: f.orgId, kind: 'agent', displayName: 'Event helper' })
      .returning();
    if (!member) throw new Error('Expected an agent actor');
    const [registration] = await schema.db
      .insert(schema.agent)
      .values({
        organizationId: f.orgId,
        actorId: member.id,
        approvalPolicy: 'autonomous',
        createdBy: f.actorId,
      })
      .returning();
    if (!registration) throw new Error('Expected an agent registration');
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: member.id,
      resourceKind: 'organization',
      resourceId: f.orgId,
      capabilities: ['view', 'contribute'],
      effect: 'allow',
    });
    const [session] = await schema.db
      .insert(schema.agentSession)
      .values({
        organizationId: f.orgId,
        agentId: registration.id,
        executorKind: 'registered_agent',
        initiatorId: f.actorId,
        trigger: 'delegation',
        status: 'running',
      })
      .returning();
    if (!session) throw new Error('Expected an agent session');
    const toolbox = await openToolbox(
      { kind: 'registered_agent', organizationId: f.orgId, agentId: registration.id },
      session.id,
    );
    opened.push(toolbox);
    const result = await toolbox.callTool('define_template', {
      orgId: f.orgId,
      ...definition,
      ownerActorId: f.actorId,
    });
    expect(result.isError, result.content).toBe(false);
    const [saved] = await templates(schema, f.orgId);
    expect(saved).toMatchObject({
      scope: 'personal',
      ownerActorId: member.id,
      publicationState: 'draft',
    });
    const { getWorkTemplate } = await import('../../src/lib/templates/service');
    await expect(
      getWorkTemplate({ orgId: f.orgId, actorId: f.actorId }, saved?.id ?? ''),
    ).rejects.toMatchObject({ code: 'not_found' });
    const [proposal] = await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.sessionId, session.id));
    if (!proposal) throw new Error('Expected a review proposal');
    const { decideTemplateProposal, getTemplateProposalReview } =
      await import('../../src/agent/template-proposal-review');
    const caller = { orgId: f.orgId, actorId: f.actorId, userId: f.ownerUserId };
    const reviewed = await getTemplateProposalReview(caller, proposal.activityId);
    expect(reviewed.templateId).toBeNull();
    expect(reviewed.proposerName).toBe('Event helper');
    expect(reviewed.hasReceipt).toBe(false);
    const kept = await decideTemplateProposal(caller, proposal.activityId, {
      action: 'keep',
      expectedRevision: reviewed.revision,
      expectedTemplateRevision: null,
    });
    expect(kept.hasReceipt).toBe(true);
    expect(await getWorkTemplate(caller, kept.templateId ?? '')).toMatchObject({
      ownerActorId: f.actorId,
      publicationState: 'draft',
      latestPublishedVersionId: null,
    });
    await expect(getWorkTemplate(caller, saved?.id ?? '')).rejects.toMatchObject({
      code: 'not_found',
    });
    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, member.id));
    expect(
      (await toolbox.callTool('define_template', { orgId: f.orgId, ...definition })).isError,
    ).toBe(true);
    expect(await templates(schema, f.orgId)).toHaveLength(2);
  });

  it('rechecks saved review policy before automated template Undo', async () => {
    const f = await fixture();
    const result = await f.toolbox.callTool('define_template', { orgId: f.orgId, ...definition });
    expect(result.isError, result.content).toBe(false);
    const receipt = JSON.parse(result.content) as { changeSetId: string };
    const before = await templates(schema, f.orgId);
    await schema.db
      .update(schema.hub)
      .set({ preferences: { athena: { approvalMode: 'suggest_only' } } })
      .where(eq(schema.hub.userId, f.ownerUserId));
    const undone = await f.toolbox.callTool('undo', {
      orgId: f.orgId,
      changeSetId: receipt.changeSetId,
    });
    expect(undone.isError).toBe(true);
    expect(await templates(schema, f.orgId)).toEqual(before);
  });

  it('executes the exact reviewed template Undo and retains unrelated work', async () => {
    const f = await fixture();
    const created = await f.toolbox.callTool('define_template', { orgId: f.orgId, ...definition });
    expect(created.isError, created.content).toBe(false);
    const receipt = JSON.parse(created.content) as { changeSetId: string };
    const input = { orgId: f.orgId, changeSetId: receipt.changeSetId };
    const [activity] = await schema.db
      .insert(schema.sessionActivity)
      .values({
        sessionId: f.session.id,
        organizationId: f.orgId,
        type: 'action',
        approvalStatus: 'executing',
        body: {
          action: {
            kind: 'undo',
            summary: 'Undo Event draft',
            mode: 'proposal',
            toolCall: { connection: 'docket', tool: 'undo', input, toolUseId: 'event-undo' },
          },
        },
      })
      .returning();
    if (!activity) throw new Error('Expected an action');
    expect((await f.toolbox.callTool('undo', input)).isError).toBe(true);
    await schema.db.insert(schema.auditEvent).values({
      organizationId: f.orgId,
      actorId: f.actorId,
      subjectType: 'agent_session',
      subjectId: f.session.id,
      type: 'approved',
      metadata: { activityId: activity.id, approverActorId: f.actorId },
    });
    const undone = await f.toolbox.callTool('undo', input);
    expect(undone.isError, undone.content).toBe(false);
    expect(await templates(schema, f.orgId)).toHaveLength(0);
    const [project] = await schema.db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, f.projectId));
    expect(project).toMatchObject({ name: 'Platform Migration', archivedAt: null });
  });

  it('checks Athena entitlement independently of the MCP channel gate', async () => {
    const f = await fixture();
    const { registerTemplateExecutor, requireAutomatedTemplateAuthor } =
      await import('../../src/agent/template-authority');
    registerTemplateExecutor(f.ctx, f.session.id);
    await schema.db
      .delete(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, f.orgId));
    await expect(
      requireAutomatedTemplateAuthor(
        f.ctx,
        { orgId: f.orgId, actorId: f.actorId },
        { orgId: f.orgId, ...definition },
      ),
    ).rejects.toMatchObject({ code: 'product_required' });
    expect(await templates(schema, f.orgId)).toHaveLength(0);
  });

  it('rolls back the canonical draft when its reversible receipt cannot be persisted', async () => {
    const f = await fixture();
    await schema.db.execute(
      sql`CREATE FUNCTION test_refuse_template_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture receipt persistence failed'; END; $$`,
    );
    await schema.db.execute(
      sql`CREATE TRIGGER test_refuse_template_receipt BEFORE INSERT ON change_set FOR EACH ROW EXECUTE FUNCTION test_refuse_template_receipt()`,
    );
    try {
      const result = await f.toolbox.callTool('define_template', { orgId: f.orgId, ...definition });
      expect(result.isError).toBe(true);
      expect(await templates(schema, f.orgId)).toHaveLength(0);
      expect(await publications(schema, f.orgId)).toHaveLength(0);
    } finally {
      await schema.db.execute(sql`DROP TRIGGER test_refuse_template_receipt ON change_set`);
      await schema.db.execute(sql`DROP FUNCTION test_refuse_template_receipt()`);
    }
  });
});
