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
  actorId: string;
  ctx: McpContext;
}

/** Seed an org whose caller can contribute org-wide, with one team to land in. */
async function seedOrg(): Promise<Seed> {
  const slug = `og-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;

  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'seeded',
      name: 'Seeded',
      capabilities: ['contribute'],
    })
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

  return {
    orgId,
    teamId: team!.id,
    actorId: human!.id,
    ctx: {
      principal: { kind: 'user', userId: user!.id, userName: 'Ada', userEmail: email },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    },
  };
}

const harnesses: { close(): Promise<void> }[] = [];

async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_org');
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

interface OrganizeResult {
  placed: { ref: string; kind: string; id: string; created: boolean }[];
  created: number;
  matched: number;
  changeSetId: string | null;
}

/** The plan an agent would build from a Q3 planning doc. */
const PLAN = [
  { ref: 'init', kind: 'initiative', title: 'Q3 Platform' },
  { ref: 'proj', kind: 'project', title: 'Auth Rewrite', parent: 'init' },
  { ref: 't1', kind: 'task', title: 'Audit the session store', parent: 'proj' },
  { ref: 't2', kind: 'task', title: 'Migrate refresh tokens', parent: 'proj', priority: 'high' },
];

describe('organize', () => {
  it('writes a whole tree in one call, children naming parents that do not exist yet', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'organize',
      arguments: { orgId: s.orgId, items: PLAN },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();

    const out = payload(res) as unknown as OrganizeResult;
    expect(out.created).toBe(4);
    expect(out.matched).toBe(0);

    const byRef = new Map(out.placed.map((row) => [row.ref, row]));
    const projectId = byRef.get('proj')!.id;
    const initiativeId = byRef.get('init')!.id;

    // The project is linked to the initiative created in the same call.
    const links = await db
      .select({ projectId: schema.initiativeProject.projectId })
      .from(schema.initiativeProject)
      .where(eq(schema.initiativeProject.initiativeId, initiativeId));
    expect(links).toEqual([{ projectId }]);

    const tasks = await db
      .select({ title: schema.task.title, priority: schema.task.priority })
      .from(schema.task)
      .where(eq(schema.task.projectId, projectId));
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.title === 'Migrate refresh tokens')?.priority).toBe('high');
  });

  it('places parents first even when the plan lists them last', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'organize',
      arguments: { orgId: s.orgId, items: [...PLAN].reverse() },
    })) as CallToolResult;
    const out = payload(res) as unknown as OrganizeResult;
    expect(out.created).toBe(4);
    expect(out.placed.map((row) => row.ref)).toEqual(['init', 'proj', 't2', 't1']);
  });

  it('matches instead of duplicating when the same plan runs twice', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await client.callTool({ name: 'organize', arguments: { orgId: s.orgId, items: PLAN } });
    const second = payload(
      (await client.callTool({
        name: 'organize',
        arguments: { orgId: s.orgId, items: PLAN },
      })) as CallToolResult,
    ) as unknown as OrganizeResult;

    expect(second.created).toBe(0);
    expect(second.matched).toBe(4);
    // Nothing was created, so there is nothing to undo.
    expect(second.changeSetId).toBeNull();

    const counts = await Promise.all([
      db.select().from(schema.initiative).where(eq(schema.initiative.organizationId, s.orgId)),
      db.select().from(schema.project).where(eq(schema.project.organizationId, s.orgId)),
      db.select().from(schema.task).where(eq(schema.task.organizationId, s.orgId)),
    ]);
    expect(counts.map((rows) => rows.length)).toEqual([1, 1, 2]);
  });

  it('adds only what is new on a re-run that grew', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await client.callTool({ name: 'organize', arguments: { orgId: s.orgId, items: PLAN } });

    const grown = payload(
      (await client.callTool({
        name: 'organize',
        arguments: {
          orgId: s.orgId,
          items: [
            ...PLAN,
            { ref: 't3', kind: 'task', title: 'Delete the old table', parent: 'proj' },
          ],
        },
      })) as CallToolResult,
    ) as unknown as OrganizeResult;
    expect(grown.created).toBe(1);
    expect(grown.matched).toBe(4);
  });

  it('treats two projects of the same name under different programs as two projects', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'organize',
      arguments: {
        orgId: s.orgId,
        items: [
          { ref: 'p1', kind: 'program', title: 'Platform' },
          { ref: 'p2', kind: 'program', title: 'Growth' },
          { ref: 'r1', kind: 'project', title: 'Rollout', parent: 'p1' },
          { ref: 'r2', kind: 'project', title: 'Rollout', parent: 'p2' },
        ],
      },
    })) as CallToolResult;
    const out = payload(res) as unknown as OrganizeResult;
    expect(out.created).toBe(4);

    const rollouts = await db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(and(eq(schema.project.organizationId, s.orgId), eq(schema.project.name, 'Rollout')));
    expect(rollouts).toHaveLength(2);
  });

  it('attaches to work that already exists, by name', async () => {
    const s = await seedOrg();
    const [existing] = await db
      .insert(schema.project)
      .values({
        organizationId: s.orgId,
        name: 'Auth Rewrite',
        teamId: s.teamId,
        createdBy: s.actorId,
      })
      .returning({ id: schema.project.id });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'organize',
      arguments: {
        orgId: s.orgId,
        items: [{ ref: 't', kind: 'task', title: 'Write the migration', project: 'Auth Rewrite' }],
      },
    })) as CallToolResult;
    const out = payload(res) as unknown as OrganizeResult;
    expect(out.created).toBe(1);

    const [row] = await db
      .select({ projectId: schema.task.projectId })
      .from(schema.task)
      .where(eq(schema.task.id, out.placed[0]!.id));
    expect(row?.projectId).toBe(existing!.id);
  });

  it('reverses the whole plan as one change', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'organize',
        arguments: { orgId: s.orgId, items: PLAN },
      })) as CallToolResult,
    ) as unknown as OrganizeResult;

    const undone = payload(
      (await client.callTool({
        name: 'undo',
        arguments: { orgId: s.orgId, changeSetId: out.changeSetId },
      })) as CallToolResult,
    );
    expect(undone).toMatchObject({ reverted: 4, skipped: [] });

    // Undoing a create archives rather than deletes, so every node the plan added is now archived.
    const tasks = await db
      .select({ archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(eq(schema.task.organizationId, s.orgId));
    const projects = await db
      .select({ archivedAt: schema.project.archivedAt })
      .from(schema.project)
      .where(eq(schema.project.organizationId, s.orgId));
    const initiatives = await db
      .select({ archivedAt: schema.initiative.archivedAt })
      .from(schema.initiative)
      .where(eq(schema.initiative.organizationId, s.orgId));
    for (const row of [...tasks, ...projects, ...initiatives]) {
      expect(row.archivedAt).not.toBeNull();
    }
    expect(tasks.length + projects.length + initiatives.length).toBe(4);
  });

  it('rejects a parent that names nothing in the call', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'organize',
      arguments: {
        orgId: s.orgId,
        items: [{ ref: 't', kind: 'task', title: 'Orphan', parent: 'nope' }],
      },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('items.0.parent');
  });

  it('rejects a parent the child cannot sit under, and says what can', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'organize',
      arguments: {
        orgId: s.orgId,
        items: [
          { ref: 't', kind: 'task', title: 'A task' },
          { ref: 'i', kind: 'initiative', title: 'An initiative', parent: 't' },
        ],
      },
    })) as CallToolResult;
    const text = (res.content[0] as { text: string }).text;
    expect(res.isError).toBe(true);
    expect(text).toContain('items.1.parent');
  });

  it('leaves nothing behind when one item in the plan fails', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'organize',
      arguments: {
        orgId: s.orgId,
        items: [
          { ref: 'ok', kind: 'project', title: 'Would Have Worked' },
          // Resolution of a name that matches nothing throws mid-transaction.
          { ref: 'bad', kind: 'task', title: 'Doomed', project: 'No Such Project' },
        ],
      },
    })) as CallToolResult;
    expect(res.isError).toBe(true);

    const projects = await db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(eq(schema.project.organizationId, s.orgId));
    expect(projects).toEqual([]);
  });
});
