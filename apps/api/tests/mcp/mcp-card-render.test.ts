/**
 * What the MCP App cards are handed to draw: the render model in result `_meta`, and the related
 * work each read names. Every case goes through a real server over the in-memory transport, so the
 * `_meta` asserted here is exactly what a host forwards to the card.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import {
  seedMcpUpdateOrg,
  seedMcpUpdateTask,
  type McpUpdateSeed,
} from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});

const harnesses: { close(): Promise<void> }[] = [];

async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_render');
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

async function call(
  s: McpUpdateSeed,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const client = await connect(s.ctx);
  const res = (await client.callTool({
    name,
    arguments: { orgId: s.orgId, ...args },
  })) as CallToolResult;
  expect(res.isError).toBeFalsy();
  return res;
}

function render(res: CallToolResult): Record<string, Record<string, Record<string, unknown>>> {
  return assertDefined(res._meta?.['docket/render']) as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
}

function contentText(res: CallToolResult): string {
  return (res.content[0] as { text: string }).text;
}

const BRIEF =
  '# Executive Summary\n\nA week-long campaign &amp; a giveaway.\n\n- Priority 3\n- Priority 5';

describe('semantic reads', () => {
  it('send a project brief to the card as blocks, and to the model only as stored', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    await db
      .update(schema.project)
      .set({ description: BRIEF })
      .where(eq(schema.project.id, s.projectId));

    const res = await call(s, 'get_projects', { refs: [s.projectId] });
    const rich = assertDefined(render(res)['items']?.[s.projectId]?.['description']) as {
      blocks: { kind: string }[];
      excerpt: string;
    };
    expect(rich.blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph', 'list']);
    expect(rich.excerpt).toBe('A week-long campaign & a giveaway.');
    expect(contentText(res)).not.toContain('docket/render');
    expect(contentText(res)).not.toContain('"blocks"');
  });

  it('name each active task with its team’s state and its route', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    await seedMcpUpdateTask(db, schema, s, {
      title: 'Draft the brief',
      projectId: s.projectId,
      state: 'todo',
    });

    const res = await call(s, 'get_projects', { refs: [s.projectId] });
    const item = (res.structuredContent as { items: { tasks: Record<string, unknown>[] }[] })
      .items[0];
    expect(assertDefined(item).tasks[0]).toMatchObject({
      title: 'Draft the brief',
      state: 'todo',
      stateType: 'unstarted',
      stateName: expect.any(String),
      href: expect.stringContaining('/tasks/'),
    });
  });

  it('shape a big project’s work for its card, and send the whole list only to the card', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    const [milestone] = await db
      .insert(schema.milestone)
      .values({ organizationId: s.orgId, projectId: s.projectId, name: 'Campaign week' })
      .returning({ id: schema.milestone.id });
    const milestoneId = assertDefined(milestone).id;
    const task = (title: string, state: string, extra: Record<string, unknown> = {}) =>
      seedMcpUpdateTask(db, schema, s, { title, state, projectId: s.projectId, ...extra });
    await task('Order stickers', 'todo', { dueDate: new Date('2031-01-10T00:00:00Z') });
    await task('Book hosts', 'in_progress', { milestoneId, assigneeId: s.sarahId });
    await task('Pick the date', 'done', {
      milestoneId,
      completedAt: new Date('2030-12-01T00:00:00Z'),
    });
    await task('Write the recap', 'backlog', { dueDate: new Date('2031-01-01T00:00:00Z') });

    const res = await call(s, 'get_projects', { refs: [s.projectId] });
    const item = (res.structuredContent as { items: Record<string, unknown>[] }).items[0];
    expect(assertDefined(item)['work']).toEqual({
      total: 4,
      open: 3,
      byType: { backlog: 1, unstarted: 1, started: 1, completed: 1, canceled: 0, unknown: 0 },
    });
    const next = assertDefined(item)['tasks'] as { title: string }[];
    expect(next.map((t) => t.title)).toEqual(['Book hosts', 'Order stickers', 'Write the recap']);
    expect(assertDefined(item)['milestones']).toEqual([
      expect.objectContaining({ name: 'Campaign week', progress: { total: 2, completed: 1 } }),
    ]);

    const index = assertDefined(render(res)['work']?.[s.projectId]) as unknown as {
      tasks: { title: string; milestoneId: string | null; assignee: string | null }[];
      total: number;
    };
    expect(index.total).toBe(4);
    expect(index.tasks.map((t) => t.title)).toEqual([
      'Book hosts',
      'Order stickers',
      'Write the recap',
      'Pick the date',
    ]);
    expect(index.tasks[0]).toMatchObject({ milestoneId, assignee: 'Sarah' });
    expect(contentText(res)).not.toContain('Pick the date');
  });

  it('name who wrote a project’s latest update', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    await db.insert(schema.update).values({
      organizationId: s.orgId,
      subjectType: 'project',
      subjectId: s.projectId,
      authorId: s.actorId,
      health: 'on_track',
      body: 'On schedule.',
    });
    const res = await call(s, 'get_projects', { refs: [s.projectId] });
    const item = (res.structuredContent as { items: Record<string, unknown>[] }).items[0];
    expect(assertDefined(item)['latestUpdate']).toMatchObject({ author: { displayName: 'Ada' } });
  });

  it('name the project an update reports on', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    const [row] = await db
      .insert(schema.update)
      .values({
        organizationId: s.orgId,
        subjectType: 'project',
        subjectId: s.projectId,
        authorId: s.actorId,
        health: 'at_risk',
        body: '## This week\n\n- Hosts **confirmed**',
      })
      .returning({ id: schema.update.id });

    const res = await call(s, 'get_updates', { refs: [assertDefined(row).id] });
    const item = (res.structuredContent as { items: Record<string, unknown>[] }).items[0];
    expect(assertDefined(item)['subject']).toEqual({
      type: 'project',
      id: s.projectId,
      name: 'Platform Migration',
      href: expect.stringContaining(`/projects/${s.projectId}`),
    });
    expect(render(res)['items']?.[assertDefined(row).id]?.['body']).toBeDefined();
  });

  it('name the task a comment was left on', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    const taskId = await seedMcpUpdateTask(db, schema, s, { title: 'Book the daily hosts' });
    const [row] = await db
      .insert(schema.comment)
      .values({
        organizationId: s.orgId,
        subjectType: 'task',
        subjectId: taskId,
        authorId: s.actorId,
        body: 'The library can host **Day 8**.',
      })
      .returning({ id: schema.comment.id });

    const res = await call(s, 'get_comments', { refs: [assertDefined(row).id] });
    const item = (res.structuredContent as { items: Record<string, unknown>[] }).items[0];
    expect(assertDefined(item)['subject']).toEqual({
      type: 'task',
      id: taskId,
      name: 'Book the daily hosts',
      href: expect.stringContaining(`/tasks/${taskId}`),
    });
  });

  it('carry only the one-line excerpt for each item of a batch', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    const other = await seedMcpUpdateTask(db, schema, s, { description: BRIEF });
    const first = await seedMcpUpdateTask(db, schema, s, { description: BRIEF });

    const res = await call(s, 'get_tasks', { refs: [first, other] });
    const rich = assertDefined(render(res)['items']?.[first]?.['description']) as {
      blocks: unknown[];
      excerpt: string;
    };
    expect(rich.blocks).toEqual([]);
    expect(rich.excerpt).toBe('A week-long campaign & a giveaway.');
  });
});

describe('update', () => {
  it('names the people an assignment moved between', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute', 'assign']);
    const id = await seedMcpUpdateTask(db, schema, s, { assigneeId: s.sarahId });

    const res = await call(s, 'update', {
      entity: 'task',
      scope: { ids: [id] },
      set: { assignee: 'Ada' },
    });
    expect(render(res)['changes']?.[id]?.['assigneeId']).toEqual({ from: 'Sarah', to: 'Ada' });
    expect(contentText(res)).not.toContain('docket/render');
  });

  it('reads a state change as one field in the team’s words', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    const id = await seedMcpUpdateTask(db, schema, s, { state: 'todo' });

    const res = await call(s, 'update', {
      entity: 'task',
      scope: { ids: [id] },
      set: { state: 'in_progress' },
    });
    const fields = assertDefined(render(res)['changes']?.[id]);
    expect(fields['statusId']).toEqual({ hidden: true });
    expect(fields['state']).toMatchObject({ from: expect.any(String), to: expect.any(String) });
  });

  it('reads a rewritten description as the words that changed', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    const before = `# Brief\n\n${'Context words that stay the same. '.repeat(20)}A short campaign.`;
    const id = await seedMcpUpdateTask(db, schema, s, { description: before });

    const res = await call(s, 'update', {
      entity: 'task',
      scope: { ids: [id] },
      set: { description: before.replace('short', 'week-long') },
    });
    expect(render(res)['changes']?.[id]?.['description']).toEqual({
      rewrite: expect.objectContaining({
        removed: 'short',
        inserted: 'week-long',
        wordsAdded: 1,
        wordsRemoved: 1,
        tail: 'campaign.',
      }),
    });
  });
});

describe('organize', () => {
  it('says which existing project each top-level item was filed into', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);

    const res = await call(s, 'organize', {
      items: [
        {
          ref: 'kit',
          kind: 'task',
          title: 'Build the partner toolkit',
          project: 'Platform Migration',
        },
        { ref: 'captions', kind: 'task', title: 'Write captions', parent: 'kit' },
      ],
    });
    const placed = (res.structuredContent as { placed: Record<string, unknown>[] }).placed;
    const byRef = new Map(placed.map((row) => [row['ref'], row]));
    expect(byRef.get('kit')?.['container']).toEqual({
      kind: 'project',
      id: s.projectId,
      title: 'Platform Migration',
      href: expect.stringContaining(`/projects/${s.projectId}`),
    });
    expect(byRef.get('captions')?.['container']).toBeUndefined();
  });
});
