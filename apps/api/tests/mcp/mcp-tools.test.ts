import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Stub Better Auth so we control the session per test without the heavy ESM chain.
const getSession = vi.fn<
  () => Promise<{ user: { id: string; name: string; email: string } } | null>
>(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/types';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import type { registerResources as RegisterResources } from '../../src/mcp/resources';
import type { mcpHandler as McpHandler } from '../../src/mcp/server';
import { getMigratedDb } from '../support/db';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
let registerResources!: typeof RegisterResources;
let mcpHandler!: typeof McpHandler;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  registerResources = (await import('../../src/mcp/resources')).registerResources;
  mcpHandler = (await import('../../src/mcp/server')).mcpHandler;
});

interface Seed {
  userId: string;
  orgId: string;
  teamId: string;
  actorId: string;
  taskId: string;
  projectId: string;
  programId: string;
  initiativeId: string;
  agentId: string;
  integrationId: string;
  ctx: McpContext;
}

/** Seed an org whose human actor effectively holds `capabilities` org-wide (role + grant). */
async function seedOrg(capabilities: readonly Capability[]): Promise<Seed> {
  const slug = `mt-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;

  const [r] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'seeded',
      name: 'Seeded',
      capabilities: [...capabilities],
    })
    .returning({ id: schema.role.id });
  const roleId = r!.id;

  const email = `${slug}@e.com`;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const userId = u!.id;

  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId, roleId })
    .returning({ id: schema.actor.id });
  const actorId = human!.id;

  if (capabilities.length > 0) {
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: roleId,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: [...capabilities],
      effect: 'allow',
    });
  }

  const [t] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });
  const teamId = t!.id;

  const [tk] = await db
    .insert(schema.task)
    .values({ organizationId: orgId, title: 'Ship', teamId, state: 'todo', createdBy: actorId })
    .returning({ id: schema.task.id });
  const taskId = tk!.id;

  const [proj] = await db
    .insert(schema.project)
    .values({ organizationId: orgId, name: 'Proj', teamId, createdBy: actorId })
    .returning({ id: schema.project.id });
  const projectId = proj!.id;

  const [prog] = await db
    .insert(schema.program)
    .values({ organizationId: orgId, name: 'Prog', createdBy: actorId })
    .returning({ id: schema.program.id });
  const programId = prog!.id;

  const [init] = await db
    .insert(schema.initiative)
    .values({ organizationId: orgId, name: 'Init', createdBy: actorId })
    .returning({ id: schema.initiative.id });
  const initiativeId = init!.id;

  const [agentActor] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
    .returning({ id: schema.actor.id });
  const [ag] = await db
    .insert(schema.agent)
    .values({ organizationId: orgId, actorId: agentActor!.id, createdBy: actorId })
    .returning({ id: schema.agent.id });
  const agentId = ag!.id;

  const [intg] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'github',
      pattern: 'connector',
      roles: ['work'],
      createdBy: actorId,
    })
    .returning({ id: schema.integration.id });
  const integrationId = intg!.id;

  const ctx: McpContext = {
    userId,
    userName: 'Ada',
    userEmail: email,
    scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
  };
  return {
    userId,
    orgId,
    teamId,
    actorId,
    taskId,
    projectId,
    programId,
    initiativeId,
    agentId,
    integrationId,
    ctx,
  };
}

const harnesses: { close(): Promise<void> }[] = [];

/** Connect a fresh identity-bound MCP server + client over the in-memory transport. */
async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx);
  registerResources(server, ctx);
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
  getSession.mockReset();
});

/** Parse the JSON text payload of a tool result into a keyed record. */
function payload(res: CallToolResult): Record<string, unknown> {
  return JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
}

describe('create_task tool', () => {
  it('creates with all optional fields set (priority/assignee/project/date/state)', async () => {
    const s = await seedOrg(['contribute', 'assign']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'create_task',
      arguments: {
        orgId: s.orgId,
        teamId: s.teamId,
        title: 'Full',
        description: 'd',
        state: 'in_progress',
        priority: 'high',
        assigneeId: s.actorId,
        projectId: s.projectId,
        dueDate: '2026-09-01',
      },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(payload(res)['state']).toBe('in_progress');
  });

  it('defaults the state from the team workflow + 404 on missing team', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const ok = (await client.callTool({
      name: 'create_task',
      arguments: { orgId: s.orgId, teamId: s.teamId, title: 'Default' },
    })) as CallToolResult;
    expect(ok.isError).toBeFalsy();
    const bad = (await client.callTool({
      name: 'create_task',
      arguments: { orgId: s.orgId, teamId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', title: 'x' },
    })) as CallToolResult;
    expect(bad.isError).toBe(true);
    expect((bad.content[0] as { text: string }).text).toContain('not_found');
  });

  it('falls back to backlog when the team has no workflow states', async () => {
    const s = await seedOrg(['contribute']);
    const [t] = await db
      .insert(schema.team)
      .values({
        organizationId: s.orgId,
        name: 'E',
        key: `E${Math.random().toString(36).slice(2, 6)}`,
        workflowStates: [],
      })
      .returning({ id: schema.team.id });
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'create_task',
      arguments: { orgId: s.orgId, teamId: t!.id, title: 'Bk' },
    })) as CallToolResult;
    expect(payload(res)['state']).toBe('backlog');
  });
});

describe('update_task tool', () => {
  it('updates all fields + 404 on missing task', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update_task',
      arguments: {
        orgId: s.orgId,
        taskId: s.taskId,
        title: 'New',
        description: 'd',
        state: 'done',
        priority: 'low',
        dueDate: '2026-10-01',
      },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    // Minimal update (covers the undefined branches).
    const min = (await client.callTool({
      name: 'update_task',
      arguments: { orgId: s.orgId, taskId: s.taskId, title: 'Only' },
    })) as CallToolResult;
    expect(min.isError).toBeFalsy();
    const bad = (await client.callTool({
      name: 'update_task',
      arguments: { orgId: s.orgId, taskId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', title: 'x' },
    })) as CallToolResult;
    expect(bad.isError).toBe(true);
  });

  it('updates without a title (covers the title-absent branch)', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update_task',
      arguments: { orgId: s.orgId, taskId: s.taskId, priority: 'urgent' },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
  });
});

describe('move_task tool', () => {
  it('moves team + project, validates both, 404s, and clears project with null', async () => {
    const s = await seedOrg(['contribute']);
    const [t2] = await db
      .insert(schema.team)
      .values({
        organizationId: s.orgId,
        name: 'T2',
        key: `T${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id });
    const client = await connect(s.ctx);

    const moved = (await client.callTool({
      name: 'move_task',
      arguments: { orgId: s.orgId, taskId: s.taskId, teamId: t2!.id, projectId: s.projectId },
    })) as CallToolResult;
    expect(moved.isError).toBeFalsy();

    // Clear project with null + no team change.
    const cleared = (await client.callTool({
      name: 'move_task',
      arguments: { orgId: s.orgId, taskId: s.taskId, projectId: null },
    })) as CallToolResult;
    expect(cleared.isError).toBeFalsy();

    // Bad team.
    const badTeam = (await client.callTool({
      name: 'move_task',
      arguments: { orgId: s.orgId, taskId: s.taskId, teamId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    })) as CallToolResult;
    expect(badTeam.isError).toBe(true);
    // Bad project.
    const badProj = (await client.callTool({
      name: 'move_task',
      arguments: { orgId: s.orgId, taskId: s.taskId, projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    })) as CallToolResult;
    expect(badProj.isError).toBe(true);
    // Missing task (no team/project changes provided → set is non-empty? both undefined → empty set; use a team to reach the update).
    const missing = (await client.callTool({
      name: 'move_task',
      arguments: { orgId: s.orgId, taskId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', teamId: t2!.id },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
  });
});

describe('assign_task tool', () => {
  it('assigns, unassigns (null), validates assignee, 404s', async () => {
    const s = await seedOrg(['assign']);
    const client = await connect(s.ctx);
    const assigned = (await client.callTool({
      name: 'assign_task',
      arguments: { orgId: s.orgId, taskId: s.taskId, assigneeId: s.actorId },
    })) as CallToolResult;
    expect(assigned.isError).toBeFalsy();
    const unassigned = (await client.callTool({
      name: 'assign_task',
      arguments: { orgId: s.orgId, taskId: s.taskId, assigneeId: null },
    })) as CallToolResult;
    expect(unassigned.isError).toBeFalsy();
    const badAssignee = (await client.callTool({
      name: 'assign_task',
      arguments: { orgId: s.orgId, taskId: s.taskId, assigneeId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    })) as CallToolResult;
    expect(badAssignee.isError).toBe(true);
    const missing = (await client.callTool({
      name: 'assign_task',
      arguments: { orgId: s.orgId, taskId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', assigneeId: null },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
  });
});

describe('create_project tool', () => {
  it('creates with and without dates', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const full = (await client.callTool({
      name: 'create_project',
      arguments: {
        orgId: s.orgId,
        name: 'P',
        description: 'd',
        leadId: s.actorId,
        teamId: s.teamId,
        startDate: '2026-01-01',
        targetDate: '2026-02-01',
      },
    })) as CallToolResult;
    expect(full.isError).toBeFalsy();
    const bare = (await client.callTool({
      name: 'create_project',
      arguments: { orgId: s.orgId, name: 'P2' },
    })) as CallToolResult;
    expect(bare.isError).toBeFalsy();
  });
});

describe('post_update tool', () => {
  it('posts with health (sets subject health) and without health', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const withHealth = (await client.callTool({
      name: 'post_update',
      arguments: {
        orgId: s.orgId,
        subjectType: 'project',
        subjectId: s.projectId,
        body: 'u',
        health: 'at_risk',
      },
    })) as CallToolResult;
    expect(withHealth.isError).toBeFalsy();
    const rows = await db
      .select({ h: schema.project.health })
      .from(schema.project)
      .where(eq(schema.project.id, s.projectId))
      .limit(1);
    expect(rows[0]?.h).toBe('at_risk');
    const noHealth = (await client.callTool({
      name: 'post_update',
      arguments: {
        orgId: s.orgId,
        subjectType: 'initiative',
        subjectId: s.initiativeId,
        body: 'u2',
      },
    })) as CallToolResult;
    expect(noHealth.isError).toBeFalsy();
  });
});

describe('link_external tool', () => {
  it('links, is idempotent, and 404s on missing integration/team', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const first = (await client.callTool({
      name: 'link_external',
      arguments: {
        orgId: s.orgId,
        integrationId: s.integrationId,
        teamId: s.teamId,
        title: 'Issue',
        externalId: 'ext#1',
        description: 'd',
        externalUrl: 'http://x',
      },
    })) as CallToolResult;
    expect(payload(first)['alreadyLinked']).toBe(false);
    const second = (await client.callTool({
      name: 'link_external',
      arguments: {
        orgId: s.orgId,
        integrationId: s.integrationId,
        teamId: s.teamId,
        title: 'Issue',
        externalId: 'ext#1',
      },
    })) as CallToolResult;
    expect(payload(second)['alreadyLinked']).toBe(true);
    const badIntg = (await client.callTool({
      name: 'link_external',
      arguments: {
        orgId: s.orgId,
        integrationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        teamId: s.teamId,
        title: 'X',
        externalId: 'e2',
      },
    })) as CallToolResult;
    expect(badIntg.isError).toBe(true);
    const badTeam = (await client.callTool({
      name: 'link_external',
      arguments: {
        orgId: s.orgId,
        integrationId: s.integrationId,
        teamId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        title: 'X',
        externalId: 'e3',
      },
    })) as CallToolResult;
    expect(badTeam.isError).toBe(true);
  });

  it('links without description/externalUrl and onto a stateless team (covers the null + backlog branches)', async () => {
    const s = await seedOrg(['contribute']);
    const [t] = await db
      .insert(schema.team)
      .values({
        organizationId: s.orgId,
        name: 'NS',
        key: `N${Math.random().toString(36).slice(2, 6)}`,
        workflowStates: [],
      })
      .returning({ id: schema.team.id });
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'link_external',
      arguments: {
        orgId: s.orgId,
        integrationId: s.integrationId,
        teamId: t!.id,
        title: 'Bare',
        externalId: 'bare#1',
      },
    })) as CallToolResult;
    expect(payload(res)['alreadyLinked']).toBe(false);
    const rows = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.externalId, 'bare#1'))
      .limit(1);
    expect(rows[0]?.state).toBe('backlog');
    expect(rows[0]?.description).toBeNull();
    expect(rows[0]?.externalUrl).toBeNull();
  });
});

describe('trigger_agent tool', () => {
  it('triggers with and without a task, validates agent + task, custom trigger', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const withTask = (await client.callTool({
      name: 'trigger_agent',
      arguments: { orgId: s.orgId, agentId: s.agentId, taskId: s.taskId, trigger: 'mention' },
    })) as CallToolResult;
    expect(withTask.isError).toBeFalsy();
    const noTask = (await client.callTool({
      name: 'trigger_agent',
      arguments: { orgId: s.orgId, agentId: s.agentId },
    })) as CallToolResult;
    expect(noTask.isError).toBeFalsy();
    const badAgent = (await client.callTool({
      name: 'trigger_agent',
      arguments: { orgId: s.orgId, agentId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    })) as CallToolResult;
    expect(badAgent.isError).toBe(true);
    const badTask = (await client.callTool({
      name: 'trigger_agent',
      arguments: { orgId: s.orgId, agentId: s.agentId, taskId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    })) as CallToolResult;
    expect(badTask.isError).toBe(true);
  });
});

describe('approve_action / reject_action tools', () => {
  /** Seed an awaiting-approval session with a proposed action; returns its id. */
  async function seedAwaiting(s: Seed): Promise<string> {
    const [sess] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: s.orgId,
        agentId: s.agentId,
        taskId: s.taskId,
        trigger: 'delegation',
        status: 'awaiting_approval',
        initiatorId: s.actorId,
      })
      .returning({ id: schema.agentSession.id });
    await db.insert(schema.sessionActivity).values({
      sessionId: sess!.id,
      organizationId: s.orgId,
      type: 'action',
      body: { action: { kind: 'update_task', summary: 'x' } },
      approvalStatus: 'proposed',
    });
    return sess!.id;
  }

  it('approve resolves to running', async () => {
    // Approving a gated agent action is an `assign`-level act (permissions §9.3), the
    // same bar the agent-sessions RPC approve route enforces.
    const s = await seedOrg(['assign']);
    const id = await seedAwaiting(s);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'approve_action',
      arguments: { orgId: s.orgId, sessionId: id },
    })) as CallToolResult;
    expect(payload(res)['status']).toBe('running');
  });

  it('reject resolves to canceled', async () => {
    const s = await seedOrg(['assign']);
    const id = await seedAwaiting(s);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'reject_action',
      arguments: { orgId: s.orgId, sessionId: id },
    })) as CallToolResult;
    expect(payload(res)['status']).toBe('canceled');
  });

  it('approve 404s on missing session, 409s when not awaiting / no proposed action', async () => {
    const s = await seedOrg(['assign']);
    const client = await connect(s.ctx);
    const missing = (await client.callTool({
      name: 'approve_action',
      arguments: { orgId: s.orgId, sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);

    // Pending session → not awaiting → 409.
    const [pending] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: s.orgId,
        agentId: s.agentId,
        taskId: s.taskId,
        trigger: 'delegation',
        status: 'pending',
        initiatorId: s.actorId,
      })
      .returning({ id: schema.agentSession.id });
    const notAwaiting = (await client.callTool({
      name: 'approve_action',
      arguments: { orgId: s.orgId, sessionId: pending!.id },
    })) as CallToolResult;
    expect(notAwaiting.isError).toBe(true);

    // Awaiting but no proposed action → 409.
    const [bare] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: s.orgId,
        agentId: s.agentId,
        taskId: s.taskId,
        trigger: 'delegation',
        status: 'awaiting_approval',
        initiatorId: s.actorId,
      })
      .returning({ id: schema.agentSession.id });
    const noAction = (await client.callTool({
      name: 'approve_action',
      arguments: { orgId: s.orgId, sessionId: bare!.id },
    })) as CallToolResult;
    expect(noAction.isError).toBe(true);
  });
});

describe('resources', () => {
  it('docket://orgs lists the caller memberships', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);
    const res = await client.readResource({ uri: 'docket://orgs' });
    const items = JSON.parse((res.contents[0] as { text: string }).text) as { id: string }[];
    expect(items.some((o) => o.id === s.orgId)).toBe(true);
  });

  it('reads every entity type for a viewer', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);
    for (const [type, id] of [
      ['task', s.taskId],
      ['project', s.projectId],
      ['program', s.programId],
      ['initiative', s.initiativeId],
      ['org', s.orgId],
    ] as const) {
      const res = await client.readResource({
        uri: `docket://${s.orgId}/${type}/${id}`,
      });
      expect(res.contents).toHaveLength(1);
    }
  });

  it('404s an unknown type, a missing entity, and a wrong org id for org', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);
    await expect(client.readResource({ uri: `docket://${s.orgId}/widget/abc` })).rejects.toThrow(
      /not_found|Not found/i,
    );
    await expect(
      client.readResource({ uri: `docket://${s.orgId}/task/01ARZ3NDEKTSV4RRFFQ69G5FAV` }),
    ).rejects.toThrow(/not_found|Not found/i);
    // For the org type, requesting an id that isn't the org id → 404.
    await expect(
      client.readResource({ uri: `docket://${s.orgId}/org/01ARZ3NDEKTSV4RRFFQ69G5FAV` }),
    ).rejects.toThrow(/not_found|Not found/i);
  });
});

describe('mcpHandler success path (authenticated)', () => {
  it('processes an initialize request through a fresh transport', async () => {
    const s = await seedOrg(['view']);
    getSession.mockResolvedValueOnce({
      user: { id: s.userId, name: 'Ada', email: 'a@e.com' },
    });
    const app = new Hono();
    app.on(['POST', 'GET'], '/mcp', mcpHandler);
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'c', version: '0.0.0' },
        },
      }),
    });
    expect(res.status).toBe(200);
  });

  it('returns a 500 problem when a non-ApiError escapes auth resolution', async () => {
    getSession.mockRejectedValueOnce(new Error('boom'));
    const app = new Hono();
    app.on(['POST', 'GET'], '/mcp', mcpHandler);
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(500);
    const prob = (await res.json()) as { code: string };
    expect(prob.code).toBe('internal');
  });
});
