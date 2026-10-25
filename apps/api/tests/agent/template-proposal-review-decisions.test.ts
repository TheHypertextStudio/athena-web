/** Review decisions on drafts Athena or a registered agent already wrote for their reviewer. */
import type * as Db from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Toolbox } from '../../src/agent/toolbox';
import { getMigratedDb } from '../support/db';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import { persistTemplateToolProposal } from '../../src/agent/template-proposal-loop';
import {
  decideTemplateProposal,
  getTemplateProposalReview,
} from '../../src/agent/template-proposal-review';
import { publishWorkTemplate } from '../../src/lib/templates/service';

let schema: typeof Db;
const opened: Toolbox[] = [];
beforeAll(async () => {
  schema = await getMigratedDb();
});
afterEach(async () => {
  while (opened.length) await opened.pop()?.close();
});

const definition = {
  name: 'Event',
  payload: { targetType: 'project', description: 'Prepare event' },
};

async function human() {
  const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
  if (f.ctx.principal.kind !== 'user') throw new Error('Human fixture required');
  const userId = f.ctx.principal.userId;
  return { ...f, userId, caller: { orgId: f.orgId, actorId: f.actorId, userId } };
}

async function proposalFor(sessionId: string) {
  const [proposal] = await schema.db
    .select()
    .from(schema.sessionTemplateProposal)
    .where(eq(schema.sessionTemplateProposal.sessionId, sessionId));
  return assertDefined(proposal);
}

/** Let Athena write a private draft under routine autonomy, returning its review proposal. */
async function athenaDraft() {
  const f = await human();
  await schema.db.insert(schema.hub).values({
    userId: f.userId,
    preferences: { athena: { approvalMode: 'routine_autonomy' } },
  });
  const [row] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: f.userId,
      contextOrganizationId: f.orgId,
      trigger: 'delegation',
      status: 'running',
    })
    .returning();
  const session = assertDefined(row);
  const { openToolbox } = await import('../../src/agent/toolbox');
  const toolbox = await openToolbox({ kind: 'athena', ownerUserId: f.userId }, session.id);
  opened.push(toolbox);
  const result = await toolbox.callTool('define_template', { orgId: f.orgId, ...definition });
  expect(result.isError, result.content).toBe(false);
  return { ...f, session, proposal: await proposalFor(session.id) };
}

/** Let a registered agent write its own private draft, returning the proposal for its initiator. */
async function agentDraft() {
  const f = await human();
  const [member] = await schema.db
    .insert(schema.actor)
    .values({ organizationId: f.orgId, kind: 'agent', displayName: 'Event helper' })
    .returning();
  const agentActor = assertDefined(member);
  const [registration] = await schema.db
    .insert(schema.agent)
    .values({
      organizationId: f.orgId,
      actorId: agentActor.id,
      approvalPolicy: 'autonomous',
      createdBy: f.actorId,
    })
    .returning();
  await schema.db.insert(schema.hub).values({
    userId: f.userId,
    preferences: { athena: { approvalMode: 'routine_autonomy' } },
  });
  await schema.db.insert(schema.grant).values({
    organizationId: f.orgId,
    subjectKind: 'actor',
    subjectId: agentActor.id,
    resourceKind: 'organization',
    resourceId: f.orgId,
    capabilities: ['view', 'contribute'],
    effect: 'allow',
  });
  const agentId = assertDefined(registration).id;
  const [row] = await schema.db
    .insert(schema.agentSession)
    .values({
      organizationId: f.orgId,
      agentId,
      executorKind: 'registered_agent',
      initiatorId: f.actorId,
      trigger: 'delegation',
      status: 'running',
    })
    .returning();
  const session = assertDefined(row);
  const { openToolbox } = await import('../../src/agent/toolbox');
  const toolbox = await openToolbox(
    { kind: 'registered_agent', organizationId: f.orgId, agentId },
    session.id,
  );
  opened.push(toolbox);
  const result = await toolbox.callTool('define_template', { orgId: f.orgId, ...definition });
  expect(result.isError, result.content).toBe(false);
  return { ...f, session, proposal: await proposalFor(session.id) };
}

describe('keeping a draft the reviewer already owns', () => {
  it('keeps the exact reviewed draft revision without creating another template', async () => {
    const f = await athenaDraft();
    const review = await getTemplateProposalReview(f.caller, f.proposal.activityId);
    expect(review.templateId).toBe(f.proposal.templateId);

    await expect(
      decideTemplateProposal(f.caller, f.proposal.activityId, {
        action: 'keep',
        expectedRevision: review.revision,
        expectedTemplateRevision: (review.templateRevision ?? 0) + 1,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const kept = await decideTemplateProposal(f.caller, f.proposal.activityId, {
      action: 'keep',
      expectedRevision: review.revision,
      expectedTemplateRevision: review.templateRevision,
    });
    expect(kept).toMatchObject({ state: 'kept', templateId: f.proposal.templateId });
    const templates = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.ownerActorId, f.actorId));
    expect(templates).toHaveLength(1);
  });

  it('refuses to keep a draft that has since been published', async () => {
    const f = await athenaDraft();
    const review = await getTemplateProposalReview(f.caller, f.proposal.activityId);
    const published = await publishWorkTemplate(
      f.caller,
      assertDefined(review.templateId),
      assertDefined(review.templateRevision),
    );

    await expect(
      decideTemplateProposal(f.caller, f.proposal.activityId, {
        action: 'keep',
        expectedRevision: review.revision,
        expectedTemplateRevision: published.draftRevision,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await getTemplateProposalReview(f.caller, f.proposal.activityId)).state).toBe(
      'pending',
    );
  });

  it('refuses to keep a draft that is no longer private', async () => {
    const f = await athenaDraft();
    const review = await getTemplateProposalReview(f.caller, f.proposal.activityId);
    await schema.db
      .update(schema.template)
      .set({ scope: 'organization' })
      .where(eq(schema.template.id, assertDefined(review.templateId)));

    await expect(
      decideTemplateProposal(f.caller, f.proposal.activityId, {
        action: 'keep',
        expectedRevision: review.revision,
        expectedTemplateRevision: review.templateRevision,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('undoing a review', () => {
  it('refuses Undo before anything was kept', async () => {
    const f = await human();
    const [row] = await schema.db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: f.userId,
        contextOrganizationId: f.orgId,
        status: 'running',
        trigger: 'delegation',
      })
      .returning();
    const session = assertDefined(row);
    await schema.db.transaction((tx) =>
      persistTemplateToolProposal(tx, {
        sessionId: session.id,
        orgId: f.orgId,
        toolUseId: 'proposal-call',
        proposalGroupId: schema.genId(),
        execute: false,
        raw: { orgId: f.orgId, ...definition },
      }),
    );
    const proposal = await proposalFor(session.id);

    await expect(
      decideTemplateProposal(f.caller, proposal.activityId, {
        action: 'undo',
        expectedRevision: proposal.revision,
        expectedTemplateRevision: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to undo an agent’s own pending draft on the reviewer’s behalf', async () => {
    const f = await agentDraft();
    expect(f.proposal.changeSetId).not.toBeNull();

    await expect(
      decideTemplateProposal(f.caller, f.proposal.activityId, {
        action: 'undo',
        expectedRevision: f.proposal.revision,
        expectedTemplateRevision: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await getTemplateProposalReview(f.caller, f.proposal.activityId)).state).toBe(
      'pending',
    );
  });
});

describe('review identity', () => {
  it('hides a proposal once live routing names a different reviewer', async () => {
    const f = await agentDraft();
    const [ada] = await schema.db.select().from(schema.actor).where(eq(schema.actor.id, f.actorId));
    const [user] = await schema.db
      .insert(schema.user)
      .values({ name: 'Grace', email: `grace-${schema.genId()}@e.com` })
      .returning();
    const [approver] = await schema.db
      .insert(schema.actor)
      .values({
        organizationId: f.orgId,
        kind: 'human',
        displayName: 'Grace',
        userId: assertDefined(user).id,
        roleId: assertDefined(ada).roleId,
      })
      .returning();
    await schema.db
      .update(schema.agent)
      .set({ approvalRouting: { mode: 'fixed', approverActorId: assertDefined(approver).id } })
      .where(eq(schema.agent.id, assertDefined(f.session.agentId)));

    await expect(getTemplateProposalReview(f.caller, f.proposal.activityId)).rejects.toMatchObject({
      status: 404,
    });
  });
});
