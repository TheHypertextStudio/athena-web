import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { McpContext } from '../../src/mcp/auth';
import { TOOL_SCOPE } from '../../src/mcp/scope';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { seedStatuses } from '../support/routes-harness';
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
  readonly orgId: string;
  readonly ctx: McpContext;
}

/** Seed an org whose caller can contribute org-wide, with one team to land work in. */
async function seedOrg(scopes: string[] = ['work:read', 'work:write']): Promise<Seed> {
  const slug = `ms-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  await seedStatuses(db, schema, orgId);
  const [role] = await db
    .insert(schema.role)
    .values({ organizationId: orgId, key: 'seeded', name: 'Seeded', capabilities: ['contribute'] })
    .returning({ id: schema.role.id });
  const email = `${slug}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  await db.insert(schema.actor).values({
    organizationId: orgId,
    kind: 'human',
    displayName: 'Ada',
    userId: assertDefined(user).id,
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
  await db
    .insert(schema.team)
    .values({ organizationId: orgId, name: 'Core', key: `C${slug.slice(3, 7)}` });
  return {
    orgId,
    ctx: {
      principal: {
        kind: 'user',
        userId: assertDefined(user).id,
        userName: 'Ada',
        userEmail: email,
      },
      scopes,
    },
  };
}

const harnesses: { close(): Promise<void> }[] = [];

async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_ms');
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

/** Call a tool and return its parsed JSON payload, failing on an error result. */
async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = (res.content[0] as { text: string }).text;
  expect(res.isError, text).toBeFalsy();
  return JSON.parse(text) as T;
}

/** Call a tool expecting an error result, returning its text. */
async function callError(client: Client, name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  expect(res.isError).toBe(true);
  return (res.content[0] as { text: string }).text;
}

interface Placed {
  placed: { ref: string; kind: string; id: string; created: boolean; projectId?: string }[];
}

interface MilestonesOut {
  project: { id: string; name: string };
  milestones: {
    id: string;
    name: string;
    description: string | null;
    targetDate: string | null;
    sort: number;
    progress: { total: number; completed: number };
  }[];
  changeSetId: string | null;
}

interface UpdateOut {
  changed: number;
  skipped: { id: string; reason: string }[];
  changeSetId: string | null;
}

/** Place two projects with tasks through `organize`, returning their ids by ref. */
async function seedWork(client: Client, orgId: string): Promise<Map<string, string>> {
  const out = await call<Placed>(client, 'organize', {
    orgId,
    items: [
      { ref: 'p', kind: 'project', title: 'Migration' },
      { ref: 'q', kind: 'project', title: 'Billing' },
      { ref: 't1', kind: 'task', title: 'Copy the data', parent: 'p' },
      { ref: 't2', kind: 'task', title: 'Cut over', parent: 'p' },
      { ref: 'loose', kind: 'task', title: 'Loose end' },
    ],
  });
  return new Map(out.placed.map((row) => [row.ref, row.id]));
}

async function taskMilestone(taskId: string): Promise<string | null> {
  const [row] = await db
    .select({ milestoneId: schema.task.milestoneId })
    .from(schema.task)
    .where(eq(schema.task.id, taskId));
  return assertDefined(row).milestoneId;
}

describe('milestones tool', () => {
  it('creates, lists with progress, updates, deletes, and undoes each write', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const ids = await seedWork(client, s.orgId);
    const t1 = assertDefined(ids.get('t1'));

    const created = await call<MilestonesOut>(client, 'milestones', {
      orgId: s.orgId,
      project: 'Migration',
      action: 'create',
      milestones: [{ name: 'Beta', targetDate: '2026-10-01' }, { name: 'GA' }],
    });
    expect(created.milestones.map((m) => [m.name, m.sort])).toEqual([
      ['Beta', 0],
      ['GA', 1],
    ]);
    expect(created.changeSetId).not.toBeNull();
    const beta = assertDefined(created.milestones[0]);

    const assigned = await call<UpdateOut>(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [t1] },
      set: { milestone: 'Beta' },
    });
    expect(assigned.changed).toBe(1);
    expect(await taskMilestone(t1)).toBe(beta.id);

    const listed = await call<MilestonesOut>(client, 'milestones', {
      orgId: s.orgId,
      project: 'Migration',
      action: 'list',
    });
    expect(listed.changeSetId).toBeNull();
    expect(listed.milestones.map((m) => [m.name, m.progress.total])).toEqual([
      ['Beta', 1],
      ['GA', 0],
    ]);
    const one = await call<MilestonesOut>(client, 'milestones', {
      orgId: s.orgId,
      project: 'Migration',
      action: 'list',
      milestone: beta.id,
    });
    expect(one.milestones.map((m) => m.id)).toEqual([beta.id]);

    const filtered = await call<{ items: { id: string }[] }>(client, 'list_work', {
      orgId: s.orgId,
      entity: 'task',
      project: 'Migration',
      milestone: 'Beta',
    });
    expect(filtered.items.map((row) => row.id)).toEqual([t1]);

    const renamed = await call<MilestonesOut>(client, 'milestones', {
      orgId: s.orgId,
      project: 'Migration',
      action: 'update',
      milestone: 'Beta',
      set: { name: 'Beta 1', targetDate: null, description: 'First cut' },
    });
    expect(renamed.milestones[0]).toMatchObject({
      name: 'Beta 1',
      targetDate: null,
      description: 'First cut',
    });
    await call(client, 'undo', { orgId: s.orgId, changeSetId: renamed.changeSetId });
    const [restoredName] = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.id, beta.id));
    expect(restoredName).toMatchObject({ name: 'Beta', description: null });
    expect(assertDefined(restoredName).targetDate?.toISOString().slice(0, 10)).toBe('2026-10-01');

    const deleted = await call<MilestonesOut>(client, 'milestones', {
      orgId: s.orgId,
      project: 'Migration',
      action: 'delete',
      milestone: beta.id,
    });
    expect(deleted.milestones[0]?.progress).toEqual({ total: 0, completed: 0 });
    expect(await taskMilestone(t1)).toBeNull();

    await call(client, 'undo', { orgId: s.orgId, changeSetId: deleted.changeSetId });
    expect(await taskMilestone(t1)).toBe(beta.id);

    // Undoing the create removes the milestone nobody uses and keeps the one a task is on.
    const undone = await call<{ reverted: number; skipped: { id: string; reason: string }[] }>(
      client,
      'undo',
      { orgId: s.orgId, changeSetId: created.changeSetId },
    );
    expect(undone.reverted).toBe(1);
    expect(undone.skipped).toEqual([expect.objectContaining({ id: beta.id, reason: 'in_use' })]);
    const remaining = await db
      .select({ name: schema.milestone.name })
      .from(schema.milestone)
      .where(eq(schema.milestone.organizationId, s.orgId));
    expect(remaining.map((m) => m.name)).toEqual(['Beta']);
  });

  it('refuses calls missing what the action needs, and names it can not resolve', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await seedWork(client, s.orgId);
    const base = { orgId: s.orgId, project: 'Migration' };

    expect(await callError(client, 'milestones', { ...base, action: 'create' })).toContain(
      'milestones',
    );
    expect(await callError(client, 'milestones', { ...base, action: 'delete' })).toContain(
      'milestone',
    );
    await call(client, 'milestones', { ...base, action: 'create', milestones: [{ name: 'Beta' }] });
    expect(
      await callError(client, 'milestones', { ...base, action: 'update', milestone: 'Beta' }),
    ).toContain('set');
    await callError(client, 'milestones', { ...base, action: 'delete', milestone: 'Nope' });
    await callError(client, 'milestones', {
      ...base,
      action: 'delete',
      milestone: '01HZZZ000000000000000000M9',
    });
  });

  it('lets a read-only token list but not write', async () => {
    const writer = await seedOrg();
    const writerClient = await connect(writer.ctx);
    await seedWork(writerClient, writer.orgId);
    const reader = await connect({ ...writer.ctx, scopes: ['work:read'] });
    const base = { orgId: writer.orgId, project: 'Migration' };

    // The transport's step-up check reads this map before the handler runs.
    expect(TOOL_SCOPE['milestones']).toBe('work:read');
    await call(reader, 'milestones', { ...base, action: 'list' });
    await callError(reader, 'milestones', {
      ...base,
      action: 'create',
      milestones: [{ name: 'Beta' }],
    });
  });

  it('refuses a blank name or a date the table cannot hold before writing', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await seedWork(client, s.orgId);
    const base = { orgId: s.orgId, project: 'Migration', action: 'create' };
    await callError(client, 'milestones', { ...base, milestones: [{ name: '   ' }] });
    await callError(client, 'milestones', {
      ...base,
      milestones: [{ name: 'Old', targetDate: '0001-01-01' }],
    });
    const rows = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.organizationId, s.orgId));
    expect(rows).toHaveLength(0);
  });
});

describe('task milestones through update', () => {
  it('skips a task outside the milestone project, clears on null, and drops a stale link on a move', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const ids = await seedWork(client, s.orgId);
    const t1 = assertDefined(ids.get('t1'));
    const t2 = assertDefined(ids.get('t2'));
    const loose = assertDefined(ids.get('loose'));
    const created = await call<MilestonesOut>(client, 'milestones', {
      orgId: s.orgId,
      project: 'Migration',
      action: 'create',
      milestones: [{ name: 'Beta' }],
    });
    const beta = assertDefined(created.milestones[0]).id;

    // By id, the milestone is found anywhere, so a task in no project is skipped rather than moved.
    const byId = await call<UpdateOut>(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [t1, loose] },
      set: { milestone: beta },
    });
    expect(byId.changed).toBe(1);
    expect(byId.skipped).toEqual([
      expect.objectContaining({ id: loose, reason: 'milestone_not_in_project' }),
    ]);

    // A Billing task named onto Migration's milestone by id is skipped too.
    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [t2] },
      set: { project: 'Billing' },
    });
    const crossProject = await call<UpdateOut>(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [t2] },
      set: { milestone: beta },
    });
    expect(crossProject.skipped.map((row) => row.reason)).toEqual(['milestone_not_in_project']);

    const moved = await call<UpdateOut>(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [t1] },
      set: { project: 'Billing' },
    });
    expect(moved.changed).toBe(1);
    expect(await taskMilestone(t1)).toBeNull();
    await call(client, 'undo', { orgId: s.orgId, changeSetId: moved.changeSetId });
    expect(await taskMilestone(t1)).toBe(beta);

    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [t1] },
      set: { milestone: null },
    });
    expect(await taskMilestone(t1)).toBeNull();

    // A name one task's project lacks fails the whole call before any task is written.
    await call(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [t1] },
      set: { project: 'Migration' },
    });
    await callError(client, 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [t1, t2] },
      set: { milestone: 'Beta' },
    });
    expect(await taskMilestone(t1)).toBeNull();

    // A container has no milestone field.
    await callError(client, 'update', {
      orgId: s.orgId,
      entity: 'project',
      scope: { ids: [assertDefined(ids.get('p'))] },
      set: { milestone: 'Beta' },
    });
  });
});

describe('milestones through organize', () => {
  it('places milestones under a project and tasks under them, and matches on a re-run', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const plan = [
      { ref: 'p', kind: 'project', title: 'Launch' },
      { ref: 'm', kind: 'milestone', title: 'Beta', parent: 'p', targetDate: '2026-11-01' },
      { ref: 't', kind: 'task', title: 'Invite testers', parent: 'm' },
    ];
    const first = await call<Placed>(client, 'organize', { orgId: s.orgId, items: plan });
    const byRef = new Map(first.placed.map((row) => [row.ref, row]));
    const milestoneRow = assertDefined(byRef.get('m'));
    expect(milestoneRow).toMatchObject({ kind: 'milestone', created: true });
    expect(milestoneRow.projectId).toBe(assertDefined(byRef.get('p')).id);
    expect(await taskMilestone(assertDefined(byRef.get('t')).id)).toBe(milestoneRow.id);

    const again = await call<Placed>(client, 'organize', { orgId: s.orgId, items: plan });
    expect(again.placed.every((row) => !row.created)).toBe(true);

    // An existing task, re-planned under a new milestone, is attached to it.
    const regrouped = await call<Placed>(client, 'organize', {
      orgId: s.orgId,
      items: [
        { ref: 'm2', kind: 'milestone', title: 'GA', project: 'Launch' },
        { ref: 't', kind: 'task', title: 'Invite testers', parent: 'm2' },
      ],
    });
    const ga = assertDefined(regrouped.placed.find((row) => row.ref === 'm2'));
    expect(await taskMilestone(assertDefined(byRef.get('t')).id)).toBe(ga.id);

    // A task naming an existing milestone lands in its project.
    const named = await call<Placed>(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'n', kind: 'task', title: 'Write release notes', milestone: 'Beta' }],
    });
    const task = assertDefined(named.placed[0]);
    const [row] = await db.select().from(schema.task).where(eq(schema.task.id, task.id));
    expect(row).toMatchObject({ milestoneId: milestoneRow.id, projectId: milestoneRow.projectId });

    await callError(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'x', kind: 'milestone', title: 'Orphan' }],
    });

    // A task under a new project cannot name another project's milestone.
    await callError(client, 'organize', {
      orgId: s.orgId,
      items: [
        { ref: 'np', kind: 'project', title: 'Elsewhere' },
        { ref: 'nt', kind: 'task', title: 'Misfiled', parent: 'np', milestone: 'Beta' },
      ],
    });
    const misfiled = await db.select().from(schema.task).where(eq(schema.task.title, 'Misfiled'));
    expect(misfiled).toHaveLength(0);
  });
});
