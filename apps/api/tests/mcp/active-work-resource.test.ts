import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type { McpContext } from '../../src/mcp/auth';
import type { registerResources as RegisterResources } from '../../src/mcp/resources';
import { getMigratedDb } from '../support/db';
import { seedStatuses, type StatusIdLookup } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerResources!: typeof RegisterResources;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerResources = (await import('../../src/mcp/resources')).registerResources;
});

interface Seed {
  readonly orgId: string;
  readonly teamId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly hubId: string;
  readonly statusId: StatusIdLookup;
  readonly ctx: McpContext;
}

async function seedWorkspace(): Promise<Seed> {
  const slug = `active-work-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: 'Active work', slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  const statusId = await seedStatuses(db, schema, orgId);
  const email = `${slug}@example.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const userId = assertDefined(user).id;
  const [actor] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId })
    .returning({ id: schema.actor.id });
  const actorId = assertDefined(actor).id;
  const [hub] = await db.insert(schema.hub).values({ userId }).returning({ id: schema.hub.id });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId: orgId, name: 'Core', key: `C${slug.slice(-5)}` })
    .returning({ id: schema.team.id });
  return {
    orgId,
    teamId: assertDefined(team).id,
    userId,
    actorId,
    hubId: assertDefined(hub).id,
    statusId,
    ctx: {
      principal: { kind: 'user', userId, userName: 'Ada', userEmail: email },
      scopes: ['work:read'],
    },
  };
}

async function seedTask(
  seed: Seed,
  input: {
    readonly title: string;
    readonly state?: string;
    readonly projectId?: string | null;
    readonly description?: string | null;
    readonly externalUrl?: string | null;
    readonly visibility?: 'public' | 'private';
  },
): Promise<string> {
  const state = input.state ?? 'todo';
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: seed.orgId,
      teamId: seed.teamId,
      title: input.title,
      state,
      statusId: seed.statusId('task', state),
      createdBy: seed.actorId,
      projectId: input.projectId ?? null,
      description: input.description ?? null,
      externalUrl: input.externalUrl ?? null,
      visibility: input.visibility ?? 'public',
    })
    .returning({ id: schema.task.id });
  return assertDefined(row).id;
}

async function seedRecord(
  seed: Seed,
  taskId: string | null,
  status: 'open' | 'paused',
  updatedAt?: Date,
): Promise<string> {
  const [row] = await db
    .insert(schema.timeRecord)
    .values({
      hubId: seed.hubId,
      createdByUserId: seed.userId,
      taskId,
      title: taskId ? 'Tracked task' : 'Unnamed work',
      status,
      startedAt: new Date('2026-09-07T12:00:00.000Z'),
      ...(updatedAt ? { updatedAt } : {}),
    })
    .returning({ id: schema.timeRecord.id });
  return assertDefined(row).id;
}

const connections: { close(): Promise<void> }[] = [];

async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'active-work-test', version: '0.0.0' },
    { capabilities: { resources: {} } },
  );
  registerResources(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  connections.push({
    close: async () => {
      await Promise.all([client.close(), server.close()]);
    },
  });
  return client;
}

afterEach(async () => {
  while (connections.length > 0) await assertDefined(connections.pop()).close();
});

async function read(client: Client): Promise<Record<string, unknown>> {
  const response = await client.readResource({ uri: 'docket://hub/active-work' });
  const content = assertDefined(response.contents[0]);
  if (!('text' in content)) throw new Error('Active-work resource did not return text');
  return JSON.parse(content.text) as Record<string, unknown>;
}

describe('docket://hub/active-work', () => {
  it('keeps the record but omits an archived anchored task', async () => {
    const seed = await seedWorkspace();
    const taskId = await seedTask(seed, { title: 'Archived retained task' });
    const recordId = await seedRecord(seed, taskId, 'open');
    await db.update(schema.task).set({ archivedAt: new Date() }).where(eq(schema.task.id, taskId));
    const client = await connect(seed.ctx);

    await expect(read(client)).resolves.toMatchObject({
      tracking: 'running',
      recordId,
      task: null,
    });
  });

  it('returns the running record and visible task context', async () => {
    const seed = await seedWorkspace();
    const taskId = await seedTask(seed, { title: 'Ship the browser client' });
    const recordId = await seedRecord(seed, taskId, 'open');
    const client = await connect(seed.ctx);

    await expect(read(client)).resolves.toMatchObject({
      schemaVersion: 'active-work/1',
      observedAt: expect.any(String),
      tracking: 'running',
      recordId,
      task: {
        id: taskId,
        organizationId: seed.orgId,
        title: 'Ship the browser client',
        description: null,
        stateType: 'unstarted',
        workspace: { id: seed.orgId, name: 'Active work' },
        project: null,
        labels: [],
        references: [],
      },
    });
  });

  it('returns a paused terminal task without discarding its context', async () => {
    const seed = await seedWorkspace();
    const taskId = await seedTask(seed, { title: 'Close the release', state: 'done' });
    await seedRecord(seed, taskId, 'paused');
    const client = await connect(seed.ctx);

    await expect(read(client)).resolves.toMatchObject({
      schemaVersion: 'active-work/1',
      observedAt: expect.any(String),
      tracking: 'paused',
      recordId: expect.any(String),
      task: { id: taskId, title: 'Close the release' },
    });
  });

  it('reports idle when the caller has no open or paused record', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed.ctx);

    await expect(read(client)).resolves.toEqual({
      schemaVersion: 'active-work/1',
      observedAt: expect.any(String),
      tracking: 'idle',
      recordId: null,
      task: null,
    });
  });

  it('keeps an unanchored record while withholding task context', async () => {
    const seed = await seedWorkspace();
    const recordId = await seedRecord(seed, null, 'open');
    const client = await connect(seed.ctx);

    await expect(read(client)).resolves.toMatchObject({
      schemaVersion: 'active-work/1',
      observedAt: expect.any(String),
      tracking: 'running',
      recordId,
      task: null,
    });
  });

  it('aggregates task and project URL references', async () => {
    const seed = await seedWorkspace();
    const [project] = await db
      .insert(schema.project)
      .values({
        organizationId: seed.orgId,
        name: 'Browser integration',
        summary: 'Deliver the browser integration.',
        status: 'planned',
        statusId: seed.statusId('project', 'planned'),
        createdBy: seed.actorId,
      })
      .returning({ id: schema.project.id });
    const projectId = assertDefined(project).id;
    const taskId = await seedTask(seed, {
      title: 'Aggregate the sources',
      projectId,
      description: 'Read https://example.com/task-description before you start.',
      externalUrl: 'https://example.com/task-provenance',
    });
    const [label] = await db
      .insert(schema.label)
      .values({ organizationId: seed.orgId, name: 'Security', color: 'red' })
      .returning({ id: schema.label.id });
    await db.insert(schema.taskLabel).values({
      organizationId: seed.orgId,
      taskId,
      labelId: assertDefined(label).id,
    });
    await db.insert(schema.attachment).values([
      {
        organizationId: seed.orgId,
        createdBy: seed.actorId,
        subjectType: 'task',
        subjectId: taskId,
        kind: 'url',
        title: 'Task attachment',
        url: 'https://example.com/task-attachment',
      },
      {
        organizationId: seed.orgId,
        createdBy: seed.actorId,
        subjectType: 'project',
        subjectId: projectId,
        kind: 'url',
        title: 'Project resource',
        url: 'https://example.com/project-resource',
      },
    ]);
    await seedRecord(seed, taskId, 'open');
    const client = await connect(seed.ctx);

    await expect(read(client)).resolves.toMatchObject({
      task: {
        id: taskId,
        organizationId: seed.orgId,
        description: 'Read https://example.com/task-description before you start.',
        stateType: 'unstarted',
        workspace: { id: seed.orgId, name: 'Active work' },
        project: {
          id: projectId,
          name: 'Browser integration',
          summary: 'Deliver the browser integration.',
        },
        labels: [{ id: assertDefined(label).id, name: 'Security' }],
        references: expect.arrayContaining([
          expect.objectContaining({
            url: 'https://example.com/task-attachment',
            source: 'task_attachment',
          }),
          expect.objectContaining({
            url: 'https://example.com/task-description',
            source: 'task_description',
          }),
          expect.objectContaining({
            url: 'https://example.com/task-provenance',
            source: 'task_provenance',
          }),
          expect.objectContaining({
            url: 'https://example.com/project-resource',
            source: 'project_resource',
          }),
        ]),
      },
    });
  });

  it('redacts an inaccessible task in another workspace', async () => {
    const seed = await seedWorkspace();
    const foreign = await seedWorkspace();
    const foreignTaskId = await seedTask(foreign, {
      title: 'Private customer work',
      visibility: 'private',
    });
    const [record] = await db
      .insert(schema.timeRecord)
      .values({
        hubId: seed.hubId,
        createdByUserId: seed.userId,
        taskId: foreignTaskId,
        title: 'Private customer work',
        status: 'open',
        startedAt: new Date('2026-09-07T12:00:00.000Z'),
      })
      .returning({ id: schema.timeRecord.id });
    const client = await connect(seed.ctx);

    const payload = await read(client);
    expect(payload).toMatchObject({
      schemaVersion: 'active-work/1',
      observedAt: expect.any(String),
      tracking: 'running',
      recordId: assertDefined(record).id,
      task: null,
    });
    expect(JSON.stringify(payload)).not.toContain('Private customer work');
  });

  it('prefers an open record over a more recently updated paused record', async () => {
    const seed = await seedWorkspace();
    const runningTaskId = await seedTask(seed, { title: 'Continue the migration' });
    const pausedTaskId = await seedTask(seed, { title: 'Review the brief' });
    const runningRecordId = await seedRecord(
      seed,
      runningTaskId,
      'open',
      new Date('2026-09-07T12:00:00.000Z'),
    );
    await seedRecord(seed, pausedTaskId, 'paused', new Date('2026-09-07T13:00:00.000Z'));
    const client = await connect(seed.ctx);

    await expect(read(client)).resolves.toMatchObject({
      schemaVersion: 'active-work/1',
      observedAt: expect.any(String),
      tracking: 'running',
      recordId: runningRecordId,
      task: { id: runningTaskId, title: 'Continue the migration' },
    });
  });
});
