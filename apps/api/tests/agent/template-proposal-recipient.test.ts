/** Proposal recipients come only from persisted sessions and live review routing. */
import type * as Db from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getMigratedDb } from '../support/db';
import { seedMcpUpdateOrg, type McpUpdateSeed } from '../mcp/mcp-update-tool-fixtures';
import { templateProposalRecipient } from '../../src/agent/template-proposal-recipient';

let schema: typeof Db;
beforeAll(async () => {
  schema = await getMigratedDb();
});

type ApprovalRouting = NonNullable<typeof Db.agent.$inferInsert.approvalRouting>;

/** Options for a registered-agent session under test. */
interface AgentSessionOptions {
  readonly routing?: ApprovalRouting | null;
  readonly agentOrgId?: string;
  readonly sessionOrgId?: string;
}

/** Register an agent in `seed` and start one of its sessions, initiated by the seeded human. */
async function agentSession(seed: McpUpdateSeed, options: AgentSessionOptions = {}) {
  const agentOrgId = options.agentOrgId ?? seed.orgId;
  const [member] = await schema.db
    .insert(schema.actor)
    .values({ organizationId: agentOrgId, kind: 'agent', displayName: 'Event helper' })
    .returning();
  const proposer = assertDefined(member);
  const [registration] = await schema.db
    .insert(schema.agent)
    .values({
      organizationId: agentOrgId,
      actorId: proposer.id,
      createdBy: seed.actorId,
      approvalRouting: options.routing ?? null,
    })
    .returning();
  await schema.db.insert(schema.grant).values({
    organizationId: agentOrgId,
    subjectKind: 'actor',
    subjectId: proposer.id,
    resourceKind: 'organization',
    resourceId: agentOrgId,
    capabilities: ['view', 'contribute'],
    effect: 'allow',
  });
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      organizationId: options.sessionOrgId ?? seed.orgId,
      agentId: assertDefined(registration).id,
      executorKind: 'registered_agent',
      initiatorId: seed.actorId,
      trigger: 'delegation',
      status: 'running',
    })
    .returning();
  return { proposer, session: assertDefined(session) };
}

async function athenaSession(seed: McpUpdateSeed, ownerUserId: string) {
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId,
      contextOrganizationId: seed.orgId,
      trigger: 'delegation',
      status: 'running',
    })
    .returning();
  return assertDefined(session);
}

describe('templateProposalRecipient', () => {
  it('routes an Athena proposal to its owning member as both proposer and reviewer', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    if (seed.ctx.principal.kind !== 'user') throw new Error('Human fixture required');
    const session = await athenaSession(seed, seed.ctx.principal.userId);

    const resolved = await templateProposalRecipient(schema.db, session.id, seed.orgId);

    expect(resolved).toMatchObject({
      proposerActorId: seed.actorId,
      recipientActorId: seed.actorId,
      recipientUserId: seed.ctx.principal.userId,
    });
  });

  it('refuses an unknown session and an Athena session owned outside the workspace', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const other = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    if (other.ctx.principal.kind !== 'user') throw new Error('Human fixture required');
    await expect(
      templateProposalRecipient(schema.db, 'missing-session', seed.orgId),
    ).rejects.toMatchObject({ status: 404 });
    const foreignOwner = await athenaSession(seed, other.ctx.principal.userId);
    await expect(
      templateProposalRecipient(schema.db, foreignOwner.id, seed.orgId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('routes an assigner-routed agent proposal to the human who initiated the session', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const f = await agentSession(seed, { routing: { mode: 'assigner' } });

    const resolved = await templateProposalRecipient(schema.db, f.session.id, seed.orgId);

    expect(resolved.proposerActorId).toBe(f.proposer.id);
    expect(resolved.recipientActorId).toBe(seed.actorId);
  });

  it('routes a fixed-routed agent proposal only to an approver who can sign in', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const fixed = await agentSession(seed, {
      routing: { mode: 'fixed', approverActorId: seed.actorId },
    });
    expect(
      (await templateProposalRecipient(schema.db, fixed.session.id, seed.orgId)).recipientActorId,
    ).toBe(seed.actorId);

    const userless = await agentSession(seed, {
      routing: { mode: 'fixed', approverActorId: seed.sarahId },
    });
    await expect(
      templateProposalRecipient(schema.db, userless.session.id, seed.orgId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses routing that does not identify exactly one reviewer', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const role = await agentSession(seed, { routing: { mode: 'role', approverRoleId: 'role-1' } });
    await expect(
      templateProposalRecipient(schema.db, role.session.id, seed.orgId),
    ).rejects.toMatchObject({ status: 403 });
    const unnamed = await agentSession(seed, { routing: { mode: 'fixed' } });
    await expect(
      templateProposalRecipient(schema.db, unnamed.session.id, seed.orgId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses agent sessions from another workspace or without a same-workspace registration', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const other = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const foreignSession = await agentSession(seed, { sessionOrgId: other.orgId });
    await expect(
      templateProposalRecipient(schema.db, foreignSession.session.id, seed.orgId),
    ).rejects.toMatchObject({ status: 404 });
    const foreignAgent = await agentSession(seed, { agentOrgId: other.orgId });
    await expect(
      templateProposalRecipient(schema.db, foreignAgent.session.id, seed.orgId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a proposal whose agent proposer is no longer active', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const f = await agentSession(seed);
    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, f.proposer.id));

    await expect(
      templateProposalRecipient(schema.db, f.session.id, seed.orgId),
    ).rejects.toMatchObject({ status: 404 });
  });
});
