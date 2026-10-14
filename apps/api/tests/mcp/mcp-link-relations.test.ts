import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import {
  LinkHarness,
  payload,
  resultText,
  seedInitiative,
  seedLinkOrg,
  seedProject,
  seedRestrictedMember,
  seedTask,
  type LinkDb,
  type LinkSeed,
} from './mcp-link-fixtures';

let handle!: LinkDb;
let harness!: LinkHarness;

beforeAll(async () => {
  const schema = await getMigratedDb();
  handle = { schema, db: schema.db };
  harness = new LinkHarness((await import('../../src/mcp/tools')).registerTools);
});

afterEach(async () => {
  await harness.closeAll();
  resetAuthMocks();
});

/** Call `link` and return the raw result. */
async function link(
  client: Client,
  s: LinkSeed,
  args: { relation: string; from: string; to: string; remove?: boolean },
): Promise<CallToolResult> {
  return (await client.callTool({
    name: 'link',
    arguments: { orgId: s.orgId, ...args },
  })) as CallToolResult;
}

/** Call `undo` on a change set. */
async function undo(client: Client, s: LinkSeed, changeSetId: unknown): Promise<CallToolResult> {
  return (await client.callTool({
    name: 'undo',
    arguments: { orgId: s.orgId, changeSetId },
  })) as CallToolResult;
}

/** Every project edge in the org, as `blocking>blocked`. */
async function projectEdges(s: LinkSeed): Promise<string[]> {
  const { db, schema } = handle;
  const rows = await db
    .select()
    .from(schema.projectDependency)
    .where(eq(schema.projectDependency.organizationId, s.orgId));
  return rows.map((row) => `${row.blockingProjectId}>${row.blockedProjectId}`);
}

/** Every related-task edge in the org, as stored. */
async function relatedEdges(s: LinkSeed): Promise<string[]> {
  const { db, schema } = handle;
  const rows = await db
    .select()
    .from(schema.taskRelatedTask)
    .where(eq(schema.taskRelatedTask.organizationId, s.orgId));
  return rows.map((row) => `${row.taskId}~${row.relatedTaskId}`);
}

/** Every hierarchy link the org owns, as `child<parent`. */
async function nesting(s: LinkSeed): Promise<string[]> {
  const { db, schema } = handle;
  const rows = await db
    .select()
    .from(schema.initiativeHierarchyLink)
    .where(eq(schema.initiativeHierarchyLink.contextOrganizationId, s.orgId));
  return rows.map((row) => `${row.childInitiativeId}<${row.parentInitiativeId}`);
}

describe('link blocks between projects', () => {
  it('records that one project blocks another, by id', async () => {
    const s = await seedLinkOrg(handle);
    const launch = await seedProject(handle, s, 'Launch');
    const client = await harness.connect(s.ctx);

    const res = await link(client, s, { relation: 'blocks', from: s.projectId, to: launch });

    expect(res.isError).toBeFalsy();
    expect(payload(res)).toMatchObject({
      from: s.projectId,
      to: launch,
      fromKind: 'project',
      toKind: 'project',
      linked: true,
      changed: true,
    });
    expect(await projectEdges(s)).toEqual([`${s.projectId}>${launch}`]);
  });

  it('resolves projects by name', async () => {
    const s = await seedLinkOrg(handle);
    const launch = await seedProject(handle, s, 'Launch');
    const client = await harness.connect(s.ctx);

    const res = await link(client, s, { relation: 'blocks', from: 'Auth Rewrite', to: 'Launch' });

    expect(payload(res)).toMatchObject({ from: s.projectId, to: launch, changed: true });
  });

  it('removes the edge, and undo puts it back', async () => {
    const s = await seedLinkOrg(handle);
    const launch = await seedProject(handle, s, 'Launch');
    await handle.db.insert(handle.schema.projectDependency).values({
      organizationId: s.orgId,
      blockingProjectId: s.projectId,
      blockedProjectId: launch,
    });
    const client = await harness.connect(s.ctx);

    const res = await link(client, s, {
      relation: 'blocks',
      from: s.projectId,
      to: launch,
      remove: true,
    });
    expect(payload(res)).toMatchObject({ linked: false, changed: true });
    expect(await projectEdges(s)).toEqual([]);

    await undo(client, s, payload(res)['changeSetId']);
    expect(await projectEdges(s)).toEqual([`${s.projectId}>${launch}`]);
  });

  it('undoes a new edge by deleting it', async () => {
    const s = await seedLinkOrg(handle);
    const launch = await seedProject(handle, s, 'Launch');
    const client = await harness.connect(s.ctx);
    const res = await link(client, s, { relation: 'blocks', from: s.projectId, to: launch });

    const undone = payload(await undo(client, s, payload(res)['changeSetId']));

    expect(undone).toMatchObject({ reverted: 1, skipped: [] });
    expect(await projectEdges(s)).toEqual([]);
  });

  it('says nothing changed when the edge already exists', async () => {
    const s = await seedLinkOrg(handle);
    const launch = await seedProject(handle, s, 'Launch');
    const client = await harness.connect(s.ctx);
    await link(client, s, { relation: 'blocks', from: s.projectId, to: launch });

    const again = await link(client, s, { relation: 'blocks', from: s.projectId, to: launch });

    expect(payload(again)).toMatchObject({ changed: false, changeSetId: null });
  });

  it('refuses a project edge that would close a cycle', async () => {
    const s = await seedLinkOrg(handle);
    const launch = await seedProject(handle, s, 'Launch');
    const client = await harness.connect(s.ctx);
    await link(client, s, { relation: 'blocks', from: s.projectId, to: launch });

    const res = await link(client, s, { relation: 'blocks', from: launch, to: s.projectId });

    expect(res.isError).toBe(true);
    expect(resultText(res)).toContain('dependency_cycle');
    expect(await projectEdges(s)).toEqual([`${s.projectId}>${launch}`]);
  });

  it('names the kind it expected when a task and a project are mixed', async () => {
    const s = await seedLinkOrg(handle);
    const taskId = await seedTask(handle, s);
    const client = await harness.connect(s.ctx);

    const res = await link(client, s, { relation: 'blocks', from: s.projectId, to: taskId });

    expect(res.isError).toBe(true);
    expect(resultText(res)).toContain('to: invalid_option (allowed values: project)');
  });

  it('names the kinds that can block when given an initiative', async () => {
    const s = await seedLinkOrg(handle);
    const client = await harness.connect(s.ctx);

    const res = await link(client, s, {
      relation: 'blocks',
      from: s.initiativeId,
      to: s.projectId,
    });

    expect(res.isError).toBe(true);
    expect(resultText(res)).toContain('from: invalid_option (allowed values: task, project)');
  });

  it('reports an id that names nothing as not found', async () => {
    const s = await seedLinkOrg(handle);
    const client = await harness.connect(s.ctx);

    const res = await link(client, s, {
      relation: 'blocks',
      from: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      to: s.projectId,
    });

    expect(res.isError).toBe(true);
    expect(resultText(res)).toContain('not_found');
  });

  it('refuses a member who may only view the workspace', async () => {
    const s = await seedLinkOrg(handle);
    const launch = await seedProject(handle, s, 'Launch');
    const viewer = await seedRestrictedMember(handle, s, ['view']);
    const client = await harness.connect(viewer);

    const res = await link(client, s, { relation: 'blocks', from: s.projectId, to: launch });

    expect(res.isError).toBe(true);
    expect(await projectEdges(s)).toEqual([]);
  });

  it('refuses a task edge for a member who may only view the workspace', async () => {
    const s = await seedLinkOrg(handle);
    const a = await seedTask(handle, s, { title: 'A' });
    const b = await seedTask(handle, s, { title: 'B' });
    const viewer = await seedRestrictedMember(handle, s, ['view']);
    const client = await harness.connect(viewer);

    const res = await link(client, s, { relation: 'blocks', from: a, to: b });

    expect(res.isError).toBe(true);
  });
});

describe('link relates_to', () => {
  it('relates two tasks once, whichever order they are named in', async () => {
    const s = await seedLinkOrg(handle);
    const a = await seedTask(handle, s, { title: 'A' });
    const b = await seedTask(handle, s, { title: 'B' });
    const client = await harness.connect(s.ctx);

    const first = await link(client, s, { relation: 'relates_to', from: b, to: a });
    const second = await link(client, s, { relation: 'relates_to', from: a, to: b });

    expect(payload(first)).toMatchObject({ fromKind: 'task', toKind: 'task', changed: true });
    expect(payload(second)).toMatchObject({ changed: false });
    const [low, high] = [a, b].sort();
    expect(await relatedEdges(s)).toEqual([`${low}~${high}`]);
  });

  it('removes the relation, and undo restores it', async () => {
    const s = await seedLinkOrg(handle);
    const a = await seedTask(handle, s, { title: 'A' });
    const b = await seedTask(handle, s, { title: 'B' });
    const client = await harness.connect(s.ctx);
    await link(client, s, { relation: 'relates_to', from: a, to: b });

    const removed = await link(client, s, { relation: 'relates_to', from: b, to: a, remove: true });
    expect(payload(removed)).toMatchObject({ linked: false, changed: true });
    expect(await relatedEdges(s)).toEqual([]);

    await undo(client, s, payload(removed)['changeSetId']);
    expect(await relatedEdges(s)).toHaveLength(1);
  });

  it('refuses to relate a task to itself or to a project', async () => {
    const s = await seedLinkOrg(handle);
    const a = await seedTask(handle, s);
    const client = await harness.connect(s.ctx);

    const self = await link(client, s, { relation: 'relates_to', from: a, to: a });
    const project = await link(client, s, { relation: 'relates_to', from: a, to: s.projectId });

    expect(self.isError).toBe(true);
    expect(project.isError).toBe(true);
    expect(await relatedEdges(s)).toEqual([]);
  });
});

describe('link nested_under', () => {
  it('skips undo when later nesting would make the restored parent close a cycle', async () => {
    const s = await seedLinkOrg(handle);
    const child = await seedInitiative(handle, s, 'Payments');
    const client = await harness.connect(s.ctx);
    await link(client, s, { relation: 'nested_under', from: child, to: s.initiativeId });
    const removed = await link(client, s, {
      relation: 'nested_under',
      from: child,
      to: s.initiativeId,
      remove: true,
    });
    await link(client, s, { relation: 'nested_under', from: s.initiativeId, to: child });
    const undone = payload(await undo(client, s, payload(removed)['changeSetId']));
    expect(undone).toMatchObject({ reverted: 0, skipped: [{ reason: 'changed_since' }] });
    expect(await nesting(s)).toEqual([`${s.initiativeId}<${child}`]);
  });

  it('nests one initiative under another, by name', async () => {
    const s = await seedLinkOrg(handle);
    const child = await seedInitiative(handle, s, 'Payments');
    const client = await harness.connect(s.ctx);

    const res = await link(client, s, {
      relation: 'nested_under',
      from: 'Payments',
      to: 'Q3 Platform',
    });

    expect(payload(res)).toMatchObject({
      from: child,
      to: s.initiativeId,
      fromKind: 'initiative',
      toKind: 'initiative',
      changed: true,
    });
    expect(await nesting(s)).toEqual([`${child}<${s.initiativeId}`]);
  });

  it('moves an initiative to a new parent, and undo moves it back', async () => {
    const s = await seedLinkOrg(handle);
    const child = await seedInitiative(handle, s, 'Payments');
    const other = await seedInitiative(handle, s, 'Q4 Growth');
    const client = await harness.connect(s.ctx);
    await link(client, s, { relation: 'nested_under', from: child, to: s.initiativeId });

    const moved = await link(client, s, { relation: 'nested_under', from: child, to: other });
    expect(await nesting(s)).toEqual([`${child}<${other}`]);

    const undone = payload(await undo(client, s, payload(moved)['changeSetId']));
    expect(undone).toMatchObject({ reverted: 1, skipped: [] });
    expect(await nesting(s)).toEqual([`${child}<${s.initiativeId}`]);
  });

  it('un-nests only from the parent named', async () => {
    const s = await seedLinkOrg(handle);
    const child = await seedInitiative(handle, s, 'Payments');
    const other = await seedInitiative(handle, s, 'Q4 Growth');
    const client = await harness.connect(s.ctx);
    await link(client, s, { relation: 'nested_under', from: child, to: s.initiativeId });

    const wrong = await link(client, s, {
      relation: 'nested_under',
      from: child,
      to: other,
      remove: true,
    });
    expect(payload(wrong)).toMatchObject({ changed: false });

    const right = await link(client, s, {
      relation: 'nested_under',
      from: child,
      to: s.initiativeId,
      remove: true,
    });
    expect(payload(right)).toMatchObject({ linked: false, changed: true });
    expect(await nesting(s)).toEqual([]);

    await undo(client, s, payload(right)['changeSetId']);
    expect(await nesting(s)).toEqual([`${child}<${s.initiativeId}`]);
  });

  it('refuses a nesting that would close a cycle', async () => {
    const s = await seedLinkOrg(handle);
    const child = await seedInitiative(handle, s, 'Payments');
    const client = await harness.connect(s.ctx);
    await link(client, s, { relation: 'nested_under', from: child, to: s.initiativeId });

    const res = await link(client, s, {
      relation: 'nested_under',
      from: s.initiativeId,
      to: child,
    });

    expect(res.isError).toBe(true);
    expect(await nesting(s)).toEqual([`${child}<${s.initiativeId}`]);
  });

  it('refuses an initiative nested under itself', async () => {
    const s = await seedLinkOrg(handle);
    const client = await harness.connect(s.ctx);

    const res = await link(client, s, {
      relation: 'nested_under',
      from: s.initiativeId,
      to: s.initiativeId,
    });

    expect(res.isError).toBe(true);
  });

  it('undoes a nesting by removing it', async () => {
    const s = await seedLinkOrg(handle);
    const child = await seedInitiative(handle, s, 'Payments');
    const client = await harness.connect(s.ctx);
    const res = await link(client, s, {
      relation: 'nested_under',
      from: child,
      to: s.initiativeId,
    });

    await undo(client, s, payload(res)['changeSetId']);

    expect(await nesting(s)).toEqual([]);
  });
});

describe('link subtask_of removal', () => {
  it('requires contribution on the parent as well as the child', async () => {
    const s = await seedLinkOrg(handle);
    const parent = await seedTask(handle, s, { title: 'Restricted parent' });
    const child = await seedTask(handle, s, { title: 'Writable child' });
    const ctx = await seedRestrictedMember(handle, s, ['view']);
    const { db, schema } = handle;
    const userId = ctx.principal.kind === 'user' ? ctx.principal.userId : '';
    const [member] = await db.select().from(schema.actor).where(eq(schema.actor.userId, userId));
    await db.insert(schema.grant).values({
      organizationId: s.orgId,
      subjectKind: 'actor',
      subjectId: member?.id ?? '',
      resourceKind: 'task',
      resourceId: child,
      capabilities: ['contribute'],
      effect: 'allow',
    });
    const client = await harness.connect(ctx);
    const result = await link(client, s, { relation: 'subtask_of', from: child, to: parent });
    expect(result.isError).toBe(true);
    const [row] = await db.select().from(schema.task).where(eq(schema.task.id, child));
    expect(row?.parentTaskId).toBeNull();
  });

  it('leaves a task alone when it sits under a different parent than the one named', async () => {
    const s = await seedLinkOrg(handle);
    const parent = await seedTask(handle, s, { title: 'Parent' });
    const other = await seedTask(handle, s, { title: 'Other' });
    const child = await seedTask(handle, s, { title: 'Child', parentTaskId: parent });
    const client = await harness.connect(s.ctx);

    const res = await link(client, s, {
      relation: 'subtask_of',
      from: child,
      to: other,
      remove: true,
    });

    expect(payload(res)).toMatchObject({ changed: false });
    const [row] = await handle.db
      .select({ parentTaskId: handle.schema.task.parentTaskId })
      .from(handle.schema.task)
      .where(eq(handle.schema.task.id, child));
    expect(row?.parentTaskId).toBe(parent);
  });
});
