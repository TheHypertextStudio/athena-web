/** `update` with `set.labels`: putting labels on work over MCP, and undoing it. */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';

import type * as DbModule from '@docket/db';

import { labelsForSubject } from '../../src/lib/labels';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import {
  body,
  closeCatalogClients,
  connectCatalog,
  errorText,
  seedLabel,
  seedLabelGroup,
  seedSecondTeam,
} from './mcp-catalog-harness';
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

afterEach(async () => {
  await closeCatalogClients();
  resetAuthMocks();
});

interface UpdateResult {
  changed: number;
  changes: { id: string; fields: { field: string; from: string; to: string }[] }[];
  skipped: { id: string; reason: string }[];
  changeSetId: string | null;
}

/** The names of the labels on a task, sorted. */
async function taskLabels(seed: McpUpdateSeed, taskId: string): Promise<string[]> {
  return (await labelsForSubject('task', seed.orgId, taskId)).map((l) => l.name).sort();
}

/** Seed a workspace with a manager caller and a connected client. */
async function setup() {
  const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute', 'manage']);
  const client = await connectCatalog(registerTools, seed.ctx);
  const update = async (entity: string, ids: string[], set: Record<string, unknown>) =>
    client.callTool({
      name: 'update',
      arguments: { orgId: seed.orgId, entity, scope: { ids }, set },
    });
  return { seed, client, update };
}

describe('update set.labels', () => {
  it('adds a label by name, and reports the label set before and after', async () => {
    const { seed, update } = await setup();
    await seedLabel(db, schema, seed, { name: 'Bug' });
    const taskId = await seedMcpUpdateTask(db, schema, seed, { title: 'Crash on save' });

    const result = body<UpdateResult>(await update('task', [taskId], { labels: { add: ['bug'] } }));
    expect(result.changed).toBe(1);
    expect(result.changes[0]?.fields).toEqual([{ field: 'labels', from: 'none', to: 'Bug' }]);
    expect(await taskLabels(seed, taskId)).toEqual(['Bug']);
  });

  it('removes and replaces labels, and refuses replace mixed with add', async () => {
    const { seed, update } = await setup();
    const bug = await seedLabel(db, schema, seed, { name: 'Bug' });
    await seedLabel(db, schema, seed, { name: 'Docs' });
    await seedLabel(db, schema, seed, { name: 'UI' });
    const taskId = await seedMcpUpdateTask(db, schema, seed);
    await db.insert(schema.taskLabel).values({ organizationId: seed.orgId, taskId, labelId: bug });

    await update('task', [taskId], { labels: { add: ['Docs', 'UI'], remove: ['Bug'] } });
    expect(await taskLabels(seed, taskId)).toEqual(['Docs', 'UI']);

    await update('task', [taskId], { labels: { replace: ['Bug'] } });
    expect(await taskLabels(seed, taskId)).toEqual(['Bug']);

    const refused = await update('task', [taskId], { labels: { replace: [], add: ['UI'] } });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toContain('set.labels');
  });

  it('swaps a label out when another from the same exclusive group goes on', async () => {
    const { seed, update } = await setup();
    const groupId = await seedLabelGroup(db, schema, seed, { name: 'Severity' });
    const low = await seedLabel(db, schema, seed, { name: 'Low', groupId });
    await seedLabel(db, schema, seed, { name: 'High', groupId });
    const taskId = await seedMcpUpdateTask(db, schema, seed);
    await db.insert(schema.taskLabel).values({ organizationId: seed.orgId, taskId, labelId: low });

    const result = body<UpdateResult>(
      await update('task', [taskId], { labels: { add: ['High'] } }),
    );
    expect(result.changes[0]?.fields).toEqual([{ field: 'labels', from: 'Low', to: 'High' }]);
    expect(await taskLabels(seed, taskId)).toEqual(['High']);
  });

  it('skips work outside a team-limited label’s team and leaves it untouched', async () => {
    const { seed, update } = await setup();
    const designId = await seedSecondTeam(db, schema, seed);
    await seedLabel(db, schema, seed, { name: 'Figma', teamId: designId });
    const coreTask = await seedMcpUpdateTask(db, schema, seed, { priority: 'low' });
    const designTask = await seedMcpUpdateTask(db, schema, seed, {
      teamId: designId,
      priority: 'low',
    });

    const result = body<UpdateResult>(
      await update('task', [coreTask, designTask], {
        priority: 'high',
        labels: { add: ['Figma'] },
      }),
    );
    expect(result.skipped).toEqual([
      expect.objectContaining({ id: coreTask, reason: 'label_out_of_scope' }),
    ]);
    expect(result.changed).toBe(1);
    expect(await taskLabels(seed, coreTask)).toEqual([]);
    const [core] = await db.select().from(schema.task).where(eq(schema.task.id, coreTask));
    expect(core?.priority).toBe('low');
  });

  it('labels projects and initiatives, keeping team labels off an initiative', async () => {
    const { seed, update } = await setup();
    await seedLabel(db, schema, seed, { name: 'Q3' });
    await seedLabel(db, schema, seed, { name: 'Core only', teamId: seed.teamId });
    const [initiative] = await db
      .insert(schema.initiative)
      .values({
        organizationId: seed.orgId,
        name: 'Annual initiative',
        status: 'active',
        statusId: seed.statusId('initiative', 'active'),
        createdBy: seed.actorId,
      })
      .returning({ id: schema.initiative.id });
    const initiativeId = assertDefined(initiative).id;

    const project = body<UpdateResult>(
      await update('project', [seed.projectId], { labels: { add: ['Q3', 'Core only'] } }),
    );
    expect(project.changes[0]?.fields).toEqual([
      { field: 'labels', from: 'none', to: 'Core only, Q3' },
    ]);

    const refused = body<UpdateResult>(
      await update('initiative', [initiativeId], { labels: { add: ['Core only'] } }),
    );
    expect(refused.skipped[0]?.reason).toBe('label_out_of_scope');
    const accepted = body<UpdateResult>(
      await update('initiative', [initiativeId], { labels: { add: ['Q3'] } }),
    );
    expect(accepted.changed).toBe(1);
  });

  it('undoes a label change together with the other fields in the same call', async () => {
    const { seed, client, update } = await setup();
    await seedLabel(db, schema, seed, { name: 'Bug' });
    const taskId = await seedMcpUpdateTask(db, schema, seed, { priority: 'low' });

    const result = body<UpdateResult>(
      await update('task', [taskId], { priority: 'high', labels: { add: ['Bug'] } }),
    );
    expect(result.changed).toBe(1);
    expect(result.changes[0]?.fields.map((f) => f.field)).toEqual(['priority', 'labels']);

    const undone = body<{ reverted: number; skipped: unknown[] }>(
      await client.callTool({
        name: 'undo',
        arguments: { orgId: seed.orgId, changeSetId: result.changeSetId },
      }),
    );
    expect(undone).toMatchObject({ reverted: 2, skipped: [] });
    expect(await taskLabels(seed, taskId)).toEqual([]);
  });

  it('will not undo labels someone has changed since', async () => {
    const { seed, client, update } = await setup();
    await seedLabel(db, schema, seed, { name: 'Bug' });
    const docs = await seedLabel(db, schema, seed, { name: 'Docs' });
    const taskId = await seedMcpUpdateTask(db, schema, seed);
    const result = body<UpdateResult>(await update('task', [taskId], { labels: { add: ['Bug'] } }));
    await db.insert(schema.taskLabel).values({ organizationId: seed.orgId, taskId, labelId: docs });

    const undone = body<{ skipped: { reason: string }[] }>(
      await client.callTool({
        name: 'undo',
        arguments: { orgId: seed.orgId, changeSetId: result.changeSetId },
      }),
    );
    expect(undone.skipped).toEqual([{ kind: 'task_labels', id: taskId, reason: 'changed_since' }]);
    expect(await taskLabels(seed, taskId)).toEqual(['Bug', 'Docs']);
  });

  it('reports nothing changed when the labels are already there', async () => {
    const { seed, update } = await setup();
    const bug = await seedLabel(db, schema, seed, { name: 'Bug' });
    const taskId = await seedMcpUpdateTask(db, schema, seed);
    await db.insert(schema.taskLabel).values({ organizationId: seed.orgId, taskId, labelId: bug });

    const result = body<UpdateResult>(await update('task', [taskId], { labels: { add: ['Bug'] } }));
    expect(result).toMatchObject({ changed: 0, changeSetId: null });
  });
});
