/** Automated template authoring rechecks the registered execution and its real executor. */
import type * as Db from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
import { getMigratedDb } from '../support/db';
import { seedMcpUpdateOrg, type McpUpdateSeed } from '../mcp/mcp-update-tool-fixtures';
import type { McpContext } from '../../src/mcp/auth';
import {
  isAutomatedTemplateContext,
  registerTemplateExecutor,
  registeredTemplateSessionId,
  requireAutomatedTemplateAuthor,
} from '../../src/agent/template-authority';

let schema: typeof Db;
beforeAll(async () => {
  schema = await getMigratedDb();
});

const definition = {
  name: 'Event',
  payload: { targetType: 'project', description: 'Prepare event' },
};

/** A human seed whose principal is a signed-in user. */
interface HumanSeed extends McpUpdateSeed {
  readonly userId: string;
}

async function humanSeed(): Promise<HumanSeed> {
  const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
  if (seed.ctx.principal.kind !== 'user') throw new Error('Human fixture required');
  return { ...seed, userId: seed.ctx.principal.userId };
}

/** Start a running Athena execution owned by the seeded human and bind a fresh context to it. */
async function athenaExecution(seed: HumanSeed) {
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: seed.userId,
      contextOrganizationId: seed.orgId,
      trigger: 'delegation',
      status: 'running',
    })
    .returning();
  const ctx: McpContext = { ...seed.ctx };
  registerTemplateExecutor(ctx, assertDefined(session).id);
  return { ctx, session: assertDefined(session) };
}

/** Options for a registered-agent execution. */
interface AgentExecutionOptions {
  readonly initiatorId?: string | null;
}

/** Register an agent with workspace access and bind a fresh agent context to its running session. */
async function agentExecution(seed: HumanSeed, options: AgentExecutionOptions = {}) {
  const [member] = await schema.db
    .insert(schema.actor)
    .values({ organizationId: seed.orgId, kind: 'agent', displayName: 'Event helper' })
    .returning();
  const agentActor = assertDefined(member);
  const [registration] = await schema.db
    .insert(schema.agent)
    .values({
      organizationId: seed.orgId,
      actorId: agentActor.id,
      approvalPolicy: 'autonomous',
      createdBy: seed.actorId,
    })
    .returning();
  await schema.db.insert(schema.grant).values({
    organizationId: seed.orgId,
    subjectKind: 'actor',
    subjectId: agentActor.id,
    resourceKind: 'organization',
    resourceId: seed.orgId,
    capabilities: ['view', 'contribute'],
    effect: 'allow',
  });
  const agentId = assertDefined(registration).id;
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      organizationId: seed.orgId,
      agentId,
      executorKind: 'registered_agent',
      initiatorId: options.initiatorId === undefined ? seed.actorId : options.initiatorId,
      trigger: 'delegation',
      status: 'running',
    })
    .returning();
  const ctx: McpContext = {
    principal: {
      kind: 'agent',
      agentId,
      agentActorId: agentActor.id,
      orgId: seed.orgId,
      displayName: 'Event helper',
    },
    scopes: ['work:read', 'work:write'],
  };
  registerTemplateExecutor(ctx, assertDefined(session).id);
  return { ctx, agentActor, agentId, session: assertDefined(session) };
}

describe('template executor registration', () => {
  it('treats only registered contexts and agent principals as automated', async () => {
    const seed = await humanSeed();
    const manual: McpContext = { ...seed.ctx };
    expect(isAutomatedTemplateContext(manual)).toBe(false);
    expect(() => registeredTemplateSessionId(manual)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    const { ctx, session } = await athenaExecution(seed);
    expect(isAutomatedTemplateContext(ctx)).toBe(true);
    expect(registeredTemplateSessionId(ctx)).toBe(session.id);
  });

  it('refuses a context registered without a session or bound to a missing one', async () => {
    const seed = await humanSeed();
    const author = { orgId: seed.orgId, actorId: seed.actorId };
    const unbound: McpContext = { ...seed.ctx };
    registerTemplateExecutor(unbound, null);
    await expect(
      requireAutomatedTemplateAuthor(unbound, author, { orgId: seed.orgId, ...definition }),
    ).rejects.toMatchObject({ status: 403 });
    const dangling: McpContext = { ...seed.ctx };
    registerTemplateExecutor(dangling, 'missing-session');
    await expect(
      requireAutomatedTemplateAuthor(dangling, author, { orgId: seed.orgId, ...definition }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('requireAutomatedTemplateAuthor for Athena', () => {
  it('hides a target member that is missing or is not the signed-in human', async () => {
    const seed = await humanSeed();
    const { ctx } = await athenaExecution(seed);
    const input = { orgId: seed.orgId, ...definition };
    await expect(
      requireAutomatedTemplateAuthor(ctx, { orgId: seed.orgId, actorId: 'absent' }, input),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      requireAutomatedTemplateAuthor(ctx, { orgId: seed.orgId, actorId: seed.sarahId }, input),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('requires an exact reviewed action when the owner asks before acting', async () => {
    const seed = await humanSeed();
    const { ctx } = await athenaExecution(seed);
    const author = { orgId: seed.orgId, actorId: seed.actorId };
    await expect(
      requireAutomatedTemplateAuthor(ctx, author, { orgId: seed.orgId, ...definition }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      requireAutomatedTemplateAuthor(ctx, author, { orgId: seed.orgId, name: 7 }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('requireAutomatedTemplateAuthor for registered agents', () => {
  it('refuses an agent principal bound to a session it does not execute', async () => {
    const seed = await humanSeed();
    const { ctx, agentActor } = await agentExecution(seed);
    const other = await agentExecution(seed);
    registerTemplateExecutor(ctx, other.session.id);
    await expect(
      requireAutomatedTemplateAuthor(
        ctx,
        { orgId: seed.orgId, actorId: agentActor.id },
        { orgId: seed.orgId, ...definition },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('hides an author that is not the registration behind the agent principal', async () => {
    const seed = await humanSeed();
    const { ctx } = await agentExecution(seed);
    await expect(
      requireAutomatedTemplateAuthor(
        ctx,
        { orgId: seed.orgId, actorId: seed.actorId },
        { orgId: seed.orgId, ...definition },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('drafts autonomously under the initiator’s routine autonomy', async () => {
    const seed = await humanSeed();
    await schema.db.insert(schema.hub).values({
      userId: seed.userId,
      preferences: { athena: { approvalMode: 'routine_autonomy' } },
    });
    const { ctx, agentActor } = await agentExecution(seed);
    await expect(
      requireAutomatedTemplateAuthor(
        ctx,
        { orgId: seed.orgId, actorId: agentActor.id },
        { orgId: seed.orgId, ...definition },
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['no initiator', null],
    ['an initiator without an account', 'sarah'],
    ['an initiator outside the workspace', 'foreign'],
  ] as const)('falls back to review when the session has %s', async (_label, initiator) => {
    const seed = await humanSeed();
    await schema.db.insert(schema.hub).values({
      userId: seed.userId,
      preferences: { athena: { approvalMode: 'routine_autonomy' } },
    });
    const foreign = initiator === 'foreign' ? await humanSeed() : null;
    const initiatorId = initiator === 'sarah' ? seed.sarahId : (foreign?.actorId ?? initiator);
    const { ctx, agentActor } = await agentExecution(seed, { initiatorId });
    await expect(
      requireAutomatedTemplateAuthor(
        ctx,
        { orgId: seed.orgId, actorId: agentActor.id },
        { orgId: seed.orgId, ...definition },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
