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
import { seedStatuses, type StatusIdLookup } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

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
  projectId: string;
  programId: string;
  initiativeId: string;
  statusId: StatusIdLookup;
  ctx: McpContext;
}

/** Seed an org that can contribute org-wide, with one of each container. */
async function seedOrg(): Promise<Seed> {
  const slug = `lk-${Math.random().toString(36).slice(2, 10)}`;
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

  const [human] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'Ada',
      userId: assertDefined(user).id,
      roleId: assertDefined(role).id,
    })
    .returning({ id: schema.actor.id });
  const actorId = assertDefined(human).id;

  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'role',
    subjectId: assertDefined(role).id,
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

  const [project] = await db
    .insert(schema.project)
    .values({
      organizationId: orgId,
      name: 'Auth Rewrite',
      teamId: assertDefined(team).id,
      createdBy: actorId,
      status: 'planned',
      statusId: statusId('project', 'planned'),
    })
    .returning({ id: schema.project.id });

  const [program] = await db
    .insert(schema.program)
    .values({
      organizationId: orgId,
      name: 'Reliability',
      createdBy: actorId,
      status: 'active',
      statusId: statusId('program', 'active'),
    })
    .returning({ id: schema.program.id });

  const [initiative] = await db
    .insert(schema.initiative)
    .values({
      organizationId: orgId,
      name: 'Q3 Platform',
      createdBy: actorId,
      status: 'active',
      statusId: statusId('initiative', 'active'),
    })
    .returning({ id: schema.initiative.id });

  return {
    orgId,
    teamId: assertDefined(team).id,
    actorId,
    projectId: assertDefined(project).id,
    programId: assertDefined(program).id,
    initiativeId: assertDefined(initiative).id,
    statusId,
    ctx: {
      principal: {
        kind: 'user',
        userId: assertDefined(user).id,
        userName: 'Ada',
        userEmail: email,
      },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    },
  };
}

async function seedTask(
  s: Seed,
  values: Partial<typeof schema.task.$inferInsert> = {},
): Promise<string> {
  const state = values.state ?? 'backlog';
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: s.orgId,
      title: 'Task',
      teamId: s.teamId,
      createdBy: s.actorId,
      ...values,
      state,
      statusId: s.statusId('task', state),
    })
    .returning({ id: schema.task.id });
  return assertDefined(row).id;
}

const harnesses: { close(): Promise<void> }[] = [];

async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_link');
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
  while (harnesses.length > 0) await assertDefined(harnesses.pop()).close();
  resetAuthMocks();
});

function payload(res: CallToolResult): Record<string, unknown> {
  return JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
}

describe('link', () => {
  it('records that one task blocks another', async () => {
    const s = await seedOrg();
    const blocker = await seedTask(s, { title: 'Ship the schema' });
    const blocked = await seedTask(s, { title: 'Cut the release' });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'link',
      arguments: { orgId: s.orgId, relation: 'blocks', from: blocker, to: blocked },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({ linked: true, changed: true });

    const edges = await db
      .select({ blocked: schema.taskDependency.blockedTaskId })
      .from(schema.taskDependency)
      .where(eq(schema.taskDependency.blockingTaskId, blocker));
    expect(edges).toEqual([{ blocked }]);
  });

  it('says nothing changed when the relation already held', async () => {
    const s = await seedOrg();
    const a = await seedTask(s);
    const b = await seedTask(s, { title: 'Other' });
    const client = await connect(s.ctx);
    const args = { orgId: s.orgId, relation: 'blocks', from: a, to: b };
    await client.callTool({ name: 'link', arguments: args });
    const again = (await client.callTool({ name: 'link', arguments: args })) as CallToolResult;
    expect(payload(again)).toMatchObject({ changed: false, changeSetId: null });
  });

  it('refuses an edge that would close a cycle', async () => {
    const s = await seedOrg();
    const a = await seedTask(s, { title: 'A' });
    const b = await seedTask(s, { title: 'B' });
    const client = await connect(s.ctx);
    await client.callTool({
      name: 'link',
      arguments: { orgId: s.orgId, relation: 'blocks', from: a, to: b },
    });
    const res = (await client.callTool({
      name: 'link',
      arguments: { orgId: s.orgId, relation: 'blocks', from: b, to: a },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });

  it('rolls a project up to an initiative, by name on both sides', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'link',
      arguments: {
        orgId: s.orgId,
        relation: 'contributes_to',
        from: 'Auth Rewrite',
        to: 'Q3 Platform',
      },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({
      from: s.projectId,
      to: s.initiativeId,
      linked: true,
      changed: true,
    });

    const links = await db
      .select({ projectId: schema.initiativeProject.projectId })
      .from(schema.initiativeProject)
      .where(eq(schema.initiativeProject.initiativeId, s.initiativeId));
    expect(links).toEqual([{ projectId: s.projectId }]);
  });

  it('works out that a program is a program without being told', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await client.callTool({
      name: 'link',
      arguments: {
        orgId: s.orgId,
        relation: 'contributes_to',
        from: 'Reliability',
        to: 'Q3 Platform',
      },
    });
    const links = await db
      .select({ programId: schema.initiativeProgram.programId })
      .from(schema.initiativeProgram)
      .where(eq(schema.initiativeProgram.initiativeId, s.initiativeId));
    expect(links).toEqual([{ programId: s.programId }]);
  });

  it('asks which one when a name is both a project and a program', async () => {
    const s = await seedOrg();
    await db.insert(schema.program).values({
      organizationId: s.orgId,
      name: 'Auth Rewrite',
      createdBy: s.actorId,
      status: 'active',
      statusId: s.statusId('program', 'active'),
    });
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'link',
      arguments: {
        orgId: s.orgId,
        relation: 'contributes_to',
        from: 'Auth Rewrite',
        to: 'Q3 Platform',
      },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('from');
  });

  it('undoes a link by deleting the edge it added', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'link',
        arguments: {
          orgId: s.orgId,
          relation: 'contributes_to',
          from: 'Auth Rewrite',
          to: 'Q3 Platform',
        },
      })) as CallToolResult,
    ) as { changeSetId: string };

    const undone = payload(
      (await client.callTool({
        name: 'undo',
        arguments: { orgId: s.orgId, changeSetId: out.changeSetId },
      })) as CallToolResult,
    );
    expect(undone).toMatchObject({ reverted: 1, skipped: [] });

    const links = await db
      .select()
      .from(schema.initiativeProject)
      .where(eq(schema.initiativeProject.initiativeId, s.initiativeId));
    expect(links).toEqual([]);
  });

  it('undoes an unlink by putting the edge back', async () => {
    const s = await seedOrg();
    await db.insert(schema.initiativeProject).values({
      organizationId: s.orgId,
      initiativeId: s.initiativeId,
      projectId: s.projectId,
    });

    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'link',
        arguments: {
          orgId: s.orgId,
          relation: 'contributes_to',
          from: 'Auth Rewrite',
          to: 'Q3 Platform',
          remove: true,
        },
      })) as CallToolResult,
    ) as { changeSetId: string };

    await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId, changeSetId: out.changeSetId },
    });
    const links = await db
      .select({ projectId: schema.initiativeProject.projectId })
      .from(schema.initiativeProject)
      .where(eq(schema.initiativeProject.initiativeId, s.initiativeId));
    expect(links).toEqual([{ projectId: s.projectId }]);
  });

  it('reparents a task, and undo puts it back under the old parent', async () => {
    const s = await seedOrg();
    const first = await seedTask(s, { title: 'First parent' });
    const second = await seedTask(s, { title: 'Second parent' });
    const child = await seedTask(s, { title: 'Child', parentTaskId: first });

    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'link',
        arguments: { orgId: s.orgId, relation: 'subtask_of', from: child, to: second },
      })) as CallToolResult,
    ) as { changeSetId: string };

    const [moved] = await db
      .select({ parentTaskId: schema.task.parentTaskId })
      .from(schema.task)
      .where(eq(schema.task.id, child));
    expect(moved?.parentTaskId).toBe(second);

    await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId, changeSetId: out.changeSetId },
    });
    const [back] = await db
      .select({ parentTaskId: schema.task.parentTaskId })
      .from(schema.task)
      .where(eq(schema.task.id, child));
    // Reversing a reparent restores the previous parent, not merely no parent.
    expect(back?.parentTaskId).toBe(first);
  });

  it('refuses to make a task its own parent', async () => {
    const s = await seedOrg();
    const id = await seedTask(s);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'link',
      arguments: { orgId: s.orgId, relation: 'subtask_of', from: id, to: id },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });
});

describe('archive', () => {
  it('takes a scoped set out of view without deleting it', async () => {
    const s = await seedOrg();
    const filed = await seedTask(s, { title: 'Filed', projectId: s.projectId });
    const loose = await seedTask(s, { title: 'Loose' });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'archive',
      arguments: { orgId: s.orgId, entity: 'task', scope: { project: 'Auth Rewrite' } },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({
      matched: 1,
      changed: 1,
      items: [{ id: filed, title: 'Filed' }],
    });

    const rows = await db
      .select({ id: schema.task.id, archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(eq(schema.task.organizationId, s.orgId));
    const byId = new Map(rows.map((row) => [row.id, row.archivedAt]));
    expect(byId.get(filed)).not.toBeNull();
    expect(byId.get(loose)).toBeNull();
  });

  it('restores from the archived pool', async () => {
    const s = await seedOrg();
    const id = await seedTask(s, {
      title: 'Buried',
      projectId: s.projectId,
      archivedAt: new Date(),
    });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'archive',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        scope: { project: 'Auth Rewrite' },
        restore: true,
      },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({ changed: 1 });

    const [row] = await db
      .select({ archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    expect(row?.archivedAt).toBeNull();
  });

  it('reports an item that is already where it was asked to go', async () => {
    const s = await seedOrg();
    const id = await seedTask(s, { title: 'Already gone', archivedAt: new Date() });
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'archive',
      arguments: { orgId: s.orgId, entity: 'task', scope: { ids: [id] } },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({
      changed: 0,
      skipped: [{ id, title: 'Already gone', reason: 'already_archived' }],
    });
  });

  it('refuses an unscoped archive', async () => {
    const s = await seedOrg();
    await seedTask(s, { title: 'Precious' });
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'archive',
      arguments: { orgId: s.orgId, entity: 'task', scope: {} },
    })) as CallToolResult;
    expect(res.isError).toBe(true);

    const [row] = await db
      .select({ archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(and(eq(schema.task.organizationId, s.orgId)));
    expect(row?.archivedAt).toBeNull();
  });

  it('is reversible', async () => {
    const s = await seedOrg();
    const id = await seedTask(s, { title: 'Comes back', projectId: s.projectId });
    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'archive',
        arguments: { orgId: s.orgId, entity: 'task', scope: { project: 'Auth Rewrite' } },
      })) as CallToolResult,
    ) as { changeSetId: string };

    await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId, changeSetId: out.changeSetId },
    });
    const [row] = await db
      .select({ archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    expect(row?.archivedAt).toBeNull();
  });
});
