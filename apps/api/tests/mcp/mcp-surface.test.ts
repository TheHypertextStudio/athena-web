import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/types';

import type { McpContext } from '../../src/mcp/auth';
import { createMcpCatalog, registerOptionalTaskTool } from '../../src/mcp/catalog';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import type { registerResources as RegisterResources } from '../../src/mcp/resources';
import type { registerPrompts as RegisterPrompts } from '../../src/mcp/prompts';
import '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { seedStatuses, type StatusIdLookup } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
let registerResources!: typeof RegisterResources;
let registerPrompts!: typeof RegisterPrompts;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
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
  statusId: StatusIdLookup;
  ctx: McpContext;
}

/** Seed a self-contained org whose human actor holds `capabilities` org-wide. */
async function seedOrg(capabilities: readonly Capability[]): Promise<Seed> {
  const slug = `ms-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  const statusId = await seedStatuses(db, schema, orgId);

  const [r] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'seeded',
      name: 'Seeded',
      capabilities: [...capabilities],
    })
    .returning({ id: schema.role.id });
  const roleId = assertDefined(r).id;

  const email = `${slug}@e.com`;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const userId = assertDefined(u).id;
  await db.insert(schema.hub).values({ userId });

  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId, roleId })
    .returning({ id: schema.actor.id });
  const actorId = assertDefined(human).id;

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
  const teamId = assertDefined(t).id;

  const [tk] = await db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      title: 'Ship',
      teamId,
      state: 'todo',
      statusId: statusId('task', 'todo'),
      createdBy: actorId,
    })
    .returning({ id: schema.task.id });
  const taskId = assertDefined(tk).id;
  const [tk2] = await db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      title: 'Ship 2',
      teamId,
      state: 'todo',
      statusId: statusId('task', 'todo'),
      createdBy: actorId,
    })
    .returning({ id: schema.task.id });
  const task2Id = assertDefined(tk2).id;

  const [proj] = await db
    .insert(schema.project)
    .values({
      organizationId: orgId,
      name: 'Proj',
      teamId,
      createdBy: actorId,
      status: 'planned',
      statusId: statusId('project', 'planned'),
    })
    .returning({ id: schema.project.id });
  const projectId = assertDefined(proj).id;

  const [prog] = await db
    .insert(schema.program)
    .values({
      organizationId: orgId,
      name: 'Prog',
      createdBy: actorId,
      status: 'active',
      statusId: statusId('program', 'active'),
    })
    .returning({ id: schema.program.id });
  const programId = assertDefined(prog).id;

  const [init] = await db
    .insert(schema.initiative)
    .values({
      organizationId: orgId,
      name: 'Init',
      createdBy: actorId,
      status: 'active',
      statusId: statusId('initiative', 'active'),
    })
    .returning({ id: schema.initiative.id });
  const initiativeId = assertDefined(init).id;

  const [agentActor] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
    .returning({ id: schema.actor.id });
  const agentActorId = assertDefined(agentActor).id;
  const [ag] = await db
    .insert(schema.agent)
    .values({
      organizationId: orgId,
      actorId: agentActorId,
      createdBy: actorId,
      connection: { protocol: 'mcp', endpoint: 'https://agent.example/mcp' },
    })
    .returning({ id: schema.agent.id });
  const agentId = assertDefined(ag).id;

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
  const integrationId = assertDefined(intg).id;

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
  const cycleId = assertDefined(cy).id;

  const ctx: McpContext = {
    principal: { kind: 'user', userId, userName: 'Ada', userEmail: email },
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
    statusId,
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
        tools: {},
        resources: {},
        prompts: {},
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

/** Connect a server that advertises task-augmented tool execution. */
async function connectWithTasks(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        completions: {},
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
      },
      taskStore: new InMemoryTaskStore(),
    },
  );
  const catalog = createMcpCatalog(server, { pageSize: 3, tasksEnabled: true });
  registerTools(catalog, ctx);
  registerResources(catalog, ctx);
  registerPrompts(catalog, ctx);
  catalog.installListHandlers(ctx);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' }, { capabilities: { tasks: {} } });
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
  while (harnesses.length > 0) await assertDefined(harnesses.pop()).close();
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

const PagedFindPayload = z.looseObject({
  items: z.array(z.looseObject({ id: z.string(), kind: z.string(), title: z.string() })),
  nextCursor: z.string().optional(),
});

/**
 * Index a task into the search projection `find` reads from.
 *
 * @remarks
 * Indexing is an async outbox in production, so tests write the projection row directly — the
 * same approach `tests/search/query.test.ts` takes. `visibility` is the field under test: a
 * `grantable` task is only reachable through the grant cascade, and a `user_private` one only by
 * its owner.
 */
async function indexTask(input: {
  orgId: string;
  taskId: string;
  title: string;
  visibility: Record<string, unknown>;
  userId?: string;
}): Promise<void> {
  await db.insert(schema.searchDocument).values({
    id: `task:${input.orgId}:${input.taskId}`,
    organizationId: input.orgId,
    ...(input.userId ? { userId: input.userId } : {}),
    kind: 'task',
    family: 'work',
    sourceTable: 'task',
    entityId: input.taskId,
    title: input.title,
    facet: {},
    route: {
      type: 'entity',
      organizationId: input.orgId,
      entityKind: 'task',
      entityId: input.taskId,
      href: `/orgs/${input.orgId}/tasks/${input.taskId}`,
    },
    visibility: input.visibility,
    baseRank: 100,
  });
}

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

describe('MCP tool metadata and task execution', () => {
  it('advertises standard metadata, output schemas, and task support without Docket confirmation meta', async () => {
    const s = await seedOrg(['view', 'contribute', 'assign', 'manage']);
    const client = await connectWithTasks(s.ctx);
    const tools = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);

    const capture = tools.find((tool) => tool.name === 'capture');
    const listWork = tools.find((tool) => tool.name === 'list_work');
    const runAgent = tools.find((tool) => tool.name === 'run_agent');

    expect(capture?.outputSchema?.type).toBe('object');
    expect(capture?.execution?.taskSupport).toBe('forbidden');
    expect(listWork?.execution?.taskSupport).toBe('optional');
    expect(runAgent?.execution?.taskSupport).toBe('optional');
    // Every tool declares an output schema — three of twenty-six did before this surface was
    // rebuilt, while `structuredContent` was emitted for all of them regardless.
    for (const tool of tools) expect(tool.outputSchema?.type).toBe('object');
    for (const tool of tools) {
      expect(tool._meta ?? {}).not.toHaveProperty('docket');
    }
  });

  it('returns structured content alongside JSON text for tools with output schemas', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connectWithTasks(s.ctx);
    const res = (await client.callTool({
      name: 'capture',
      arguments: { orgId: s.orgId, text: 'Structured task' },
    })) as CallToolResult;

    expect(res.structuredContent).toMatchObject({ state: 'backlog' });
    expect(payload(res)['state']).toBe('backlog');
  });

  it('runs optional task-capable tools through MCP Tasks when requested', async () => {
    const s = await seedOrg(['view']);
    const client = await connectWithTasks(s.ctx);
    const created = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'list_work',
          arguments: { orgId: s.orgId, entity: 'task', limit: 5 },
          task: { ttl: 60_000 },
        },
      },
      z.object({
        task: z.object({
          taskId: z.string(),
          status: z.string(),
        }),
      }),
    );

    const listed = await client.experimental.tasks.listTasks();
    expect(listed.tasks.some((task) => task.taskId === created.task.taskId)).toBe(true);

    const result = await client.experimental.tasks.getTaskResult(
      created.task.taskId,
      CallToolResultSchema,
    );
    expect(result.structuredContent).toMatchObject({ entity: 'task' });
    expect(payload(result)['entity']).toBe('task');
  });

  it('cancels a working task through tasks/cancel', async () => {
    const taskStore = new InMemoryTaskStore();
    const server = new McpServer(
      { name: 'test', version: '0.0.0' },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          completions: {},
          tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
        },
        taskStore,
      },
    );
    const catalog = createMcpCatalog(server, { tasksEnabled: true });
    registerOptionalTaskTool(
      catalog,
      'hold_open',
      {
        title: 'Hold open',
        inputSchema: {},
        outputSchema: { ok: z.boolean() },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        execution: { taskSupport: 'optional' },
      },
      {
        createTask: async (_input, extra) => ({
          task: await extra.taskStore.createTask({ ttl: 60_000 }),
        }),
        getTask: (_input, extra) => extra.taskStore.getTask(extra.taskId),
        getTaskResult: async (_input, extra) =>
          (await extra.taskStore.getTaskResult(extra.taskId)) as CallToolResult,
      },
      () => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }, null, 2) }],
        structuredContent: { ok: true },
      }),
    );
    catalog.installListHandlers({
      principal: {
        kind: 'user',
        userId: 'task-owner',
        userName: 'Ada',
        userEmail: 'ada@example.com',
      },
      scopes: ['work:read'],
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' }, { capabilities: { tasks: {} } });
    await Promise.all([server.connect(st), client.connect(ct)]);
    harnesses.push({
      close: async () => {
        await client.close();
        await server.close();
      },
    });

    const created = await client.request(
      {
        method: 'tools/call',
        params: { name: 'hold_open', arguments: {}, task: { ttl: 60_000 } },
      },
      z.object({ task: z.object({ taskId: z.string(), status: z.literal('working') }) }),
    );
    const cancelled = await client.experimental.tasks.cancelTask(created.task.taskId);

    expect(cancelled.status).toBe('cancelled');
    await expect(
      client.experimental.tasks.getTaskResult(created.task.taskId, CallToolResultSchema),
    ).rejects.toThrow(/has no result|cancelled|no result/i);
  });
});

describe('comment tool', () => {
  it('comments, threads a reply, rejects cross-subject/2-level/parent-404', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const root = (await client.callTool({
      name: 'comment',
      arguments: { orgId: s.orgId, subjectType: 'task', subjectId: s.taskId, body: 'hi' },
    })) as CallToolResult;
    const rootId = payload(root)['id'] as string;

    const reply = (await client.callTool({
      name: 'comment',
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
      name: 'comment',
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
      name: 'comment',
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
      name: 'comment',
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

describe('manage_session respond / cancel', () => {
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
        sessionId: assertDefined(sess).id,
        organizationId: s.orgId,
        type: 'elicitation',
        body: { text: 'q?' },
      })
      .returning({ id: schema.sessionActivity.id });
    const [thought] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: assertDefined(sess).id,
        organizationId: s.orgId,
        type: 'thought',
        body: { text: 't' },
      })
      .returning({ id: schema.sessionActivity.id });

    const client = await connect(s.ctx);
    const ok = (await client.callTool({
      name: 'manage_session',
      arguments: {
        orgId: s.orgId,
        sessionId: assertDefined(sess).id,
        action: 'respond',
        activityId: assertDefined(elicit).id,
        body: 'an answer',
      },
    })) as CallToolResult;
    expect(payload(ok)['status']).toBe('running');

    const notElicit = (await client.callTool({
      name: 'manage_session',
      arguments: {
        orgId: s.orgId,
        sessionId: assertDefined(sess).id,
        action: 'respond',
        activityId: assertDefined(thought).id,
        body: 'x',
      },
    })) as CallToolResult;
    expect(notElicit.isError).toBe(true);

    const missingSession = (await client.callTool({
      name: 'manage_session',
      arguments: {
        orgId: s.orgId,
        sessionId: MISSING,
        action: 'respond',
        activityId: assertDefined(elicit).id,
        body: 'x',
      },
    })) as CallToolResult;
    expect(missingSession.isError).toBe(true);

    const missingActivity = (await client.callTool({
      name: 'manage_session',
      arguments: {
        orgId: s.orgId,
        sessionId: assertDefined(sess).id,
        action: 'respond',
        activityId: MISSING,
        body: 'x',
      },
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
      name: 'manage_session',
      arguments: { orgId: s.orgId, sessionId: assertDefined(sess).id, action: 'cancel' },
    })) as CallToolResult;
    expect(payload(ok)['status']).toBe('canceled');

    // Already terminal → 409.
    const again = (await client.callTool({
      name: 'manage_session',
      arguments: { orgId: s.orgId, sessionId: assertDefined(sess).id, action: 'cancel' },
    })) as CallToolResult;
    expect(again.isError).toBe(true);

    const missing = (await client.callTool({
      name: 'manage_session',
      arguments: { orgId: s.orgId, sessionId: MISSING, action: 'cancel' },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
  });
});

describe('list_work / find tools', () => {
  it('runs each entity view for a viewer and hides from a non-member (not-found, not forbidden)', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);
    for (const entity of ['task', 'project', 'program', 'initiative'] as const) {
      const res = (await client.callTool({
        name: 'list_work',
        arguments: { orgId: s.orgId, entity },
      })) as CallToolResult;
      expect(res.isError).toBeFalsy();
      expect(payload(res)['entity']).toBe(entity);
    }

    // A caller with NO grant (below view) gets the existence-hiding not-found, not forbidden.
    const noGrant = await seedOrg([]);
    const c2 = await connect(noGrant.ctx);
    const hidden = (await c2.callTool({
      name: 'list_work',
      arguments: { orgId: noGrant.orgId, entity: 'task' },
    })) as CallToolResult;
    expect(hidden.isError).toBe(true);
    expect((hidden.content[0] as { text: string }).text).toContain('not_found');
  });

  it('filters tasks by assignee, state, and blocked-ness', async () => {
    const s = await seedOrg(['view', 'contribute']);
    const [mine] = await db
      .insert(schema.task)
      .values({
        organizationId: s.orgId,
        title: 'Mine',
        teamId: s.teamId,
        state: 'todo',
        statusId: s.statusId('task', 'todo'),
        assigneeId: s.actorId,
        createdBy: s.actorId,
      })
      .returning({ id: schema.task.id });
    // `s.taskId` blocks `mine`, and the blocker is unfinished, so `mine` is the blocked one.
    await db.insert(schema.taskDependency).values({
      organizationId: s.orgId,
      blockingTaskId: s.taskId,
      blockedTaskId: assertDefined(mine).id,
    });
    const client = await connect(s.ctx);

    const byAssignee = (await client.callTool({
      name: 'list_work',
      arguments: { orgId: s.orgId, entity: 'task', assignee: 'Ada' },
    })) as CallToolResult;
    const assigned = payload(byAssignee)['items'] as { id: string }[];
    expect(assigned.map((item) => item.id)).toEqual([assertDefined(mine).id]);

    const blocked = (await client.callTool({
      name: 'list_work',
      arguments: { orgId: s.orgId, entity: 'task', blocked: true },
    })) as CallToolResult;
    expect((payload(blocked)['items'] as { id: string }[]).map((item) => item.id)).toEqual([
      assertDefined(mine).id,
    ]);

    const blocking = (await client.callTool({
      name: 'list_work',
      arguments: { orgId: s.orgId, entity: 'task', blocking: true },
    })) as CallToolResult;
    expect((payload(blocking)['items'] as { id: string }[]).map((item) => item.id)).toContain(
      s.taskId,
    );
  });

  it('gets several entities at once and reports the unreadable ones separately', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'get',
      arguments: { orgId: s.orgId, type: 'task', refs: [s.taskId, s.task2Id, MISSING] },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    const body = payload(res) as {
      items: { id: string }[];
      missing: { ref: string; reason: string }[];
    };
    // One bad ref must not cost the caller the two good ones.
    expect(body.items.map((item) => item.id).sort()).toEqual([s.taskId, s.task2Id].sort());
    expect(body.missing).toEqual([{ ref: MISSING, reason: 'not_found' }]);
  });

  it('gets a project by name', async () => {
    const s = await seedOrg(['view']);
    await db
      .update(schema.project)
      .set({
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        startDateResolution: 'quarter',
        startDateFiscalYearStartMonth: 0,
        targetDate: new Date('2026-03-31T00:00:00.000Z'),
        targetDateResolution: 'quarter',
        targetDateFiscalYearStartMonth: 0,
      })
      .where(eq(schema.project.id, s.projectId));
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'get',
      arguments: { orgId: s.orgId, type: 'project', refs: ['Proj'] },
    })) as CallToolResult;
    const body = payload(res) as {
      items: {
        id: string;
        startDateResolution: string | null;
        startDateFiscalYearStartMonth: number | null;
        targetDateResolution: string | null;
        targetDateFiscalYearStartMonth: number | null;
      }[];
    };
    expect(body.items[0]?.id).toBe(s.projectId);
    expect(body.items[0]).toMatchObject({
      startDateResolution: 'quarter',
      startDateFiscalYearStartMonth: 0,
      targetDateResolution: 'quarter',
      targetDateFiscalYearStartMonth: 0,
    });

    const listed = (await client.callTool({
      name: 'list_work',
      arguments: { orgId: s.orgId, entity: 'project' },
    })) as CallToolResult;
    expect((payload(listed)['items'] as Record<string, unknown>[])[0]).toMatchObject({
      startDateResolution: 'quarter',
      startDateFiscalYearStartMonth: 0,
      targetDateResolution: 'quarter',
      targetDateFiscalYearStartMonth: 0,
    });
  });

  it('rejects a filter the entity has no column for, naming the ones it does', async () => {
    const s = await seedOrg(['view']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'list_work',
      arguments: { orgId: s.orgId, entity: 'program', assignee: 'Ada' },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    // Silently ignoring an inapplicable filter would hand back a confidently wrong answer.
    expect(text).toContain('assignee');
    expect(text).toContain('owner');
  });

  it('finds indexed work and returns the actionable entity id', async () => {
    const s = await seedOrg(['view']);
    await indexTask({
      orgId: s.orgId,
      taskId: s.taskId,
      title: 'Ship',
      visibility: { mode: 'org_members' },
    });
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'find',
      arguments: { orgId: s.orgId, query: 'Ship' },
    })) as CallToolResult;
    const items = payload(res)['items'] as { id: string; kind: string }[];
    // The id must be the task's own id, not the `task:<org>:<id>` index key, or no other tool
    // could consume it.
    expect(items).toContainEqual(expect.objectContaining({ id: s.taskId, kind: 'task' }));
  });

  it('does not leak private work to a caller whose org grant does not cascade', async () => {
    const s = await seedOrg(['view']);

    // A caller who may open the workspace but holds no blanket grant over its contents — the
    // shape a guest or a narrowly-scoped collaborator has. `view` on the org itself still
    // satisfies the tool's entry gate, because there the org IS the target resource.
    await db
      .update(schema.grant)
      .set({ cascades: false })
      .where(eq(schema.grant.organizationId, s.orgId));

    const privateTasks = await db
      .insert(schema.task)
      .values([
        {
          organizationId: s.orgId,
          title: 'Ship granted',
          teamId: s.teamId,
          state: 'todo',
          statusId: s.statusId('task', 'todo'),
          visibility: 'private',
          createdBy: s.actorId,
        },
        {
          organizationId: s.orgId,
          title: 'Ship secret',
          teamId: s.teamId,
          state: 'todo',
          statusId: s.statusId('task', 'todo'),
          visibility: 'private',
          createdBy: s.actorId,
        },
      ])
      .returning({ id: schema.task.id });
    const grantedId = assertDefined(privateTasks[0]).id;
    const secretId = assertDefined(privateTasks[1]).id;

    // Only the first one is explicitly shared with this caller.
    await db.insert(schema.grant).values({
      organizationId: s.orgId,
      subjectKind: 'actor',
      subjectId: s.actorId,
      resourceKind: 'task',
      resourceId: grantedId,
      capabilities: ['view'],
      effect: 'allow',
    });

    for (const id of [grantedId, secretId]) {
      await indexTask({
        orgId: s.orgId,
        taskId: id,
        title: id === grantedId ? 'Ship granted' : 'Ship secret',
        visibility: { mode: 'grantable', subjectKind: 'task', subjectId: id },
      });
    }

    const client = await connect(s.ctx);
    const list = (await client.callTool({
      name: 'list_work',
      arguments: { orgId: s.orgId, entity: 'task' },
    })) as CallToolResult;
    const listed = payload(list)['items'] as { id: string; title: string }[];
    const listedIds = listed.map((item) => item.id);

    // `list_work` reads live task rows rather than the search index, so it needs the same
    // canonical per-task visibility predicate as every other task projection.
    expect(listedIds).toContain(grantedId);
    expect(listedIds).not.toContain(secretId);
    expect(JSON.stringify(listed)).not.toContain('Ship secret');

    const res = (await client.callTool({
      name: 'find',
      arguments: { orgId: s.orgId, query: 'Ship' },
    })) as CallToolResult;
    const items = payload(res)['items'] as { id: string; title: string }[];
    const ids = items.map((item) => item.id);

    expect(ids).toContain(grantedId);
    // The ungranted one must not surface at all — not even its title, which is what the previous
    // implementation exposed by authorizing once at the org root and never per row.
    expect(ids).not.toContain(secretId);
    expect(JSON.stringify(items)).not.toContain('Ship secret');
  });

  it('paginates list_work and find results with opaque cursors', async () => {
    const s = await seedOrg(['view']);
    await db.insert(schema.task).values([
      {
        organizationId: s.orgId,
        title: 'Ship 3',
        teamId: s.teamId,
        state: 'todo',
        statusId: s.statusId('task', 'todo'),
        createdBy: s.actorId,
      },
      {
        organizationId: s.orgId,
        title: 'Ship 4',
        teamId: s.teamId,
        state: 'todo',
        statusId: s.statusId('task', 'todo'),
        createdBy: s.actorId,
      },
      {
        organizationId: s.orgId,
        title: 'Ship 5',
        teamId: s.teamId,
        state: 'todo',
        statusId: s.statusId('task', 'todo'),
        createdBy: s.actorId,
      },
    ]);
    const client = await connect(s.ctx);

    const firstView = (await client.callTool({
      name: 'list_work',
      arguments: { orgId: s.orgId, entity: 'task', limit: 2 },
    })) as CallToolResult;
    const firstPayload = PagedViewPayload.parse(payload(firstView));
    expect(firstPayload.items.length).toBe(2);
    expect(firstPayload.nextCursor).toEqual(expect.any(String));

    const secondView = (await client.callTool({
      name: 'list_work',
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

    for (const [index, id] of [s.taskId, s.task2Id].entries()) {
      await indexTask({
        orgId: s.orgId,
        taskId: id,
        title: `Ship ${index}`,
        visibility: { mode: 'org_members' },
      });
    }
    const firstFind = (await client.callTool({
      name: 'find',
      arguments: { orgId: s.orgId, query: 'Ship', limit: 1 },
    })) as CallToolResult;
    const findPayload = PagedFindPayload.parse(payload(firstFind));
    expect(findPayload.items.length).toBe(1);
    expect(findPayload.nextCursor).toEqual(expect.any(String));
  });
});

describe('MCP task mutation reports', () => {
  it('omits an unreadable private task from update and archive reports', async () => {
    const s = await seedOrg(['view']);
    await db
      .update(schema.grant)
      .set({ cascades: false })
      .where(eq(schema.grant.organizationId, s.orgId));
    await db.update(schema.task).set({ visibility: 'private' }).where(eq(schema.task.id, s.taskId));

    const client = await connect(s.ctx);
    const update = (await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        scope: { ids: [s.taskId] },
        set: { priority: 'high' },
      },
    })) as CallToolResult;
    const archive = (await client.callTool({
      name: 'archive',
      arguments: { orgId: s.orgId, entity: 'task', scope: { ids: [s.taskId] } },
    })) as CallToolResult;

    expect(payload(update)).toMatchObject({ matched: 0, changed: 0, skipped: [] });
    expect(payload(archive)).toMatchObject({ matched: 0, changed: 0, skipped: [] });
    expect(JSON.stringify({ update, archive })).not.toContain(s.taskId);
    expect(JSON.stringify({ update, archive })).not.toContain('Ship');
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
    expect(toolNames).toEqual(expect.arrayContaining(['list_work', 'find', 'capture']));

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

describe('hydrated resources', () => {
  it('uses canonical public task visibility for individual task resources', async () => {
    const s = await seedOrg(['view']);
    await db
      .update(schema.grant)
      .set({ cascades: false })
      .where(eq(schema.grant.organizationId, s.orgId));

    const client = await connect(s.ctx);
    const task = readJson(
      (await client.readResource({ uri: `docket://${s.orgId}/task/${s.taskId}` })).contents,
    );

    expect(task['id']).toBe(s.taskId);
  });

  it('omits ungranted private tasks from hydrated refs, rollups, sessions, and completion', async () => {
    const s = await seedOrg(['view']);

    // The root grant lets this caller address the workspace, but deliberately does not flow into
    // its work. The first private task is explicitly shared; the second is a control that must
    // stay absent from every projection that starts at an otherwise-readable parent.
    await db
      .update(schema.grant)
      .set({ cascades: false })
      .where(eq(schema.grant.organizationId, s.orgId));
    await db
      .update(schema.task)
      .set({ visibility: 'private', projectId: s.projectId, cycleId: s.cycleId })
      .where(eq(schema.task.organizationId, s.orgId));
    await db.insert(schema.grant).values([
      {
        organizationId: s.orgId,
        subjectKind: 'actor',
        subjectId: s.actorId,
        resourceKind: 'task',
        resourceId: s.taskId,
        capabilities: ['view'],
        effect: 'allow',
        cascades: false,
      },
      {
        organizationId: s.orgId,
        subjectKind: 'actor',
        subjectId: s.actorId,
        resourceKind: 'project',
        resourceId: s.projectId,
        capabilities: ['view'],
        effect: 'allow',
        cascades: false,
      },
      {
        organizationId: s.orgId,
        subjectKind: 'actor',
        subjectId: s.actorId,
        resourceKind: 'cycle',
        resourceId: s.cycleId,
        capabilities: ['view'],
        effect: 'allow',
        cascades: false,
      },
    ]);
    await db.insert(schema.taskDependency).values({
      organizationId: s.orgId,
      blockingTaskId: s.taskId,
      blockedTaskId: s.task2Id,
    });
    await db
      .update(schema.task)
      .set({ parentTaskId: s.taskId })
      .where(eq(schema.task.id, s.task2Id));
    const [session] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: s.orgId,
        agentId: s.agentId,
        taskId: s.task2Id,
        trigger: 'delegation',
        status: 'running',
        initiatorId: s.actorId,
      })
      .returning({ id: schema.agentSession.id });
    await db.insert(schema.sessionActivity).values({
      sessionId: assertDefined(session).id,
      organizationId: s.orgId,
      type: 'thought',
      body: { text: 'Ship 2 private task summary' },
    });
    const [tasklessSession] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: s.orgId,
        agentId: s.agentId,
        trigger: 'delegation',
        status: 'running',
        initiatorId: s.actorId,
      })
      .returning({ id: schema.agentSession.id });
    await db.insert(schema.sessionActivity).values({
      sessionId: assertDefined(tasklessSession).id,
      organizationId: s.orgId,
      type: 'thought',
      body: { text: 'Taskless session activity remains visible' },
    });

    const client = await connect(s.ctx);
    const visibleTask = readJson(
      (await client.readResource({ uri: `docket://${s.orgId}/task/${s.taskId}` })).contents,
    );
    const project = readJson(
      (await client.readResource({ uri: `docket://${s.orgId}/project/${s.projectId}` })).contents,
    );
    const cycle = readJson(
      (await client.readResource({ uri: `docket://${s.orgId}/cycle/${s.cycleId}` })).contents,
    );
    const sessionDto = readJson(
      (
        await client.readResource({
          uri: `docket://${s.orgId}/session/${assertDefined(session).id}`,
        })
      ).contents,
    );
    const tasklessSessionDto = readJson(
      (
        await client.readResource({
          uri: `docket://${s.orgId}/session/${assertDefined(tasklessSession).id}`,
        })
      ).contents,
    );
    const completion = await client.complete({
      ref: { type: 'ref/resource', uri: 'docket://{org}/{type}/{id}' },
      argument: { name: 'id', value: '' },
      context: { arguments: { org: s.orgId } },
    });

    expect(visibleTask['id']).toBe(s.taskId);
    expect(visibleTask['blocking']).toEqual([]);
    expect(visibleTask['subtasks']).toEqual([]);
    expect(project['taskCount']).toBe(1);
    expect((project['tasks'] as { id: string }[]).map((item) => item.id)).toEqual([s.taskId]);
    expect((cycle['tasks'] as { id: string }[]).map((item) => item.id)).toEqual([s.taskId]);
    expect(sessionDto['taskId']).toBeNull();
    expect(sessionDto['task']).toBeNull();
    expect(sessionDto['activities']).toEqual([]);
    expect(tasklessSessionDto['taskId']).toBeNull();
    expect(tasklessSessionDto['activities']).toMatchObject([
      { body: { text: 'Taskless session activity remains visible' } },
    ]);
    expect(completion.completion.values).toContain(s.taskId);

    const serialized = JSON.stringify({ visibleTask, project, cycle, sessionDto, completion });
    expect(serialized).not.toContain(s.task2Id);
    expect(serialized).not.toContain('Ship 2');
    expect(serialized).not.toContain('private task summary');
  });

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
      statusId: s.statusId('task', 'todo'),
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
    await db
      .update(schema.task)
      .set({ cycleId: s.cycleId, projectId: s.projectId })
      .where(eq(schema.task.id, s.taskId));
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
      sessionId: assertDefined(sess).id,
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
      ['update', assertDefined(upd).id],
      ['comment', assertDefined(cmt).id],
      ['session', assertDefined(sess).id],
      ['agent', s.agentId],
      ['view', assertDefined(view).id],
      ['org', s.orgId],
    ];
    for (const [type, id] of cases) {
      const res = await client.readResource({ uri: `docket://${s.orgId}/${type}/${id}` });
      const dto = readJson(res.contents);
      expect(dto['id']).toBe(id === s.orgId && type === 'org' ? s.orgId : id);
    }

    // Each semantic read uses the same hydrated surface as the canonical resource, while adding
    // a trusted deep link for its widget. Keep this exhaustive so a newly registered tool cannot
    // silently lose authorization or a presentation route.
    const semanticTools: readonly [string, string, string][] = [
      ['task', 'get_tasks', s.taskId],
      ['project', 'get_projects', s.projectId],
      ['program', 'get_programs', s.programId],
      ['initiative', 'get_initiatives', s.initiativeId],
      ['cycle', 'get_cycles', s.cycleId],
      ['team', 'get_teams', s.teamId],
      ['update', 'get_updates', assertDefined(upd).id],
      ['comment', 'get_comments', assertDefined(cmt).id],
      ['session', 'get_sessions', assertDefined(sess).id],
      ['agent', 'get_agents', s.agentId],
      ['view', 'get_views', assertDefined(view).id],
      ['org', 'get_organizations', s.orgId],
    ];
    for (const [, tool, id] of semanticTools) {
      const result = (await client.callTool({
        name: tool,
        arguments: { orgId: s.orgId, refs: [id] },
      })) as CallToolResult;
      expect(result.isError).not.toBe(true);
      const [item] = payload(result)['items'] as Record<string, unknown>[];
      expect(item?.['id']).toBe(id);
      expect(item?.['href']).toEqual(expect.stringContaining(`/orgs/${s.orgId}`));
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
    expect(projDto['tasks']).toEqual([
      expect.objectContaining({ id: s.taskId, title: 'Ship', state: 'todo' }),
    ]);

    // Entity cards lead with people and work the reader can recognise. Never make a widget turn an
    // opaque actor or task id into its own fallback copy just because the resource omitted context.
    const updateRes = await client.readResource({
      uri: `docket://${s.orgId}/update/${assertDefined(upd).id}`,
    });
    expect(readJson(updateRes.contents)['author']).toEqual(
      expect.objectContaining({ id: s.actorId, displayName: 'Ada' }),
    );
    const sessionRes = await client.readResource({
      uri: `docket://${s.orgId}/session/${assertDefined(sess).id}`,
    });
    expect(readJson(sessionRes.contents)).toMatchObject({
      agent: { id: s.agentId, displayName: 'Athena' },
      task: { id: s.taskId, title: 'Ship' },
    });

    // The hydrated agent never surfaces credentials, only protocol/endpoint.
    const agentRes = await client.readResource({ uri: `docket://${s.orgId}/agent/${s.agentId}` });
    const agentDto = readJson(agentRes.contents);
    expect((agentDto['connection'] as { protocol: string }).protocol).toBe('mcp');
    expect(agentDto['displayName']).toBe('Athena');
  });

  it('reads an agent with no connection (null branch) + a program with no projects', async () => {
    const s = await seedOrg(['view']);
    const [bareAgentActor] = await db
      .insert(schema.actor)
      .values({ organizationId: s.orgId, kind: 'agent', displayName: 'Bare' })
      .returning({ id: schema.actor.id });
    const [bareAgent] = await db
      .insert(schema.agent)
      .values({
        organizationId: s.orgId,
        actorId: assertDefined(bareAgentActor).id,
        createdBy: s.actorId,
      })
      .returning({ id: schema.agent.id });
    const client = await connect(s.ctx);

    const agentRes = await client.readResource({
      uri: `docket://${s.orgId}/agent/${assertDefined(bareAgent).id}`,
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
      (inbox['approvals'] as { sessionId: string }[]).some(
        (a) => a.sessionId === assertDefined(sess).id,
      ),
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

  it('hides archived Projects and their Tasks from active Project, Program, and Hub resources', async () => {
    const s = await seedOrg(['view']);
    await db
      .update(schema.project)
      .set({ programId: s.programId, archivedAt: new Date() })
      .where(eq(schema.project.id, s.projectId));
    await db
      .update(schema.task)
      .set({ projectId: s.projectId, programId: s.programId })
      .where(eq(schema.task.id, s.taskId));
    const client = await connect(s.ctx);

    await expect(
      client.readResource({ uri: `docket://${s.orgId}/project/${s.projectId}` }),
    ).rejects.toThrow(/not_found|Not found/i);

    const program = readJson(
      (await client.readResource({ uri: `docket://${s.orgId}/program/${s.programId}` })).contents,
    );
    expect(JSON.stringify(program)).not.toContain(s.projectId);
    expect(JSON.stringify(program)).not.toContain(s.taskId);

    const portfolio = readJson(
      (await client.readResource({ uri: 'docket://hub/portfolio' })).contents,
    );
    expect(JSON.stringify(portfolio)).not.toContain(s.projectId);
  });

  it('does not expose a private legacy plan pointer through the static Hub resource', async () => {
    const s = await seedOrg([]);
    const [guest] = await db
      .insert(schema.role)
      .values({ organizationId: s.orgId, key: 'guest', name: 'Guest' })
      .returning({ id: schema.role.id });
    await db
      .update(schema.actor)
      .set({ roleId: assertDefined(guest).id })
      .where(eq(schema.actor.id, s.actorId));
    const date = new Date().toISOString().slice(0, 10);
    const [privateTask] = await db
      .insert(schema.task)
      .values({
        organizationId: s.orgId,
        teamId: s.teamId,
        title: 'Private static resource task',
        state: 'todo',
        statusId: s.statusId('task', 'todo'),
        visibility: 'private',
        createdBy: s.actorId,
      })
      .returning({ id: schema.task.id });
    const [hub] = await db
      .select({ id: schema.hub.id })
      .from(schema.hub)
      .where(eq(schema.hub.userId, s.userId));
    await db.insert(schema.dailyPlanItem).values({
      hubId: assertDefined(hub).id,
      refOrganizationId: s.orgId,
      refTaskId: assertDefined(privateTask).id,
      date,
    });

    const client = await connect(s.ctx);
    const today = readJson((await client.readResource({ uri: 'docket://hub/today' })).contents);

    expect(today['tasks']).toEqual([]);
  });

  it('returns empty hub surfaces for a user with no memberships', async () => {
    const ctx: McpContext = {
      principal: { kind: 'user', userId: MISSING, userName: null, userEmail: 'ghost@e.com' },
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

  it('hides a private task-bound approval from a Guest until it is directly shared', async () => {
    const s = await seedOrg([]);
    const [guest] = await db
      .insert(schema.role)
      .values({
        organizationId: s.orgId,
        key: 'guest',
        name: 'Guest',
        defaultVisibility: 'private',
      })
      .returning({ id: schema.role.id });
    await db
      .update(schema.actor)
      .set({ roleId: assertDefined(guest).id })
      .where(eq(schema.actor.id, s.actorId));
    await db.update(schema.task).set({ visibility: 'private' }).where(eq(schema.task.id, s.taskId));
    const [bound, taskless] = await db
      .insert(schema.agentSession)
      .values([
        {
          organizationId: s.orgId,
          agentId: s.agentId,
          taskId: s.taskId,
          trigger: 'delegation',
          status: 'awaiting_approval',
          initiatorId: s.actorId,
        },
        {
          organizationId: s.orgId,
          agentId: s.agentId,
          trigger: 'delegation',
          status: 'awaiting_approval',
          initiatorId: s.actorId,
        },
      ])
      .returning({ id: schema.agentSession.id, taskId: schema.agentSession.taskId });
    const client = await connect(s.ctx);

    const hidden = readJson((await client.readResource({ uri: 'docket://hub/inbox' })).contents);
    expect(hidden['approvals']).toContainEqual({
      sessionId: assertDefined(taskless).id,
      taskId: null,
    });
    expect(JSON.stringify(hidden)).not.toContain(assertDefined(bound).id);
    expect(JSON.stringify(hidden)).not.toContain(s.taskId);

    await db.insert(schema.grant).values({
      organizationId: s.orgId,
      subjectKind: 'actor',
      subjectId: s.actorId,
      resourceKind: 'task',
      resourceId: s.taskId,
      capabilities: ['view'],
      effect: 'allow',
      cascades: false,
    });

    const shared = readJson((await client.readResource({ uri: 'docket://hub/inbox' })).contents);
    expect(shared['approvals']).toContainEqual({
      sessionId: assertDefined(bound).id,
      taskId: s.taskId,
    });
  });

  it('filters Hub Portfolio through each project and program visibility decision', async () => {
    const s = await seedOrg([]);
    await Promise.all([
      db
        .update(schema.project)
        .set({ visibility: 'private' })
        .where(eq(schema.project.id, s.projectId)),
      db
        .update(schema.program)
        .set({ visibility: 'private' })
        .where(eq(schema.program.id, s.programId)),
    ]);
    const client = await connect(s.ctx);

    const hidden = readJson(
      (await client.readResource({ uri: 'docket://hub/portfolio' })).contents,
    );
    expect(hidden['projects']).toEqual([]);
    expect(hidden['programs']).toEqual([]);

    const [projectGrant, programGrant] = await db
      .insert(schema.grant)
      .values([
        {
          organizationId: s.orgId,
          subjectKind: 'actor',
          subjectId: s.actorId,
          resourceKind: 'project',
          resourceId: s.projectId,
          capabilities: ['view'],
          effect: 'allow',
          cascades: false,
        },
        {
          organizationId: s.orgId,
          subjectKind: 'actor',
          subjectId: s.actorId,
          resourceKind: 'program',
          resourceId: s.programId,
          capabilities: ['view'],
          effect: 'allow',
          cascades: false,
        },
      ])
      .returning({ id: schema.grant.id });
    const directlyShared = readJson(
      (await client.readResource({ uri: 'docket://hub/portfolio' })).contents,
    );
    expect((directlyShared['projects'] as { id: string }[]).map((project) => project.id)).toContain(
      s.projectId,
    );
    expect((directlyShared['programs'] as { id: string }[]).map((program) => program.id)).toContain(
      s.programId,
    );

    await Promise.all([
      db.delete(schema.grant).where(eq(schema.grant.id, assertDefined(projectGrant).id)),
      db.delete(schema.grant).where(eq(schema.grant.id, assertDefined(programGrant).id)),
      db
        .update(schema.project)
        .set({ visibility: 'public' })
        .where(eq(schema.project.id, s.projectId)),
      db
        .update(schema.program)
        .set({ visibility: 'public' })
        .where(eq(schema.program.id, s.programId)),
    ]);
    const publiclyVisible = readJson(
      (await client.readResource({ uri: 'docket://hub/portfolio' })).contents,
    );
    expect(
      (publiclyVisible['projects'] as { id: string }[]).map((project) => project.id),
    ).toContain(s.projectId);
    expect(
      (publiclyVisible['programs'] as { id: string }[]).map((program) => program.id),
    ).toContain(s.programId);
  });

  it('removes suspended and archived members from every static Hub surface', async () => {
    const s = await seedOrg(['view']);
    const [session] = await db
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

    const assertNoFormerMembershipData = async () => {
      const orgs = readJson((await client.readResource({ uri: 'docket://orgs' })).contents);
      const today = readJson((await client.readResource({ uri: 'docket://hub/today' })).contents);
      const inbox = readJson((await client.readResource({ uri: 'docket://hub/inbox' })).contents);
      const portfolio = readJson(
        (await client.readResource({ uri: 'docket://hub/portfolio' })).contents,
      );
      const completion = await client.complete({
        ref: { type: 'ref/resource', uri: 'docket://{org}/{type}/{id}' },
        argument: { name: 'org', value: s.orgId.slice(0, 6) },
      });

      expect(orgs).toEqual([]);
      expect(today['tasks']).toEqual([]);
      expect(inbox['approvals']).toEqual([]);
      expect(portfolio['projects']).toEqual([]);
      expect(portfolio['programs']).toEqual([]);
      expect(completion.completion.values).toEqual([]);
      expect(JSON.stringify({ orgs, today, inbox, portfolio, completion })).not.toContain(s.orgId);
      expect(JSON.stringify({ orgs, today, inbox, portfolio, completion })).not.toContain(
        assertDefined(session).id,
      );
    };

    await db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, s.actorId));
    await assertNoFormerMembershipData();

    await db
      .update(schema.actor)
      .set({ status: 'active', archivedAt: new Date() })
      .where(eq(schema.actor.id, s.actorId));
    await assertNoFormerMembershipData();
  });

  it('requires work:read for every static resource read', async () => {
    const s = await seedOrg(['view']);
    const client = await connect({ ...s.ctx, scopes: ['work:write'] });

    for (const uri of [
      'docket://orgs',
      'docket://hub/today',
      'docket://hub/inbox',
      'docket://hub/directive',
      'docket://hub/portfolio',
    ]) {
      await expect(client.readResource({ uri })).rejects.toThrow(/work:read/);
    }
    await expect(
      client.complete({
        ref: { type: 'ref/resource', uri: 'docket://{org}/{type}/{id}' },
        argument: { name: 'org', value: s.orgId.slice(0, 6) },
      }),
    ).rejects.toThrow(/work:read/);
    await expect(
      client.complete({
        ref: { type: 'ref/resource', uri: 'docket://{org}/{type}/{id}' },
        argument: { name: 'id', value: s.taskId.slice(0, 6) },
        context: { arguments: { org: s.orgId } },
      }),
    ).rejects.toThrow(/work:read/);
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
    const sysText = (assertDefined(system.messages[0]).content as { text: string }).text;
    expect(sysText).toContain('Docket');
    expect(sysText).toContain('Ada'); // personalized with the caller's name

    const brief = await client.getPrompt({
      name: 'task_brief',
      arguments: { org: s.orgId, task_id: s.taskId, goal: 'finish it' },
    });
    expect((assertDefined(brief.messages[0]).content as { text: string }).text).toContain(s.taskId);

    const briefNoGoal = await client.getPrompt({
      name: 'task_brief',
      arguments: { org: s.orgId, task_id: s.taskId },
    });
    expect((assertDefined(briefNoGoal.messages[0]).content as { text: string }).text).toContain(
      'next workflow state',
    );

    const standup = await client.getPrompt({ name: 'standup', arguments: { org: s.orgId } });
    expect((assertDefined(standup.messages[0]).content as { text: string }).text).toContain(
      s.orgId,
    );
  });

  it('omits the caller name in the system prompt when unset', async () => {
    const s = await seedOrg(['view']);
    const ctx: McpContext = {
      ...s.ctx,
      principal: {
        ...s.ctx.principal,
        kind: 'user',
        userId: s.userId,
        userName: null,
        userEmail: 'a@e.com',
      },
    };
    const client = await connect(ctx);
    const system = await client.getPrompt({ name: 'docket_system' });
    const sysText = (assertDefined(system.messages[0]).content as { text: string }).text;
    expect(sysText).toContain('Docket');
    expect(sysText).not.toContain('on behalf of');
  });
});

describe('run_agent with a prompt argument', () => {
  it('accepts the optional prompt and persists the session', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'run_agent',
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
      name: 'run_agent',
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
      name: 'run_agent',
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
