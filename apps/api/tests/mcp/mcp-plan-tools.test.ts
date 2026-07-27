import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';

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
  teamId: string;
  userId: string;
  actorId: string;
  hubId: string;
  ctx: McpContext;
}

/** Seed an org whose caller has a Hub, so a daily plan has somewhere to live. */
async function seedOrg(withHub = true): Promise<Seed> {
  const slug = `pl-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;

  const [role] = await db
    .insert(schema.role)
    .values({ organizationId: orgId, key: 'seeded', name: 'Seeded', capabilities: ['contribute'] })
    .returning({ id: schema.role.id });

  const email = `${slug}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });

  const [human] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'Ada',
      userId: user!.id,
      roleId: role!.id,
    })
    .returning({ id: schema.actor.id });

  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'role',
    subjectId: role!.id,
    resourceKind: 'organization',
    resourceId: orgId,
    capabilities: ['contribute'],
    effect: 'allow',
  });

  const [team] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });

  const hubId = withHub
    ? (
        await db.insert(schema.hub).values({ userId: user!.id }).returning({ id: schema.hub.id })
      )[0]!.id
    : '';

  return {
    orgId,
    teamId: team!.id,
    userId: user!.id,
    actorId: human!.id,
    hubId,
    ctx: {
      principal: { kind: 'user', userId: user!.id, userName: 'Ada', userEmail: email },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    },
  };
}

async function seedTask(s: Seed, title: string): Promise<string> {
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: s.orgId,
      title,
      teamId: s.teamId,
      state: 'backlog',
      createdBy: s.actorId,
    })
    .returning({ id: schema.task.id });
  return row!.id;
}

const harnesses: { close(): Promise<void> }[] = [];

async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_plan');
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
  while (harnesses.length > 0) await harnesses.pop()!.close();
  resetAuthMocks();
});

function payload(res: CallToolResult): Record<string, unknown> {
  return JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
}

interface Day {
  date: string;
  items: { taskId: string; title: string; status: string; sort: number; startsAt?: string }[];
  applied: number;
}

const DATE = '2026-07-26';

describe('plan_day', () => {
  it('builds a day in one call and returns it in order', async () => {
    const s = await seedOrg();
    const first = await seedTask(s, 'Review the RFC');
    const second = await seedTask(s, 'Call the vendor');

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'plan_day',
      arguments: {
        orgId: s.orgId,
        date: DATE,
        edits: [
          { action: 'add', taskId: first },
          { action: 'add', taskId: second },
        ],
      },
    })) as CallToolResult;
    const out = payload(res) as unknown as Day;
    expect(out.applied).toBe(2);
    // Order is the order they were added, which is only stable because `sort` is server-assigned.
    expect(out.items.map((item) => item.title)).toEqual(['Review the RFC', 'Call the vendor']);
    expect(out.items.map((item) => item.sort)).toEqual([1, 2]);
  });

  it('reads without changing anything when given no edits', async () => {
    const s = await seedOrg();
    const id = await seedTask(s, 'Already planned');
    await db.insert(schema.dailyPlanItem).values({
      hubId: s.hubId,
      refOrganizationId: s.orgId,
      refTaskId: id,
      date: DATE,
      sort: 1,
    });

    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'plan_day',
        arguments: { orgId: s.orgId, date: DATE },
      })) as CallToolResult,
    ) as unknown as Day;
    expect(out.applied).toBe(0);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.title).toBe('Already planned');
  });

  it('applies add, complete, and remove in the order given', async () => {
    const s = await seedOrg();
    const keep = await seedTask(s, 'Keep');
    const drop = await seedTask(s, 'Drop');

    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'plan_day',
        arguments: {
          orgId: s.orgId,
          date: DATE,
          edits: [
            { action: 'add', taskId: keep },
            { action: 'add', taskId: drop },
            { action: 'complete', taskId: keep },
            { action: 'remove', taskId: drop },
          ],
        },
      })) as CallToolResult,
    ) as unknown as Day;
    expect(out.applied).toBe(4);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ title: 'Keep', status: 'done' });
  });

  it('does not count an edit that changed nothing', async () => {
    const s = await seedOrg();
    const id = await seedTask(s, 'Twice');
    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'plan_day',
        arguments: {
          orgId: s.orgId,
          date: DATE,
          edits: [
            { action: 'add', taskId: id },
            { action: 'add', taskId: id },
          ],
        },
      })) as CallToolResult,
    ) as unknown as Day;
    expect(out.applied).toBe(1);
    expect(out.items).toHaveLength(1);
  });

  it('sets a timebox', async () => {
    const s = await seedOrg();
    const id = await seedTask(s, 'Deep work');
    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'plan_day',
        arguments: {
          orgId: s.orgId,
          date: DATE,
          edits: [
            { action: 'add', taskId: id },
            {
              action: 'timebox',
              taskId: id,
              startsAt: '2026-07-26T14:00:00.000Z',
              endsAt: '2026-07-26T16:00:00.000Z',
            },
          ],
        },
      })) as CallToolResult,
    ) as unknown as Day;
    expect(out.items[0]?.startsAt).toBe('2026-07-26T14:00:00.000Z');
  });

  it('refuses a timebox with only one end', async () => {
    const s = await seedOrg();
    const id = await seedTask(s, 'Half a box');
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'plan_day',
      arguments: {
        orgId: s.orgId,
        date: DATE,
        edits: [
          { action: 'add', taskId: id },
          { action: 'timebox', taskId: id, startsAt: '2026-07-26T14:00:00.000Z' },
        ],
      },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });

  it('will not plan a task from another organization', async () => {
    const mine = await seedOrg();
    const theirs = await seedOrg();
    const foreign = await seedTask(theirs, 'Not mine');

    const client = await connect(mine.ctx);
    const res = (await client.callTool({
      name: 'plan_day',
      arguments: {
        orgId: mine.orgId,
        date: DATE,
        edits: [{ action: 'add', taskId: foreign }],
      },
    })) as CallToolResult;
    expect(res.isError).toBe(true);

    const rows = await db
      .select()
      .from(schema.dailyPlanItem)
      .where(eq(schema.dailyPlanItem.hubId, mine.hubId));
    expect(rows).toEqual([]);
  });
});

describe('brief', () => {
  it('answers what needs the caller, for a day', async () => {
    const s = await seedOrg();
    const id = await seedTask(s, 'On the plan');
    await db.insert(schema.dailyPlanItem).values({
      hubId: s.hubId,
      refOrganizationId: s.orgId,
      refTaskId: id,
      date: DATE,
      sort: 1,
    });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'brief',
      arguments: { date: DATE },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();

    const out = payload(res) as {
      date: string;
      plan: unknown[];
      needsAttention: {
        approvals: unknown[];
        blocked: unknown[];
        dueToday: unknown[];
        inbox: number;
      };
    };
    expect(out.date).toBe(DATE);
    expect(out.plan).toHaveLength(1);
    // All four attention channels are present even when empty, so the caller never has to
    // guess whether a missing key means "none" or "not checked".
    expect(Object.keys(out.needsAttention).sort()).toEqual([
      'approvals',
      'blocked',
      'dueToday',
      'inbox',
    ]);
  });

  it('surfaces work due on the day', async () => {
    const s = await seedOrg();
    await db.insert(schema.task).values({
      organizationId: s.orgId,
      title: 'Due today',
      teamId: s.teamId,
      state: 'backlog',
      assigneeId: s.actorId,
      dueDate: new Date(`${DATE}T12:00:00.000Z`),
      createdBy: s.actorId,
    });

    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({ name: 'brief', arguments: { date: DATE } })) as CallToolResult,
    ) as { needsAttention: { dueToday: { title?: string }[] } };
    expect(out.needsAttention.dueToday.map((row) => row.title)).toContain('Due today');
  });

  it('is not something an agent principal can ask for', async () => {
    const s = await seedOrg();
    const [agentActor] = await db
      .insert(schema.actor)
      .values({ organizationId: s.orgId, kind: 'agent', displayName: 'Athena' })
      .returning({ id: schema.actor.id });
    const [agent] = await db
      .insert(schema.agent)
      .values({ organizationId: s.orgId, actorId: agentActor!.id, createdBy: s.actorId })
      .returning({ id: schema.agent.id });

    const client = await connect({
      principal: {
        kind: 'agent',
        agentId: agent!.id,
        agentActorId: agentActor!.id,
        orgId: s.orgId,
        displayName: 'Athena',
      },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    });
    // A daily plan is a person's, and an agent has no Hub — reported as absent rather than
    // forbidden, since from the agent's side it genuinely does not exist.
    const res = (await client.callTool({
      name: 'brief',
      arguments: { date: DATE },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });

  it('reports an empty day for a caller who belongs to no organization', async () => {
    const [user] = await db
      .insert(schema.user)
      .values({ name: 'Nobody', email: `nb-${Math.random().toString(36).slice(2, 10)}@e.com` })
      .returning({ id: schema.user.id });

    const client = await connect({
      principal: { kind: 'user', userId: user!.id, userName: 'Nobody', userEmail: 'nb@e.com' },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    });
    const out = payload(
      (await client.callTool({ name: 'brief', arguments: { date: DATE } })) as CallToolResult,
    ) as { plan: unknown[]; needsAttention: { inbox: number } };
    expect(out.plan).toEqual([]);
    expect(out.needsAttention.inbox).toBe(0);
  });
});

describe('comment and report_status accept names', () => {
  it('comments on a project named rather than identified', async () => {
    const s = await seedOrg();
    const [project] = await db
      .insert(schema.project)
      .values({
        organizationId: s.orgId,
        name: 'Platform Migration',
        teamId: s.teamId,
        createdBy: s.actorId,
      })
      .returning({ id: schema.project.id });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'comment',
      arguments: {
        orgId: s.orgId,
        subjectType: 'project',
        subjectId: 'Platform Migration',
        body: 'Slipping a week.',
      },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({ subjectId: project!.id });
  });

  it('sets the subject’s health as a side effect of saying why', async () => {
    const s = await seedOrg();
    const [initiative] = await db
      .insert(schema.initiative)
      .values({ organizationId: s.orgId, name: 'Q3 Platform', createdBy: s.actorId })
      .returning({ id: schema.initiative.id });

    const client = await connect(s.ctx);
    await client.callTool({
      name: 'report_status',
      arguments: {
        orgId: s.orgId,
        subjectType: 'initiative',
        subjectId: 'Q3 Platform',
        body: 'Two of three projects are behind.',
        health: 'at_risk',
      },
    });

    const [row] = await db
      .select({ health: schema.initiative.health })
      .from(schema.initiative)
      .where(
        and(
          eq(schema.initiative.id, initiative!.id),
          eq(schema.initiative.organizationId, s.orgId),
        ),
      );
    expect(row?.health).toBe('at_risk');
  });
});
