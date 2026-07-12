import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type {
  db as DbType,
  organization as OrgTable,
  team as TeamTable,
  actor as ActorTable,
  role as RoleTable,
  grant as GrantTable,
  task as TaskTable,
  user as UserTable,
} from '@docket/db';
import { publicProblemTitle, type Capability } from '@docket/types';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import type { registerResources as RegisterResources } from '../../src/mcp/resources';
import type { mcpHandler as McpHandler } from '../../src/mcp/server';
import '../support/auth-mock';
import { getMigratedDb } from '../support/db';

let db!: typeof DbType;
let organization!: typeof OrgTable;
let team!: typeof TeamTable;
let actor!: typeof ActorTable;
let role!: typeof RoleTable;
let grant!: typeof GrantTable;
let task!: typeof TaskTable;
let user!: typeof UserTable;
let registerTools!: typeof RegisterTools;
let registerResources!: typeof RegisterResources;
let mcpHandler!: typeof McpHandler;

beforeAll(async () => {
  const dbmod = await getMigratedDb();
  db = dbmod.db;
  organization = dbmod.organization;
  team = dbmod.team;
  actor = dbmod.actor;
  role = dbmod.role;
  grant = dbmod.grant;
  task = dbmod.task;
  user = dbmod.user;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  registerResources = (await import('../../src/mcp/resources')).registerResources;
  mcpHandler = (await import('../../src/mcp/server')).mcpHandler;
});

/** Seeded ids for a self-contained, capability-scoped org fixture. */
interface Seed {
  readonly userId: string;
  readonly orgId: string;
  readonly teamId: string;
  readonly actorId: string;
  readonly taskId: string;
  readonly ctx: McpContext;
}

/**
 * Seed an org whose human actor effectively holds exactly `capabilities` org-wide,
 * via a role + an org-level grant (the same shape canActor resolves through). The
 * grant cascades down containment, so it also authorizes the seeded task.
 */
async function seedOrg(capabilities: readonly Capability[]): Promise<Seed> {
  const slug = `mcp-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: organization.id });
  const orgId = org!.id;

  const [r] = await db
    .insert(role)
    .values({
      organizationId: orgId,
      key: 'seeded',
      name: 'Seeded',
      capabilities: [...capabilities],
    })
    .returning({ id: role.id });
  const roleId = r!.id;

  const email = `${slug}@example.com`;
  const [u] = await db.insert(user).values({ name: 'Ada', email }).returning({ id: user.id });
  const userId = u!.id;

  const [human] = await db
    .insert(actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId, roleId })
    .returning({ id: actor.id });
  const actorId = human!.id;

  // The org-level grant on the role is what canActor collects + ranks.
  if (capabilities.length > 0) {
    await db.insert(grant).values({
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
    .insert(team)
    .values({ organizationId: orgId, name: 'Core', key: 'CORE' })
    .returning({ id: team.id });
  const teamId = t!.id;

  const [tk] = await db
    .insert(task)
    .values({
      organizationId: orgId,
      title: 'Ship the Hub',
      teamId,
      state: 'todo',
      createdBy: actorId,
    })
    .returning({ id: task.id });
  const taskId = tk!.id;

  const ctx: McpContext = {
    principal: { kind: 'user', userId, userName: 'Ada', userEmail: email },
    scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
  };
  return { userId, orgId, teamId, actorId, taskId, ctx };
}

/** A connected MCP client/server pair plus a disposer, bound to one caller. */
interface Harness {
  readonly client: Client;
  close(): Promise<void>;
}

/**
 * Build a fresh identity-bound MCP server (same registration as the real handler),
 * link it to a Client over the in-memory transport pair, and connect both.
 */
async function connectFor(ctx: McpContext): Promise<Harness> {
  const server = new McpServer(
    { name: 'docket-test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx);
  registerResources(server, ctx);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

const openHarnesses: Harness[] = [];

/** Open a harness for `ctx`, auto-closed after each test. */
async function harnessFor(ctx: McpContext): Promise<Harness> {
  const h = await connectFor(ctx);
  openHarnesses.push(h);
  return h;
}

afterEach(async () => {
  while (openHarnesses.length > 0) {
    const h = openHarnesses.pop();
    if (h) await h.close();
  }
});

describe('create_task tool', () => {
  it('creates a task for a contributor', async () => {
    const s = await seedOrg(['contribute']);
    const { client } = await harnessFor(s.ctx);

    const result = (await client.callTool({
      name: 'create_task',
      arguments: { orgId: s.orgId, teamId: s.teamId, title: 'From MCP' },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    expect(first?.type).toBe('text');
    const payload = JSON.parse((first as { text: string }).text) as { id: string; state: string };
    expect(payload.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // The task is actually persisted in the org, created by the caller's actor.
    const rows = await db.select().from(task).where(eq(task.id, payload.id)).limit(1);
    expect(rows[0]?.title).toBe('From MCP');
    expect(rows[0]?.organizationId).toBe(s.orgId);
    expect(rows[0]?.createdBy).toBe(s.actorId);
  });

  it('is denied (isError) for an actor lacking contribute', async () => {
    const s = await seedOrg(['view']);
    const { client } = await harnessFor(s.ctx);

    const result = (await client.callTool({
      name: 'create_task',
      arguments: { orgId: s.orgId, teamId: s.teamId, title: 'Should not exist' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    // A present-but-insufficient capability maps to the forbidden Problem code.
    expect(text).toContain('forbidden');

    // Nothing was written.
    const rows = await db.select().from(task).where(eq(task.title, 'Should not exist'));
    expect(rows).toHaveLength(0);
  });
});

describe('docket:// entity resource', () => {
  it('returns a seeded task for a viewer', async () => {
    const s = await seedOrg(['view']);
    const { client } = await harnessFor(s.ctx);

    const result = await client.readResource({
      uri: `docket://${s.orgId}/task/${s.taskId}`,
    });

    expect(result.contents).toHaveLength(1);
    const content = result.contents[0]!;
    expect(content.mimeType).toBe('application/json');
    expect('text' in content).toBe(true);
    const entity = JSON.parse((content as { text: string }).text) as { id: string; title: string };
    expect(entity.id).toBe(s.taskId);
    expect(entity.title).toBe('Ship the Hub');
  });

  it('is denied for an actor without the view capability', async () => {
    const s = await seedOrg([]);
    const { client } = await harnessFor(s.ctx);

    // No effective capability ⇒ existence-hiding 404, surfaced as a JSON-RPC error.
    await expect(
      client.readResource({ uri: `docket://${s.orgId}/task/${s.taskId}` }),
    ).rejects.toThrow(/not_found|Not found/i);
  });
});

/** Mount the real /mcp handler on a throwaway app so requests route through it. */
function mcpApp() {
  const app = new Hono();
  app.on(['POST', 'GET'], '/mcp', mcpHandler);
  return app;
}

/** A minimal, well-formed JSON-RPC initialize body for the POST path. */
const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'guard-test', version: '0.0.0' },
  },
});

describe('Origin + auth guard', () => {
  it('rejects a request with no session (401)', async () => {
    const app = mcpApp();
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: INITIALIZE_BODY,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    const problem = (await res.json()) as { status: number; code: string };
    expect(problem.code).toBe('unauthorized');
  });

  it('rejects a disallowed Origin before any session check (401)', async () => {
    const app = mcpApp();
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        origin: 'https://evil.example.com',
      },
      body: INITIALIZE_BODY,
    });
    expect(res.status).toBe(401);
    const problem = (await res.json()) as { status: number; code: string; title: string };
    expect(problem.code).toBe('unauthorized');
    expect(problem.title).toBe(publicProblemTitle('unauthorized'));
    expect(JSON.stringify(problem)).not.toContain('Origin');
  });
});
