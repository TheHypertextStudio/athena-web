import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Stub Better Auth so we never pull the heavy ESM chain; identity is injected via ctx.
vi.mock('@docket/auth', () => ({ auth: { api: { getSession: vi.fn(async () => null) } } }));

import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/types';

import type { McpContext } from '../../src/mcp/auth';
import { createMcpCatalog } from '../../src/mcp/catalog';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import type { registerResources as RegisterResources } from '../../src/mcp/resources';
import type { registerPrompts as RegisterPrompts } from '../../src/mcp/prompts';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
let registerResources!: typeof RegisterResources;
let registerPrompts!: typeof RegisterPrompts;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  registerResources = (await import('../../src/mcp/resources')).registerResources;
  registerPrompts = (await import('../../src/mcp/prompts')).registerPrompts;
});

interface Seed {
  userId: string;
  orgId: string;
  teamId: string;
  actorId: string;
  agentActorId: string;
  taskId: string;
  task2Id: string;
  projectId: string;
  programId: string;
  initiativeId: string;
  agentId: string;
  integrationId: string;
  cycleId: string;
  ctx: McpContext;
}

/** Seed a self-contained org whose human actor holds `capabilities` org-wide. */
async function seedOrg(capabilities: readonly Capability[]): Promise<Seed> {
  const slug = `ms-${Math.random().toString(36).slice(2, 10)}`;
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
  await db.insert(schema.hub).values({ userId });

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
  const [tk2] = await db
    .insert(schema.task)
    .values({ organizationId: orgId, title: 'Ship 2', teamId, state: 'todo', createdBy: actorId })
    .returning({ id: schema.task.id });
  const task2Id = tk2!.id;

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
  const agentActorId = agentActor!.id;
  const [ag] = await db
    .insert(schema.agent)
    .values({
      organizationId: orgId,
      actorId: agentActorId,
      createdBy: actorId,
      connection: { protocol: 'mcp', endpoint: 'https://agent.example/mcp' },
    })
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

  const [cy] = await db
    .insert(schema.cycle)
    .values({
      organizationId: orgId,
      teamId,
      number: 1,
      name: 'C1',
      startsAt: new Date('2026-01-01'),
      endsAt: new Date('2026-01-14'),
    })
    .returning({ id: schema.cycle.id });
  const cycleId = cy!.id;

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
    agentActorId,
    taskId,
    task2Id,
    projectId,
    programId,
    initiativeId,
    agentId,
    integrationId,
    cycleId,
    ctx,
  };
}

const harnesses: { close(): Promise<void> }[] = [];

/** Connect a fresh identity-bound MCP server (tools + resources + prompts) + client. */
async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
        completions: {},
      },
    },
  );
  const catalog = createMcpCatalog(server, { pageSize: 3 });
  registerTools(catalog, ctx);
  registerResources(catalog, ctx);
  registerPrompts(catalog, ctx);
  catalog.installListHandlers(ctx);
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
});

/** Parse the JSON text payload of a tool result. */
function payload(res: CallToolResult): Record<string, unknown> {
  return JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
}

/** Parse the JSON text of the first content block of a resource read. */
function readJson(contents: readonly unknown[]): Record<string, unknown> {
  const first = contents[0] as { text: string };
  return JSON.parse(first.text) as Record<string, unknown>;
}

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const PagedViewPayload = z.looseObject({
  items: z.array(z.looseObject({ id: z.string() })),
  nextCursor: z.string().optional(),
});

const PagedSearchPayload = z.looseObject({
  results: z.array(z.looseObject({ id: z.string() })),
  nextCursor: z.string().optional(),
});

async function collectToolNames(client: Client): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    names.push(...page.tools.map((tool) => tool.name));
    cursor = page.nextCursor;
  } while (cursor);
  return names;
}

async function collectResourceUris(client: Client): Promise<string[]> {
  const uris: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listResources(cursor ? { cursor } : undefined);
    uris.push(...page.resources.map((resource) => resource.uri));
    cursor = page.nextCursor;
  } while (cursor);
  return uris;
}

async function collectResourceTemplateUris(client: Client): Promise<string[]> {
  const uris: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listResourceTemplates(cursor ? { cursor } : undefined);
    uris.push(...page.resourceTemplates.map((template) => template.uriTemplate));
    cursor = page.nextCursor;
  } while (cursor);
  return uris;
}

async function collectPromptNames(client: Client): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listPrompts(cursor ? { cursor } : undefined);
    names.push(...page.prompts.map((prompt) => prompt.name));
    cursor = page.nextCursor;
  } while (cursor);
  return names;
}

describe('set_task_delegate tool', () => {
  it('sets a delegate (assign), clears it (null), validates the agent, 404s', async () => {
    const s = await seedOrg(['assign']);
    const client = await connect(s.ctx);
    const set = (await client.callTool({
      name: 'set_task_delegate',
      arguments: { orgId: s.orgId, taskId: s.taskId, delegateId: s.agentActorId },
    })) as CallToolResult;
    expect(payload(set)['delegateId']).toBe(s.agentActorId);

    const cleared = (await client.callTool({
      name: 'set_task_delegate',
      arguments: { orgId: s.orgId, taskId: s.taskId, delegateId: null },
    })) as CallToolResult;
    expect(payload(cleared)['delegateId']).toBeNull();

    const badAgent = (await client.callTool({
      name: 'set_task_delegate',
      arguments: { orgId: s.orgId, taskId: s.taskId, delegateId: MISSING },
    })) as CallToolResult;
    expect(badAgent.isError).toBe(true);

    const missing = (await client.callTool({
      name: 'set_task_delegate',
      arguments: { orgId: s.orgId, taskId: MISSING, delegateId: null },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
  });

  it('is denied for a contribute-only actor (assign required)', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'set_task_delegate',
      arguments: { orgId: s.orgId, taskId: s.taskId, delegateId: null },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('forbidden');
  });
});

describe('set_task_state tool', () => {
  it('transitions to a valid state and rejects an unknown one', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const ok = (await client.callTool({
      name: 'set_task_state',
      arguments: { orgId: s.orgId, taskId: s.taskId, state: 'done' },
    })) as CallToolResult;
    expect(payload(ok)['state']).toBe('done');
    // The terminal `done` state stamped completedAt.
    const rows = await db.select().from(schema.task).where(eq(schema.task.id, s.taskId)).limit(1);
    expect(rows[0]?.completedAt).not.toBeNull();

    const bad = (await client.callTool({
      name: 'set_task_state',
      arguments: { orgId: s.orgId, taskId: s.taskId, state: 'nope' },
    })) as CallToolResult;
    expect(bad.isError).toBe(true);
  });
});

describe('add_subtask tool', () => {
  it('creates a subtask inheriting the parent team + 404s a missing parent', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'add_subtask',
      arguments: { orgId: s.orgId, parentTaskId: s.taskId, title: 'Sub' },
    })) as CallToolResult;
    expect(payload(res)['parentTaskId']).toBe(s.taskId);

    const bad = (await client.callTool({
      name: 'add_subtask',
      arguments: { orgId: s.orgId, parentTaskId: MISSING, title: 'x' },
    })) as CallToolResult;
    expect(bad.isError).toBe(true);
  });
});

describe('add_task_dependency / remove_task_dependency tools', () => {
  it('adds, is idempotent, rejects self + cycles, then removes', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);

    const added = (await client.callTool({
      name: 'add_task_dependency',
      arguments: { orgId: s.orgId, blockingTaskId: s.taskId, blockedTaskId: s.task2Id },
    })) as CallToolResult;
    expect(payload(added)['alreadyLinked']).toBe(false);

    const again = (await client.callTool({
      name: 'add_task_dependency',
      arguments: { orgId: s.orgId, blockingTaskId: s.taskId, blockedTaskId: s.task2Id },
    })) as CallToolResult;
    expect(payload(again)['alreadyLinked']).toBe(true);

    const selfLoop = (await client.callTool({
      name: 'add_task_dependency',
      arguments: { orgId: s.orgId, blockingTaskId: s.taskId, blockedTaskId: s.taskId },
    })) as CallToolResult;
    expect(selfLoop.isError).toBe(true);

    // Reverse edge would close a cycle.
    const cycleEdge = (await client.callTool({
      name: 'add_task_dependency',
      arguments: { orgId: s.orgId, blockingTaskId: s.task2Id, blockedTaskId: s.taskId },
    })) as CallToolResult;
    expect(cycleEdge.isError).toBe(true);

    const missing = (await client.callTool({
      name: 'add_task_dependency',
      arguments: { orgId: s.orgId, blockingTaskId: s.taskId, blockedTaskId: MISSING },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);

    const removed = (await client.callTool({
      name: 'remove_task_dependency',
      arguments: { orgId: s.orgId, blockingTaskId: s.taskId, blockedTaskId: s.task2Id },
    })) as CallToolResult;
    expect(payload(removed)['removed']).toBe(true);

    const removeMissing = (await client.callTool({
      name: 'remove_task_dependency',
      arguments: { orgId: s.orgId, blockingTaskId: s.taskId, blockedTaskId: s.task2Id },
    })) as CallToolResult;
    expect(removeMissing.isError).toBe(true);
  });
});

describe('update_project tool', () => {
  it('patches fields, no-ops empty patch, validates refs, 404s', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const patched = (await client.callTool({
      name: 'update_project',
      arguments: {
        orgId: s.orgId,
        projectId: s.projectId,
        name: 'Renamed',
        description: 'd',
        status: 'active',
        leadId: s.actorId,
        programId: s.programId,
        startDate: '2026-01-01',
        targetDate: '2026-02-01',
      },
    })) as CallToolResult;
    expect(payload(patched)['name']).toBe('Renamed');

    const empty = (await client.callTool({
      name: 'update_project',
      arguments: { orgId: s.orgId, projectId: s.projectId },
    })) as CallToolResult;
    expect(empty.isError).toBeFalsy();

    const badLead = (await client.callTool({
      name: 'update_project',
      arguments: { orgId: s.orgId, projectId: s.projectId, leadId: MISSING },
    })) as CallToolResult;
    expect(badLead.isError).toBe(true);

    const emptyMissing = (await client.callTool({
      name: 'update_project',
      arguments: { orgId: s.orgId, projectId: MISSING },
    })) as CallToolResult;
    expect(emptyMissing.isError).toBe(true);

    const patchMissing = (await client.callTool({
      name: 'update_project',
      arguments: { orgId: s.orgId, projectId: MISSING, name: 'x' },
    })) as CallToolResult;
    expect(patchMissing.isError).toBe(true);
  });
});

describe('create_program tool', () => {
  it('requires manage and validates the owner', async () => {
    const manager = await seedOrg(['manage']);
    const client = await connect(manager.ctx);
    const ok = (await client.callTool({
      name: 'create_program',
      arguments: { orgId: manager.orgId, name: 'P', description: 'd', ownerId: manager.actorId },
    })) as CallToolResult;
    expect(ok.isError).toBeFalsy();
    expect(payload(ok)['name']).toBe('P');

    const badOwner = (await client.callTool({
      name: 'create_program',
      arguments: { orgId: manager.orgId, name: 'P2', ownerId: MISSING },
    })) as CallToolResult;
    expect(badOwner.isError).toBe(true);

    const contributor = await seedOrg(['contribute']);
    const c2 = await connect(contributor.ctx);
    const denied = (await c2.callTool({
      name: 'create_program',
      arguments: { orgId: contributor.orgId, name: 'Nope' },
    })) as CallToolResult;
    expect(denied.isError).toBe(true);
    expect((denied.content[0] as { text: string }).text).toContain('forbidden');
  });
});

describe('create_initiative tool', () => {
  it('creates with and without an owner/date', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const full = (await client.callTool({
      name: 'create_initiative',
      arguments: {
        orgId: s.orgId,
        name: 'Theme',
        description: 'd',
        ownerId: s.actorId,
        targetDate: '2026-06-01',
      },
    })) as CallToolResult;
    expect(payload(full)['name']).toBe('Theme');

    const bare = (await client.callTool({
      name: 'create_initiative',
      arguments: { orgId: s.orgId, name: 'Bare' },
    })) as CallToolResult;
    expect(bare.isError).toBeFalsy();

    const badOwner = (await client.callTool({
      name: 'create_initiative',
      arguments: { orgId: s.orgId, name: 'X', ownerId: MISSING },
    })) as CallToolResult;
    expect(badOwner.isError).toBe(true);
  });
});

describe('link_initiative tool', () => {
  it('links/unlinks a project and a program, is idempotent, validates targets', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);

    const linkProj = (await client.callTool({
      name: 'link_initiative',
      arguments: {
        orgId: s.orgId,
        initiativeId: s.initiativeId,
        targetType: 'project',
        targetId: s.projectId,
      },
    })) as CallToolResult;
    expect(payload(linkProj)['linked']).toBe(true);

    // Idempotent re-link.
    const relink = (await client.callTool({
      name: 'link_initiative',
      arguments: {
        orgId: s.orgId,
        initiativeId: s.initiativeId,
        targetType: 'project',
        targetId: s.projectId,
      },
    })) as CallToolResult;
    expect(payload(relink)['linked']).toBe(true);

    const unlinkProj = (await client.callTool({
      name: 'link_initiative',
      arguments: {
        orgId: s.orgId,
        initiativeId: s.initiativeId,
        targetType: 'project',
        targetId: s.projectId,
        action: 'unlink',
      },
    })) as CallToolResult;
    expect(payload(unlinkProj)['linked']).toBe(false);

    const linkProg = (await client.callTool({
      name: 'link_initiative',
      arguments: {
        orgId: s.orgId,
        initiativeId: s.initiativeId,
        targetType: 'program',
        targetId: s.programId,
      },
    })) as CallToolResult;
    expect(payload(linkProg)['linked']).toBe(true);

    const unlinkProg = (await client.callTool({
      name: 'link_initiative',
      arguments: {
        orgId: s.orgId,
        initiativeId: s.initiativeId,
        targetType: 'program',
        targetId: s.programId,
        action: 'unlink',
      },
    })) as CallToolResult;
    expect(payload(unlinkProg)['linked']).toBe(false);

    const badInit = (await client.callTool({
      name: 'link_initiative',
      arguments: {
        orgId: s.orgId,
        initiativeId: MISSING,
        targetType: 'project',
        targetId: s.projectId,
      },
    })) as CallToolResult;
    expect(badInit.isError).toBe(true);

    const badTargetProj = (await client.callTool({
      name: 'link_initiative',
      arguments: {
        orgId: s.orgId,
        initiativeId: s.initiativeId,
        targetType: 'project',
        targetId: MISSING,
      },
    })) as CallToolResult;
    expect(badTargetProj.isError).toBe(true);

    const badTargetProg = (await client.callTool({
      name: 'link_initiative',
      arguments: {
        orgId: s.orgId,
        initiativeId: s.initiativeId,
        targetType: 'program',
        targetId: MISSING,
      },
    })) as CallToolResult;
    expect(badTargetProg.isError).toBe(true);
  });
});

describe('add_comment tool', () => {
  it('comments, threads a reply, rejects cross-subject/2-level/parent-404', async () => {
    const s = await seedOrg(['comment']);
    const client = await connect(s.ctx);
    const root = (await client.callTool({
      name: 'add_comment',
      arguments: { orgId: s.orgId, subjectType: 'task', subjectId: s.taskId, body: 'hi' },
    })) as CallToolResult;
    const rootId = payload(root)['id'] as string;

    const reply = (await client.callTool({
      name: 'add_comment',
      arguments: {
        orgId: s.orgId,
        subjectType: 'task',
        subjectId: s.taskId,
        body: 're',
        parentCommentId: rootId,
      },
    })) as CallToolResult;
    const replyId = payload(reply)['id'] as string;
    expect(reply.isError).toBeFalsy();

    // Reply to a reply → rejected.
    const deep = (await client.callTool({
      name: 'add_comment',
      arguments: {
        orgId: s.orgId,
        subjectType: 'task',
        subjectId: s.taskId,
        body: 'x',
        parentCommentId: replyId,
      },
    })) as CallToolResult;
    expect(deep.isError).toBe(true);

    // Parent on a different subject → rejected.
    const crossSubject = (await client.callTool({
      name: 'add_comment',
      arguments: {
        orgId: s.orgId,
        subjectType: 'project',
        subjectId: s.projectId,
        body: 'x',
        parentCommentId: rootId,
      },
    })) as CallToolResult;
    expect(crossSubject.isError).toBe(true);

    const badParent = (await client.callTool({
      name: 'add_comment',
      arguments: {
        orgId: s.orgId,
        subjectType: 'task',
        subjectId: s.taskId,
        body: 'x',
        parentCommentId: MISSING,
      },
    })) as CallToolResult;
    expect(badParent.isError).toBe(true);
  });
});

describe('respond_to_session / cancel_session tools', () => {
  it('replies to an elicitation, resuming the session, and 409s a non-elicitation', async () => {
    const s = await seedOrg(['contribute']);
    const [sess] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: s.orgId,
        agentId: s.agentId,
        taskId: s.taskId,
        trigger: 'delegation',
        status: 'awaiting_input',
        initiatorId: s.actorId,
      })
      .returning({ id: schema.agentSession.id });
    const [elicit] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: sess!.id,
        organizationId: s.orgId,
        type: 'elicitation',
        body: { text: 'q?' },
      })
      .returning({ id: schema.sessionActivity.id });
    const [thought] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: sess!.id,
        organizationId: s.orgId,
        type: 'thought',
        body: { text: 't' },
      })
      .returning({ id: schema.sessionActivity.id });

    const client = await connect(s.ctx);
    const ok = (await client.callTool({
      name: 'respond_to_session',
      arguments: { orgId: s.orgId, sessionId: sess!.id, activityId: elicit!.id, body: 'an answer' },
    })) as CallToolResult;
    expect(payload(ok)['status']).toBe('running');

    const notElicit = (await client.callTool({
      name: 'respond_to_session',
      arguments: { orgId: s.orgId, sessionId: sess!.id, activityId: thought!.id, body: 'x' },
    })) as CallToolResult;
    expect(notElicit.isError).toBe(true);

    const missingSession = (await client.callTool({
      name: 'respond_to_session',
      arguments: { orgId: s.orgId, sessionId: MISSING, activityId: elicit!.id, body: 'x' },
    })) as CallToolResult;
    expect(missingSession.isError).toBe(true);

    const missingActivity = (await client.callTool({
      name: 'respond_to_session',
      arguments: { orgId: s.orgId, sessionId: sess!.id, activityId: MISSING, body: 'x' },
    })) as CallToolResult;
    expect(missingActivity.isError).toBe(true);
  });

  it('cancels a non-terminal session and 409s a terminal one', async () => {
    const s = await seedOrg(['contribute']);
    const [sess] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: s.orgId,
        agentId: s.agentId,
        taskId: s.taskId,
        trigger: 'delegation',
        status: 'running',
        initiatorId: s.actorId,
      })
      .returning({ id: schema.agentSession.id });
    const client = await connect(s.ctx);
    const ok = (await client.callTool({
      name: 'cancel_session',
      arguments: { orgId: s.orgId, sessionId: sess!.id },
    })) as CallToolResult;
    expect(payload(ok)['status']).toBe('canceled');

    // Already terminal → 409.
    const again = (await client.callTool({
      name: 'cancel_session',
      arguments: { orgId: s.orgId, sessionId: sess!.id },
    })) as CallToolResult;
    expect(again.isError).toBe(true);

    const missing = (await client.callTool({
      name: 'cancel_session',
      arguments: { orgId: s.orgId, sessionId: MISSING },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
  });
});

describe('run_view / search tools', () => {
  it('runs each entity view for a viewer and hides from a non-member (not-found, not forbidden)', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);
    for (const entity of ['task', 'project', 'program', 'initiative'] as const) {
      const res = (await client.callTool({
        name: 'run_view',
        arguments: { orgId: s.orgId, entity },
      })) as CallToolResult;
      expect(res.isError).toBeFalsy();
      expect(payload(res)['entity']).toBe(entity);
    }

    // A caller with NO grant (below view) gets the existence-hiding not-found, not forbidden.
    const noGrant = await seedOrg([]);
    const c2 = await connect(noGrant.ctx);
    const hidden = (await c2.callTool({
      name: 'run_view',
      arguments: { orgId: noGrant.orgId, entity: 'task' },
    })) as CallToolResult;
    expect(hidden.isError).toBe(true);
    expect((hidden.content[0] as { text: string }).text).toContain('not_found');
  });

  it('searches fused titles across tasks/projects/programs', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'search',
      arguments: { orgId: s.orgId, query: 'Ship' },
    })) as CallToolResult;
    const results = payload(res)['results'] as { type: string }[];
    expect(results.some((r) => r.type === 'task')).toBe(true);
  });

  it('paginates run_view and search results with opaque cursors', async () => {
    const s = await seedOrg(['view']);
    await db.insert(schema.task).values([
      {
        organizationId: s.orgId,
        title: 'Ship 3',
        teamId: s.teamId,
        state: 'todo',
        createdBy: s.actorId,
      },
      {
        organizationId: s.orgId,
        title: 'Ship 4',
        teamId: s.teamId,
        state: 'todo',
        createdBy: s.actorId,
      },
      {
        organizationId: s.orgId,
        title: 'Ship 5',
        teamId: s.teamId,
        state: 'todo',
        createdBy: s.actorId,
      },
    ]);
    const client = await connect(s.ctx);

    const firstView = (await client.callTool({
      name: 'run_view',
      arguments: { orgId: s.orgId, entity: 'task', limit: 2 },
    })) as CallToolResult;
    const firstPayload = PagedViewPayload.parse(payload(firstView));
    expect(firstPayload.items.length).toBe(2);
    expect(firstPayload.nextCursor).toEqual(expect.any(String));

    const secondView = (await client.callTool({
      name: 'run_view',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        limit: 2,
        cursor: firstPayload.nextCursor,
      },
    })) as CallToolResult;
    const secondPayload = PagedViewPayload.parse(payload(secondView));
    expect(secondPayload.items.length).toBe(2);
    const firstIds = firstPayload.items.map((item) => item.id);
    const secondIds = secondPayload.items.map((item) => item.id);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);

    const firstSearch = (await client.callTool({
      name: 'search',
      arguments: { orgId: s.orgId, query: 'Ship', limit: 2 },
    })) as CallToolResult;
    const searchPayload = PagedSearchPayload.parse(payload(firstSearch));
    expect(searchPayload.results.length).toBe(2);
    expect(searchPayload.nextCursor).toEqual(expect.any(String));
  });
});

describe('MCP list pagination', () => {
  it('paginates tools, resources, templates, and prompts without duplicates', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);

    const firstTools = await client.listTools();
    expect(firstTools.tools).toHaveLength(3);
    expect(firstTools.nextCursor).toEqual(expect.any(String));

    const toolNames = await collectToolNames(client);
    expect(toolNames).toEqual([...new Set(toolNames)]);
    expect(toolNames).toEqual(expect.arrayContaining(['run_view', 'search', 'create_task']));

    const resourceUris = await collectResourceUris(client);
    expect(resourceUris).toEqual([...new Set(resourceUris)]);
    expect(resourceUris).toEqual(
      expect.arrayContaining(['docket://orgs', 'docket://hub/today', 'docket://hub/inbox']),
    );

    const templateUris = await collectResourceTemplateUris(client);
    expect(templateUris).toEqual(['docket://{org}/{type}/{id}']);

    const promptNames = await collectPromptNames(client);
    expect(promptNames).toEqual([...new Set(promptNames)]);
    expect(promptNames).toEqual(expect.arrayContaining(['docket_system', 'task_brief', 'standup']));
  });

  it('rejects invalid list cursors as invalid params', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);

    await expect(client.listTools({ cursor: 'not-a-valid-cursor' })).rejects.toThrow(
      /Invalid cursor/,
    );
  });
});

describe('add_to_daily_plan tool', () => {
  it('adds a task, is idempotent, and 404s a missing task', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);
    const added = (await client.callTool({
      name: 'add_to_daily_plan',
      arguments: { orgId: s.orgId, taskId: s.taskId, date: '2026-06-07' },
    })) as CallToolResult;
    expect(payload(added)['created']).toBe(true);

    const again = (await client.callTool({
      name: 'add_to_daily_plan',
      arguments: { orgId: s.orgId, taskId: s.taskId, date: '2026-06-07' },
    })) as CallToolResult;
    expect(payload(again)['created']).toBe(false);

    const missing = (await client.callTool({
      name: 'add_to_daily_plan',
      arguments: { orgId: s.orgId, taskId: MISSING, date: '2026-06-07' },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
  });
});

describe('hydrated resources', () => {
  it('reads hydrated DTOs for every type', async () => {
    const s = await seedOrg(['view', 'contribute']);
    // Wire up related data so the hydration fields are exercised.
    await db.insert(schema.taskDependency).values({
      organizationId: s.orgId,
      blockingTaskId: s.taskId,
      blockedTaskId: s.task2Id,
    });
    await db.insert(schema.task).values({
      organizationId: s.orgId,
      title: 'Sub',
      teamId: s.teamId,
      state: 'todo',
      parentTaskId: s.taskId,
      createdBy: s.actorId,
    });
    await db.insert(schema.milestone).values({
      organizationId: s.orgId,
      projectId: s.projectId,
      name: 'M1',
      createdBy: s.actorId,
    });
    await db.insert(schema.initiativeProject).values({
      organizationId: s.orgId,
      initiativeId: s.initiativeId,
      projectId: s.projectId,
    });
    await db.insert(schema.initiativeProgram).values({
      organizationId: s.orgId,
      initiativeId: s.initiativeId,
      programId: s.programId,
    });
    await db.update(schema.task).set({ cycleId: s.cycleId }).where(eq(schema.task.id, s.taskId));
    const [upd] = await db
      .insert(schema.update)
      .values({
        organizationId: s.orgId,
        authorId: s.actorId,
        subjectType: 'project',
        subjectId: s.projectId,
        health: 'on_track',
        body: 'all good',
        createdBy: s.actorId,
      })
      .returning({ id: schema.update.id });
    const [cmt] = await db
      .insert(schema.comment)
      .values({
        organizationId: s.orgId,
        authorId: s.actorId,
        subjectType: 'task',
        subjectId: s.taskId,
        body: 'note',
        createdBy: s.actorId,
      })
      .returning({ id: schema.comment.id });
    const [sess] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: s.orgId,
        agentId: s.agentId,
        taskId: s.taskId,
        trigger: 'delegation',
        status: 'running',
        initiatorId: s.actorId,
      })
      .returning({ id: schema.agentSession.id });
    await db.insert(schema.sessionActivity).values({
      sessionId: sess!.id,
      organizationId: s.orgId,
      type: 'thought',
      body: { text: 'thinking' },
    });
    const [view] = await db
      .insert(schema.savedView)
      .values({ organizationId: s.orgId, name: 'My view', createdBy: s.actorId })
      .returning({ id: schema.savedView.id });

    const client = await connect(s.ctx);
    const cases: [string, string][] = [
      ['task', s.taskId],
      ['project', s.projectId],
      ['program', s.programId],
      ['initiative', s.initiativeId],
      ['cycle', s.cycleId],
      ['team', s.teamId],
      ['update', upd!.id],
      ['comment', cmt!.id],
      ['session', sess!.id],
      ['agent', s.agentId],
      ['view', view!.id],
      ['org', s.orgId],
    ];
    for (const [type, id] of cases) {
      const res = await client.readResource({ uri: `docket://${s.orgId}/${type}/${id}` });
      const dto = readJson(res.contents);
      expect(dto['id']).toBe(id === s.orgId && type === 'org' ? s.orgId : id);
    }

    // The hydrated task carries dependencies + subtasks.
    const taskRes = await client.readResource({ uri: `docket://${s.orgId}/task/${s.taskId}` });
    const taskDto = readJson(taskRes.contents);
    expect((taskDto['blocking'] as unknown[]).length).toBe(1);
    expect((taskDto['subtasks'] as unknown[]).length).toBe(1);

    // The hydrated project carries milestones + linked initiatives + latest update.
    const projRes = await client.readResource({
      uri: `docket://${s.orgId}/project/${s.projectId}`,
    });
    const projDto = readJson(projRes.contents);
    expect((projDto['milestones'] as unknown[]).length).toBe(1);
    expect((projDto['initiatives'] as unknown[]).length).toBe(1);
    expect((projDto['latestUpdate'] as { health: string }).health).toBe('on_track');

    // The hydrated agent never surfaces credentials, only protocol/endpoint.
    const agentRes = await client.readResource({ uri: `docket://${s.orgId}/agent/${s.agentId}` });
    const agentDto = readJson(agentRes.contents);
    expect((agentDto['connection'] as { protocol: string }).protocol).toBe('mcp');
  });

  it('reads an agent with no connection (null branch) + a program with no projects', async () => {
    const s = await seedOrg(['view']);
    const [bareAgentActor] = await db
      .insert(schema.actor)
      .values({ organizationId: s.orgId, kind: 'agent', displayName: 'Bare' })
      .returning({ id: schema.actor.id });
    const [bareAgent] = await db
      .insert(schema.agent)
      .values({ organizationId: s.orgId, actorId: bareAgentActor!.id, createdBy: s.actorId })
      .returning({ id: schema.agent.id });
    const client = await connect(s.ctx);

    const agentRes = await client.readResource({
      uri: `docket://${s.orgId}/agent/${bareAgent!.id}`,
    });
    expect(readJson(agentRes.contents)['connection']).toBeNull();

    const progRes = await client.readResource({
      uri: `docket://${s.orgId}/program/${s.programId}`,
    });
    const progDto = readJson(progRes.contents);
    expect((progDto['rollup'] as { projects: number }).projects).toBe(0);

    // A project with no latest update returns null.
    const projRes = await client.readResource({
      uri: `docket://${s.orgId}/project/${s.projectId}`,
    });
    expect(readJson(projRes.contents)['latestUpdate']).toBeNull();
  });

  it('404s missing entities of each new type and an unknown type', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);
    for (const type of [
      'cycle',
      'team',
      'update',
      'comment',
      'session',
      'agent',
      'view',
    ] as const) {
      await expect(
        client.readResource({ uri: `docket://${s.orgId}/${type}/${MISSING}` }),
      ).rejects.toThrow(/not_found|Not found/i);
    }
    await expect(
      client.readResource({ uri: `docket://${s.orgId}/widget/${MISSING}` }),
    ).rejects.toThrow(/not_found|Not found/i);
  });
});

describe('hub resources', () => {
  it('reads today, inbox, and portfolio for a member', async () => {
    const s = await seedOrg(['view']);
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
    const client = await connect(s.ctx);

    const today = readJson((await client.readResource({ uri: 'docket://hub/today' })).contents);
    expect(Array.isArray(today['tasks'])).toBe(true);

    const inbox = readJson((await client.readResource({ uri: 'docket://hub/inbox' })).contents);
    expect(
      (inbox['approvals'] as { sessionId: string }[]).some((a) => a.sessionId === sess!.id),
    ).toBe(true);

    const portfolio = readJson(
      (await client.readResource({ uri: 'docket://hub/portfolio' })).contents,
    );
    expect((portfolio['programs'] as { id: string }[]).some((p) => p.id === s.programId)).toBe(
      true,
    );
    expect((portfolio['projects'] as { id: string }[]).some((p) => p.id === s.projectId)).toBe(
      true,
    );
  });

  it('returns empty hub surfaces for a user with no memberships', async () => {
    const ctx: McpContext = {
      userId: MISSING,
      userName: null,
      userEmail: 'ghost@e.com',
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    };
    const client = await connect(ctx);
    expect(
      readJson((await client.readResource({ uri: 'docket://hub/today' })).contents)['tasks'],
    ).toEqual([]);
    expect(
      readJson((await client.readResource({ uri: 'docket://hub/inbox' })).contents)['approvals'],
    ).toEqual([]);
    const portfolio = readJson(
      (await client.readResource({ uri: 'docket://hub/portfolio' })).contents,
    );
    expect(portfolio['programs']).toEqual([]);
    expect(portfolio['projects']).toEqual([]);
  });
});

describe('resource template completion', () => {
  it('completes {org} by id/slug prefix and {id} by org-scoped task prefix', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);

    const orgComp = await client.complete({
      ref: { type: 'ref/resource', uri: 'docket://{org}/{type}/{id}' },
      argument: { name: 'org', value: s.orgId.slice(0, 6) },
    });
    expect(orgComp.completion.values).toContain(s.orgId);

    const idComp = await client.complete({
      ref: { type: 'ref/resource', uri: 'docket://{org}/{type}/{id}' },
      argument: { name: 'id', value: s.taskId.slice(0, 6) },
      context: { arguments: { org: s.orgId } },
    });
    expect(idComp.completion.values).toContain(s.taskId);

    // No `org` arg → empty id completion.
    const idNoOrg = await client.complete({
      ref: { type: 'ref/resource', uri: 'docket://{org}/{type}/{id}' },
      argument: { name: 'id', value: s.taskId.slice(0, 6) },
    });
    expect(idNoOrg.completion.values).toEqual([]);
  });

  it('returns no id completions for a non-member org', async () => {
    const s = await seedOrg(['view']);
    const other = await seedOrg(['view']);
    const client = await connect(s.ctx);
    const idComp = await client.complete({
      ref: { type: 'ref/resource', uri: 'docket://{org}/{type}/{id}' },
      argument: { name: 'id', value: other.taskId.slice(0, 6) },
      context: { arguments: { org: other.orgId } },
    });
    expect(idComp.completion.values).toEqual([]);
  });
});

describe('prompts', () => {
  it('lists and gets the docket system, task brief, and standup prompts', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);

    const listed = await client.listPrompts();
    const names = listed.prompts.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['docket_system', 'task_brief', 'standup']));

    const system = await client.getPrompt({ name: 'docket_system' });
    const sysText = (system.messages[0]!.content as { text: string }).text;
    expect(sysText).toContain('Docket');
    expect(sysText).toContain('Ada'); // personalized with the caller's name

    const brief = await client.getPrompt({
      name: 'task_brief',
      arguments: { org: s.orgId, task_id: s.taskId, goal: 'finish it' },
    });
    expect((brief.messages[0]!.content as { text: string }).text).toContain(s.taskId);

    const briefNoGoal = await client.getPrompt({
      name: 'task_brief',
      arguments: { org: s.orgId, task_id: s.taskId },
    });
    expect((briefNoGoal.messages[0]!.content as { text: string }).text).toContain(
      'next workflow state',
    );

    const standup = await client.getPrompt({ name: 'standup', arguments: { org: s.orgId } });
    expect((standup.messages[0]!.content as { text: string }).text).toContain(s.orgId);
  });

  it('omits the caller name in the system prompt when unset', async () => {
    const s = await seedOrg(['view']);
    const ctx: McpContext = { ...s.ctx, userName: null };
    const client = await connect(ctx);
    const system = await client.getPrompt({ name: 'docket_system' });
    const sysText = (system.messages[0]!.content as { text: string }).text;
    expect(sysText).toContain('Docket');
    expect(sysText).not.toContain('on behalf of');
  });
});

describe('trigger_agent with a prompt argument', () => {
  it('accepts the optional prompt and persists the session', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'trigger_agent',
      arguments: { orgId: s.orgId, agentId: s.agentId, taskId: s.taskId, prompt: 'do the thing' },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    const sessions = await db
      .select()
      .from(schema.agentSession)
      .where(
        and(
          eq(schema.agentSession.organizationId, s.orgId),
          eq(schema.agentSession.id, payload(res)['id'] as string),
        ),
      );
    expect(sessions[0]?.status).toBe('pending');
  });

  it('threads the prompt through as the session’s opening response activity', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    // Task-less trigger: the prompt is the only brief available to the run.
    const res = (await client.callTool({
      name: 'trigger_agent',
      arguments: { orgId: s.orgId, agentId: s.agentId, prompt: 'plan outreach strategy' },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    const sessionId = payload(res)['id'] as string;

    const activities = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, sessionId));
    expect(activities).toHaveLength(1);
    expect(activities[0]?.type).toBe('response');
    expect(activities[0]?.body).toMatchObject({ text: 'plan outreach strategy' });
  });

  it('persists no prompt activity when none is supplied', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'trigger_agent',
      arguments: { orgId: s.orgId, agentId: s.agentId, taskId: s.taskId },
    })) as CallToolResult;
    const sessionId = payload(res)['id'] as string;
    const activities = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, sessionId));
    expect(activities).toHaveLength(0);
  });
});
