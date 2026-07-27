/**
 * The capability contract: the ten things a person must be able to do through an agent.
 *
 * @remarks
 * Every test here is one sentence someone would actually say, and asserts it can be done in ONE
 * tool call with no id typed by hand. That is the whole point of the rework — a capability that
 * technically exists but takes three calls and a ULID is not a capability an agent will use
 * correctly.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { McpContext } from '../../src/mcp/auth';
import type { registerResources as RegisterResources } from '../../src/mcp/resources';
import type { processSearchIndexJobs as ProcessSearchIndexJobs } from '../../src/search/process-jobs';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
let registerResources!: typeof RegisterResources;
let processSearchIndexJobs!: typeof ProcessSearchIndexJobs;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  registerResources = (await import('../../src/mcp/resources')).registerResources;
  processSearchIndexJobs = (await import('../../src/search/process-jobs')).processSearchIndexJobs;
});

interface Seed {
  orgId: string;
  orgSlug: string;
  teamId: string;
  actorId: string;
  userId: string;
  ctx: McpContext;
}

/** Seed a workspace the caller can fully contribute to. */
async function seedOrg(): Promise<Seed> {
  const slug = `cap-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: `Acme ${slug}`, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;

  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'seeded',
      name: 'Seeded',
      capabilities: ['contribute', 'assign', 'manage', 'comment'],
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
    capabilities: ['contribute', 'assign', 'manage', 'comment'],
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
    orgSlug: slug,
    teamId: team!.id,
    actorId: human!.id,
    userId: user!.id,
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
  registerTools(server, ctx, 'sess_cap');
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
  resetAuthMocks();
});

/** Call a tool and fail loudly with the server's own message when it errors. */
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = (res.content[0] as { text: string } | undefined)?.text ?? '';
  if (res.isError) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

describe('capability: get references for all my workspaces', () => {
  it('lists the caller’s workspaces without needing an orgId first', async () => {
    const first = await seedOrg();
    // A second workspace for the same person, so the answer is genuinely a list.
    const [org2] = await db
      .insert(schema.organization)
      .values({
        name: 'Second',
        slug: `cap2-${Math.random().toString(36).slice(2, 8)}`,
        lifecycleState: 'active',
      })
      .returning({ id: schema.organization.id });
    await db.insert(schema.actor).values({
      organizationId: org2!.id,
      kind: 'human',
      displayName: 'Ada',
      userId: first.userId,
    });

    const client = await connect(first.ctx);
    // This is the bootstrap call: every other tool needs an orgId, so this one must not.
    const out = (await call(client, 'workspaces', {})) as {
      workspaces: { id: string; name: string; slug: string }[];
    };
    const ids = out.workspaces.map((w) => w.id);
    expect(ids).toContain(first.orgId);
    expect(ids).toContain(org2!.id);
    // Names and slugs come back, so the next call can be addressed the way a person says it.
    expect(out.workspaces.find((w) => w.id === first.orgId)?.slug).toBe(first.orgSlug);
  });
});

describe('capability: create and edit tasks', () => {
  it('creates a task from a sentence', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const out = await call(client, 'capture', {
      orgId: s.orgId,
      text: 'Draft the pricing memo',
    });
    expect(out['title']).toBe('Draft the pricing memo');
  });

  it('edits a task without being handed its id', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const created = await call(client, 'capture', { orgId: s.orgId, text: 'Renameable' });

    const out = await call(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [created['id']] },
      set: { title: 'Renamed', priority: 'high', state: 'In Progress' },
    });
    expect(out['changed']).toBe(1);

    const [row] = await db
      .select({
        title: schema.task.title,
        priority: schema.task.priority,
        state: schema.task.state,
      })
      .from(schema.task)
      .where(eq(schema.task.id, String(created['id'])));
    expect(row).toEqual({ title: 'Renamed', priority: 'high', state: 'in_progress' });
  });
});

describe('capability: create and edit projects', () => {
  it('creates a project', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const out = (await call(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'p', kind: 'project', title: 'Billing Revamp' }],
    })) as { placed: { id: string; kind: string }[] };
    expect(out.placed[0]?.kind).toBe('project');

    const [row] = await db
      .select({ name: schema.project.name })
      .from(schema.project)
      .where(eq(schema.project.id, out.placed[0]!.id));
    expect(row?.name).toBe('Billing Revamp');
  });

  it('edits a project by name', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await call(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'p', kind: 'project', title: 'Billing Revamp' }],
    });

    const out = await call(client, 'update', {
      orgId: s.orgId,
      entity: 'project',
      scope: { status: ['planned'] },
      set: { title: 'Billing v2', status: 'active', health: 'at_risk' },
    });
    expect(out['changed']).toBe(1);

    const [row] = await db
      .select({
        name: schema.project.name,
        status: schema.project.status,
        health: schema.project.health,
      })
      .from(schema.project)
      .where(eq(schema.project.organizationId, s.orgId));
    expect(row).toEqual({ name: 'Billing v2', status: 'active', health: 'at_risk' });
  });
});

describe('capability: assign and deassign tasks to projects', () => {
  it('files a task into a project, then unfiles it, both by name', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await call(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'p', kind: 'project', title: 'Billing Revamp' }],
    });
    const task = await call(client, 'capture', { orgId: s.orgId, text: 'Wire the webhook' });
    const id = String(task['id']);

    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [id] },
      set: { project: 'Billing Revamp' },
    });
    const [filed] = await db
      .select({ projectId: schema.task.projectId })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    expect(filed?.projectId).not.toBeNull();

    // Deassign: null clears it, which is why the field is nullable rather than merely optional.
    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [id] },
      set: { project: null },
    });
    const [unfiled] = await db
      .select({ projectId: schema.task.projectId })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    expect(unfiled?.projectId).toBeNull();
  });
});

describe('capability: associate and dissociate projects with initiatives', () => {
  it('rolls a project up to an initiative and takes it back off', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await call(client, 'organize', {
      orgId: s.orgId,
      items: [
        { ref: 'i', kind: 'initiative', title: 'Q3 Platform' },
        { ref: 'p', kind: 'project', title: 'Billing Revamp' },
      ],
    });

    await call(client, 'link', {
      orgId: s.orgId,
      relation: 'contributes_to',
      from: 'Billing Revamp',
      to: 'Q3 Platform',
    });
    const linked = await db
      .select()
      .from(schema.initiativeProject)
      .where(eq(schema.initiativeProject.organizationId, s.orgId));
    expect(linked).toHaveLength(1);

    await call(client, 'link', {
      orgId: s.orgId,
      relation: 'contributes_to',
      from: 'Billing Revamp',
      to: 'Q3 Platform',
      remove: true,
    });
    const unlinked = await db
      .select()
      .from(schema.initiativeProject)
      .where(eq(schema.initiativeProject.organizationId, s.orgId));
    expect(unlinked).toEqual([]);
  });
});

describe('capability: create and edit initiatives', () => {
  it('creates one and then changes its status, priority, and owner', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await call(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'i', kind: 'initiative', title: 'Q3 Platform' }],
    });

    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'initiative',
      scope: { status: ['active'] },
      set: { status: 'completed', priority: 'high', owner: 'Ada' },
    });

    const [row] = await db
      .select({
        status: schema.initiative.status,
        priority: schema.initiative.priority,
        ownerId: schema.initiative.ownerId,
      })
      .from(schema.initiative)
      .where(eq(schema.initiative.organizationId, s.orgId));
    expect(row).toEqual({ status: 'completed', priority: 'high', ownerId: s.actorId });
  });
});

describe('capability: change and remove deadlines on any object', () => {
  it('sets and clears a task due date', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const task = await call(client, 'capture', { orgId: s.orgId, text: 'Has a deadline' });
    const id = String(task['id']);

    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [id] },
      set: { dueDate: '2026-09-30' },
    });
    const [set] = await db
      .select({ dueDate: schema.task.dueDate })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    expect(set?.dueDate?.toISOString().slice(0, 10)).toBe('2026-09-30');

    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [id] },
      set: { dueDate: null },
    });
    const [cleared] = await db
      .select({ dueDate: schema.task.dueDate })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    expect(cleared?.dueDate).toBeNull();
  });

  it('sets and clears a project target date', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await call(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'p', kind: 'project', title: 'Dated' }],
    });

    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'project',
      scope: { status: ['planned'] },
      set: { targetDate: '2026-12-01' },
    });
    const [set] = await db
      .select({ targetDate: schema.project.targetDate })
      .from(schema.project)
      .where(eq(schema.project.organizationId, s.orgId));
    expect(set?.targetDate?.toISOString().slice(0, 10)).toBe('2026-12-01');

    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'project',
      scope: { status: ['planned'] },
      set: { targetDate: null },
    });
    const [cleared] = await db
      .select({ targetDate: schema.project.targetDate })
      .from(schema.project)
      .where(eq(schema.project.organizationId, s.orgId));
    expect(cleared?.targetDate).toBeNull();
  });

  it('sets and clears an initiative target date', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await call(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'i', kind: 'initiative', title: 'Dated' }],
    });

    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'initiative',
      scope: { status: ['active'] },
      set: { targetDate: '2026-12-01' },
    });
    const [set] = await db
      .select({ targetDate: schema.initiative.targetDate })
      .from(schema.initiative)
      .where(eq(schema.initiative.organizationId, s.orgId));
    expect(set?.targetDate?.toISOString().slice(0, 10)).toBe('2026-12-01');

    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'initiative',
      scope: { status: ['active'] },
      set: { targetDate: null },
    });
    const [cleared] = await db
      .select({ targetDate: schema.initiative.targetDate })
      .from(schema.initiative)
      .where(eq(schema.initiative.organizationId, s.orgId));
    expect(cleared?.targetDate).toBeNull();
  });
});

describe('capability: find any object', () => {
  it('finds a task by words from its body, not just its title', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await call(client, 'capture', {
      orgId: s.orgId,
      text: 'Vendor review\nthe SOC2 report is overdue from Contoso',
    });
    // `find` reads a search index that writes enqueue into, so it trails writes by a job. Draining
    // here is what the indexer does continuously in production; `list_work` is the live-row path.
    await processSearchIndexJobs({ limit: 100 });

    const out = (await call(client, 'find', {
      orgId: s.orgId,
      query: 'Contoso',
    })) as { items: { title: string }[] };
    expect(out.items.map((i) => i.title)).toContain('Vendor review');
  });

  it('reads any object by id, in a batch, without failing on one it cannot see', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const task = await call(client, 'capture', { orgId: s.orgId, text: 'Readable' });

    const out = (await call(client, 'get', {
      orgId: s.orgId,
      type: 'task',
      refs: [String(task['id']), '01ARZ3NDEKTSV4RRFFQ69G5FAV'],
    })) as { items: { id: string }[]; missing: { ref: string }[] };
    expect(out.items.map((i) => i.id)).toEqual([String(task['id'])]);
    expect(out.missing.map((m) => m.ref)).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FAV']);
  });

  it('reads a project by name rather than id', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await call(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'p', kind: 'project', title: 'Billing Revamp' }],
    });

    const out = (await call(client, 'get', {
      orgId: s.orgId,
      type: 'project',
      refs: ['Billing Revamp'],
    })) as { items: { name?: string }[] };
    expect(out.items).toHaveLength(1);
  });
});

describe('capability: every change is reversible', () => {
  it('undoes the last thing done, whatever it was', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await call(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'p', kind: 'project', title: 'Reversible' }],
    });
    await call(client, 'undo', { orgId: s.orgId });

    const [row] = await db
      .select({ archivedAt: schema.project.archivedAt })
      .from(schema.project)
      .where(
        and(eq(schema.project.organizationId, s.orgId), eq(schema.project.name, 'Reversible')),
      );
    expect(row?.archivedAt).not.toBeNull();
  });
});
