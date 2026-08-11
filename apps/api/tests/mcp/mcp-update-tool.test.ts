import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/types';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb, grantDocketPro } from '../support/db';

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
  /** A second member, so "Sarah's work" is a real distinction. */
  sarahId: string;
  projectId: string;
  ctx: McpContext;
}

/** Seed an org holding `capabilities` org-wide, with a team, a project, and a second member. */
async function seedOrg(capabilities: readonly Capability[]): Promise<Seed> {
  const slug = `up-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;
  await grantDocketPro(schema, orgId);

  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'seeded',
      name: 'Seeded',
      capabilities: [...capabilities],
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

  const [sarah] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Sarah' })
    .returning({ id: schema.actor.id });

  if (capabilities.length > 0) {
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: role!.id,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: [...capabilities],
      effect: 'allow',
    });
  }

  const [team] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });

  const [project] = await db
    .insert(schema.project)
    .values({
      organizationId: orgId,
      name: 'Platform Migration',
      teamId: team!.id,
      createdBy: human!.id,
    })
    .returning({ id: schema.project.id });

  return {
    orgId,
    teamId: team!.id,
    actorId: human!.id,
    sarahId: sarah!.id,
    projectId: project!.id,
    ctx: {
      principal: { kind: 'user', userId: user!.id, userName: 'Ada', userEmail: email },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    },
  };
}

/** Insert a task, returning its id. */
async function seedTask(
  s: Seed,
  values: Partial<typeof schema.task.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: s.orgId,
      title: 'Task',
      teamId: s.teamId,
      state: 'backlog',
      createdBy: s.actorId,
      ...values,
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
  registerTools(server, ctx, 'sess_update');
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

function errorText(res: CallToolResult): string {
  expect(res.isError).toBe(true);
  return (res.content[0] as { text: string }).text;
}

describe('update by scope', () => {
  it('reassigns a person’s open work in one call, naming both people', async () => {
    const s = await seedOrg(['contribute', 'assign']);
    const mine = await seedTask(s, { title: 'Sarah A', assigneeId: s.sarahId });
    const also = await seedTask(s, { title: 'Sarah B', assigneeId: s.sarahId });
    const untouched = await seedTask(s, { title: 'Not hers' });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        // Neither person is named by id — this is the sentence, not a lookup result.
        scope: { assignee: 'Sarah' },
        set: { assignee: 'Ada' },
      },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(payload(res)).toMatchObject({ matched: 2, changed: 2, skipped: [] });

    const rows = await db
      .select({ id: schema.task.id, assigneeId: schema.task.assigneeId })
      .from(schema.task)
      .where(eq(schema.task.organizationId, s.orgId));
    const byId = new Map(rows.map((row) => [row.id, row.assigneeId]));
    expect(byId.get(mine)).toBe(s.actorId);
    expect(byId.get(also)).toBe(s.actorId);
    expect(byId.get(untouched)).toBeNull();
  });

  it('reports what moved, as before → after', async () => {
    const s = await seedOrg(['contribute']);
    await seedTask(s, { title: 'Migrate', projectId: s.projectId, priority: 'high' });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        scope: { project: 'Platform Migration' },
        set: { priority: 'low' },
      },
    })) as CallToolResult;
    const out = payload(res) as {
      changes: { title: string; fields: { field: string; from: string; to: string }[] }[];
    };
    expect(out.changes).toEqual([
      {
        id: expect.any(String),
        title: 'Migrate',
        fields: [{ field: 'priority', from: 'high', to: 'low' }],
      },
    ]);
  });

  it('sees an edit past the point where a diff line is truncated', async () => {
    const s = await seedOrg(['contribute']);
    // The two differ only after character 200, which is where a report line gets shortened. An
    // earlier revision compared the shortened forms, so this edit was written to the database and
    // then reported as nothing: `changed: 0`, an empty change set with nothing for undo to
    // reverse, and no search reindex.
    const shared = 'a'.repeat(400);
    await seedTask(s, {
      title: 'Migrate',
      projectId: s.projectId,
      description: shared + ' before',
    });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        scope: { project: 'Platform Migration' },
        set: { description: shared + ' after' },
      },
    })) as CallToolResult;
    const out = payload(res) as {
      changed: number;
      changeSetId: string;
      changes: { fields: { field: string; from: string; to: string }[] }[];
    };

    expect(out.changed).toBe(1);
    const fields = out.changes[0]?.fields ?? [];
    expect(fields.map((f) => f.field)).toEqual(['description']);
    // Still shortened where it is shown — the fix moved the clamp, it did not remove it.
    expect(fields[0]?.from.length).toBeLessThanOrEqual(200);
    expect(fields[0]?.from.endsWith('…')).toBe(true);

    // And the change set really holds the row, so undo has something to reverse.
    const undone = (await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId, changeSetId: out.changeSetId },
    })) as CallToolResult;
    expect((payload(undone) as { reverted: number }).reverted).toBe(1);
  });

  it('resolves a workflow state by display name', async () => {
    const s = await seedOrg(['contribute']);
    const id = await seedTask(s, { state: 'backlog' });
    const client = await connect(s.ctx);
    await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        scope: { ids: [id] },
        set: { state: 'In Progress' },
      },
    });
    const [row] = await db
      .select({ state: schema.task.state })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    expect(row?.state).toBe('in_progress');
  });

  it('renames a project through the same `title` field a task uses', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'project',
        scope: { ids: [s.projectId] },
        set: { title: 'Platform Rebuild', status: 'active' },
      },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({ changed: 1 });

    const [row] = await db
      .select({ name: schema.project.name, status: schema.project.status })
      .from(schema.project)
      .where(eq(schema.project.id, s.projectId));
    expect(row).toEqual({ name: 'Platform Rebuild', status: 'active' });
  });

  it('is reversible as one change, not one per row', async () => {
    const s = await seedOrg(['contribute']);
    const first = await seedTask(s, { projectId: s.projectId, priority: 'high' });
    const second = await seedTask(s, { projectId: s.projectId, priority: 'urgent' });

    const client = await connect(s.ctx);
    const done = payload(
      (await client.callTool({
        name: 'update',
        arguments: {
          orgId: s.orgId,
          entity: 'task',
          scope: { project: 'Platform Migration' },
          set: { priority: 'low' },
        },
      })) as CallToolResult,
    ) as { changeSetId: string };

    const undone = payload(
      (await client.callTool({
        name: 'undo',
        arguments: { orgId: s.orgId, changeSetId: done.changeSetId },
      })) as CallToolResult,
    );
    expect(undone).toMatchObject({ reverted: 2, skipped: [] });

    const rows = await db
      .select({ id: schema.task.id, priority: schema.task.priority })
      .from(schema.task)
      .where(eq(schema.task.projectId, s.projectId));
    const byId = new Map(rows.map((row) => [row.id, row.priority]));
    expect(byId.get(first)).toBe('high');
    expect(byId.get(second)).toBe('urgent');
  });

  it('records nothing when the scope matched nothing', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        scope: { assignee: 'Sarah' },
        set: { priority: 'low' },
      },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({ matched: 0, changed: 0, changeSetId: null });
  });
});

describe('update guardrails', () => {
  it('refuses a scope that would match the whole workspace', async () => {
    const s = await seedOrg(['contribute']);
    await seedTask(s, { title: 'Precious' });
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        // `archived` selects which pool to read; it narrows nothing within it.
        scope: { archived: false },
        set: { priority: 'low' },
      },
    })) as CallToolResult;
    expect(errorText(res)).toContain('scope');

    const [row] = await db
      .select({ priority: schema.task.priority })
      .from(schema.task)
      .where(eq(schema.task.organizationId, s.orgId));
    expect(row?.priority).toBe('none');
  });

  it('refuses a field the entity does not have, and lists the ones it does', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'program',
        scope: { owner: 'Ada' },
        set: { state: 'done' },
      },
    })) as CallToolResult;
    const text = errorText(res);
    expect(text).toContain('set.state');
    expect(text).toContain('status');
  });

  it('refuses a status that belongs to a different entity', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'initiative',
        scope: { owner: 'Ada' },
        // A legal project status, but not a legal initiative status.
        set: { status: 'planned' },
      },
    })) as CallToolResult;
    const text = errorText(res);
    expect(text).toContain('set.status');
    expect(text).toContain('active');
  });

  it('refuses an empty patch', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update',
      arguments: { orgId: s.orgId, entity: 'task', scope: { assignee: 'Sarah' }, set: {} },
    })) as CallToolResult;
    expect(errorText(res)).toContain('set');
  });

  it('names the candidates when a scope descriptor is ambiguous', async () => {
    const s = await seedOrg(['contribute']);
    await db
      .insert(schema.project)
      .values({ organizationId: s.orgId, name: 'Platform Rebuild', createdBy: s.actorId });
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        scope: { project: 'Platform' },
        set: { priority: 'low' },
      },
    })) as CallToolResult;
    const text = errorText(res);
    expect(text).toContain('Platform Migration');
    expect(text).toContain('Platform Rebuild');
  });

  it('reports a row the caller cannot write instead of failing the call', async () => {
    // `contribute` is granted on the team only, so the task under it is writable and a task
    // on a second team is not — the partial-success case a bulk write hits in real workspaces.
    const s = await seedOrg([]);
    const [otherTeam] = await db
      .insert(schema.team)
      .values({
        organizationId: s.orgId,
        name: 'Other',
        key: `O${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id });

    await db.insert(schema.grant).values([
      {
        organizationId: s.orgId,
        subjectKind: 'actor',
        subjectId: s.actorId,
        resourceKind: 'organization',
        resourceId: s.orgId,
        capabilities: ['view'],
        effect: 'allow',
      },
      {
        organizationId: s.orgId,
        subjectKind: 'actor',
        subjectId: s.actorId,
        resourceKind: 'team',
        resourceId: s.teamId,
        capabilities: ['contribute'],
        effect: 'allow',
      },
    ]);

    const mine = await seedTask(s, { title: 'Mine', projectId: s.projectId });
    const theirs = await seedTask(s, {
      title: 'Theirs',
      projectId: s.projectId,
      teamId: otherTeam!.id,
    });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        scope: { project: 'Platform Migration' },
        set: { priority: 'low' },
      },
    })) as CallToolResult;
    const out = payload(res) as {
      matched: number;
      changed: number;
      skipped: { id: string; title: string; reason: string }[];
    };
    expect(out.matched).toBe(2);
    expect(out.changed).toBe(1);
    expect(out.skipped).toEqual([{ id: theirs, title: 'Theirs', reason: 'not_permitted' }]);

    const rows = await db
      .select({ id: schema.task.id, priority: schema.task.priority })
      .from(schema.task)
      .where(eq(schema.task.projectId, s.projectId));
    const byId = new Map(rows.map((row) => [row.id, row.priority]));
    expect(byId.get(mine)).toBe('low');
    expect(byId.get(theirs)).toBe('none');
  });
});

describe('every settable field reaches a column', () => {
  it('writes the task fields no other test exercises', async () => {
    const s = await seedOrg(['contribute', 'assign']);
    const [otherTeam] = await db
      .insert(schema.team)
      .values({
        organizationId: s.orgId,
        name: 'Platform',
        key: `P${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id });
    const [agent] = await db
      .insert(schema.actor)
      .values({ organizationId: s.orgId, kind: 'agent', displayName: 'Athena' })
      .returning({ id: schema.actor.id });
    const id = await seedTask(s, { title: 'Everything' });

    const client = await connect(s.ctx);
    // description, delegate and team are settable and were otherwise untested — a field declared
    // in SETTABLE with no line in buildPatch would silently no-op.
    await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        scope: { ids: [id] },
        set: { description: 'The full brief', delegate: 'Athena', team: 'Platform' },
      },
    });

    const [row] = await db
      .select({
        description: schema.task.description,
        delegateId: schema.task.delegateId,
        teamId: schema.task.teamId,
      })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    expect(row).toEqual({
      description: 'The full brief',
      delegateId: agent!.id,
      teamId: otherTeam!.id,
    });
  });

  it('writes a project lead and clears a description', async () => {
    const s = await seedOrg(['contribute']);
    await db
      .update(schema.project)
      .set({ description: 'Some prose' })
      .where(eq(schema.project.id, s.projectId));

    const client = await connect(s.ctx);
    await client.callTool({
      name: 'update',
      arguments: {
        orgId: s.orgId,
        entity: 'project',
        scope: { ids: [s.projectId] },
        // An empty string clears a clearable text column; that is the wire convention, not null.
        set: { lead: 'Ada', description: '' },
      },
    });

    const [row] = await db
      .select({ leadId: schema.project.leadId, description: schema.project.description })
      .from(schema.project)
      .where(eq(schema.project.id, s.projectId));
    expect(row).toEqual({ leadId: s.actorId, description: null });
  });
});
