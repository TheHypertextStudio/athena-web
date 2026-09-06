import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { seedInitiative, seedStatuses, type StatusIdLookup } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});

interface Seed {
  orgId: string;
  userId: string;
  statusId: StatusIdLookup;
  ctx: McpContext;
}

/** An org whose caller can contribute org-wide, with one team to land work in. */
async function seedOrg(): Promise<Seed> {
  const slug = `pl-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  const statusId = await seedStatuses(db, schema, orgId);
  const [role] = await db
    .insert(schema.role)
    .values({ organizationId: orgId, key: 'seeded', name: 'Seeded', capabilities: ['contribute'] })
    .returning({ id: schema.role.id });
  const email = `${slug}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const userId = assertDefined(user).id;
  await db.insert(schema.actor).values({
    organizationId: orgId,
    kind: 'human',
    displayName: 'Ada',
    userId,
    roleId: assertDefined(role).id,
  });
  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'role',
    subjectId: assertDefined(role).id,
    resourceKind: 'organization',
    resourceId: orgId,
    capabilities: ['contribute'],
    effect: 'allow',
  });
  await db.insert(schema.team).values({
    organizationId: orgId,
    name: 'Core',
    key: `C${Math.random().toString(36).slice(2, 6)}`,
  });
  return {
    orgId,
    userId,
    statusId,
    ctx: {
      principal: { kind: 'user', userId, userName: 'Ada', userEmail: email },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    },
  };
}

const harnesses: { close(): Promise<void> }[] = [];

async function connect(ctx: McpContext, sessionId: string | null = 'sess_plan'): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, sessionId);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  harnesses.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return client;
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function resultText(result: CallToolResult): string {
  return result.content.map((block) => ('text' in block ? block.text : '')).join('\n');
}

/** The structured payload of a successful call; a failure fails the test with the tool's text. */
function structured(result: CallToolResult): Record<string, unknown> {
  expect(result.isError ?? false, resultText(result)).toBe(false);
  return result.structuredContent ?? {};
}

type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];

function toolMeta(tools: readonly ListedTool[], name: string): Record<string, unknown> {
  return tools.find((tool) => tool.name === name)?._meta ?? {};
}

function toolAnnotations(
  tools: readonly ListedTool[],
  name: string,
): { readOnlyHint?: boolean | undefined } {
  return tools.find((tool) => tool.name === name)?.annotations ?? {};
}

interface StartOut {
  planId: string;
  href: string;
  revision: number;
  document: { nodes: { ref: string; status: string; objectId: string | null }[] };
  templates: { id: string; targetType: string }[];
}

interface DraftOut {
  revision: number;
  added: string[];
  changed: string[];
  removed: string[];
  counts: { projects: number; tasks: number; draft: number };
}

interface CommitOut {
  status: string;
  revision: number;
  placed: { ref: string; created: boolean }[];
  created: number;
  matched: number;
  changeSetId: string | null;
}

async function start(client: Client, args: Record<string, unknown>): Promise<StartOut> {
  return structured(await call(client, 'plan_start', args)) as unknown as StartOut;
}

const SEED_OPS = [
  { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { title: 'Spring' } } },
  {
    op: 'upsert_node',
    node: { ref: 'p1', kind: 'project', parentRef: 'init', fields: { title: 'Outreach' } },
  },
  {
    op: 'upsert_node',
    node: { ref: 't1', kind: 'task', parentRef: 'p1', fields: { title: 'Segment donors' } },
  },
];

describe('plan tools', () => {
  it('declare the private-draft metadata on start and draft, read-only on read, and neither on commit', async () => {
    const { ctx } = await seedOrg();
    const client = await connect(ctx);
    const { tools } = await client.listTools();
    expect(toolMeta(tools, 'plan_start')['docket/approval']).toBe('private_draft');
    expect(toolMeta(tools, 'plan_draft')['docket/approval']).toBe('private_draft');
    expect(toolAnnotations(tools, 'plan_read').readOnlyHint).toBe(true);
    expect(toolMeta(tools, 'plan_read')['docket/approval']).toBeUndefined();
    expect(toolMeta(tools, 'plan_commit')['docket/approval']).toBeUndefined();
    expect(toolAnnotations(tools, 'plan_commit').readOnlyHint).toBe(false);
  });

  it('plan_start creates a plan, links the session, and returns the canvas link and templates', async () => {
    const { ctx, orgId, userId } = await seedOrg();
    const [session] = await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: userId,
        contextOrganizationId: orgId,
        kind: 'chat',
        trigger: 'delegation',
        status: 'pending',
      })
      .returning({ id: schema.agentSession.id });
    const sessionId = assertDefined(session).id;
    const client = await connect(ctx, sessionId);
    const out = await start(client, { orgId, title: 'Spring' });
    expect(out.href).toBe(`/orgs/${orgId}/plans/${out.planId}`);
    expect(out.revision).toBe(0);
    expect(out.templates.length).toBeGreaterThan(0);
    expect(out.templates.some((template) => template.targetType === 'initiative')).toBe(true);
    const [row] = await db
      .select({ sessionId: schema.planDraft.sessionId })
      .from(schema.planDraft)
      .where(eq(schema.planDraft.id, out.planId));
    expect(row?.sessionId).toBe(sessionId);
  });

  it('plan_start reopens the active plan rooted on an initiative, resolving it by name', async () => {
    const { ctx, orgId, statusId } = await seedOrg();
    const root = await seedInitiative(db, schema, statusId, {
      organizationId: orgId,
      name: 'Brand refresh',
    });
    const client = await connect(ctx);
    const first = await start(client, { orgId, initiative: 'Brand refresh' });
    expect(first.document.nodes[0]).toMatchObject({
      ref: 'root',
      status: 'confirmed',
      objectId: root.id,
    });
    const second = await start(client, { orgId, initiative: root.id });
    expect(second.planId).toBe(first.planId);
  });

  it('plan_draft applies a batch, reports what changed, and refuses a stale revision', async () => {
    const { ctx, orgId } = await seedOrg();
    const client = await connect(ctx);
    const { planId } = await start(client, { orgId });
    const drafted = structured(
      await call(client, 'plan_draft', { planId, revision: 0, ops: SEED_OPS }),
    ) as unknown as DraftOut;
    expect(drafted.revision).toBe(1);
    expect(drafted.added.sort()).toEqual(['init', 'p1', 't1']);
    expect(drafted.counts).toEqual({ projects: 1, tasks: 1, draft: 3 });
    const again = structured(
      await call(client, 'plan_draft', {
        planId,
        revision: 1,
        ops: [
          { op: 'set_fields', ref: 'p1', fields: { summary: 'Reach lapsed donors' } },
          { op: 'remove_node', ref: 't1' },
        ],
      }),
    ) as unknown as DraftOut;
    expect(again).toMatchObject({ added: [], changed: ['p1'], removed: ['t1'] });
    const stale = await call(client, 'plan_draft', {
      planId,
      revision: 0,
      ops: [{ op: 'set_title', title: 'Late' }],
    });
    expect(stale.isError).toBe(true);
    const read = structured(await call(client, 'plan_read', { planId }));
    expect(read['revision']).toBe(2);
  });

  it('plan_draft names the failing op in its error', async () => {
    const { ctx, orgId } = await seedOrg();
    const client = await connect(ctx);
    const { planId } = await start(client, { orgId });
    const result = await call(client, 'plan_draft', {
      planId,
      revision: 0,
      ops: [{ op: 'set_fields', ref: 'nope', fields: { summary: 'x' } }],
    });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('ops.0.ref');
  });

  it('plan_commit creates the refs and their draft ancestors and reports the placements', async () => {
    const { ctx, orgId } = await seedOrg();
    const client = await connect(ctx);
    const { planId } = await start(client, { orgId });
    await call(client, 'plan_draft', { planId, revision: 0, ops: SEED_OPS });
    const committed = structured(
      await call(client, 'plan_commit', { planId, refs: ['t1'] }),
    ) as unknown as CommitOut;
    expect(committed.placed.map((item) => item.ref)).toEqual(['init', 'p1', 't1']);
    expect(committed.created).toBe(3);
    expect(committed.matched).toBe(0);
    expect(committed.status).toBe('committed');
    expect(committed.revision).toBe(2);
    expect(committed.changeSetId).not.toBeNull();
    const tasks = await db
      .select({ title: schema.task.title })
      .from(schema.task)
      .where(eq(schema.task.organizationId, orgId));
    expect(tasks.map((task) => task.title)).toEqual(['Segment donors']);
  });

  it('hides another user’s plan from every plan tool', async () => {
    const owner = await seedOrg();
    const other = await seedOrg();
    const ownerClient = await connect(owner.ctx);
    const { planId } = await start(ownerClient, { orgId: owner.orgId });
    const otherClient = await connect(other.ctx);
    const attempts: readonly [string, Record<string, unknown>][] = [
      ['plan_read', { planId }],
      ['plan_draft', { planId, revision: 0, ops: SEED_OPS }],
      ['plan_commit', { planId, refs: ['init'] }],
    ];
    for (const [name, args] of attempts) {
      const result = await call(otherClient, name, args);
      expect(result.isError, name).toBe(true);
    }
  });

  it('tells a registered agent the plan does not exist', async () => {
    const { orgId } = await seedOrg();
    const agentCtx: McpContext = {
      principal: {
        kind: 'agent',
        agentId: 'agent_1',
        agentActorId: 'actor_agent',
        orgId,
        displayName: 'Bot',
      },
      scopes: ['work:read', 'work:write', 'agents:run'],
    };
    const client = await connect(agentCtx);
    const result = await call(client, 'plan_start', { orgId });
    expect(result.isError).toBe(true);
  });
});
