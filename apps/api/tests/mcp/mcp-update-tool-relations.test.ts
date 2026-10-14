/** `update` with `set.cycle` and `set.initiatives`: moving work between cycles and initiatives. */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';

import type * as DbModule from '@docket/db';

import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import {
  body,
  closeCatalogClients,
  connectCatalog,
  errorText,
  seedSecondTeam,
} from './mcp-catalog-harness';
import { seedInitiative, seedProgram } from './mcp-link-fixtures';
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

/** Seed a contributing caller and a connected client. */
async function setup() {
  const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
  const client = await connectCatalog(registerTools, seed.ctx);
  const update = async (entity: string, ids: string[], set: Record<string, unknown>) =>
    client.callTool({
      name: 'update',
      arguments: { orgId: seed.orgId, entity, scope: { ids }, set },
    });
  const undo = async (changeSetId: string | null) =>
    client.callTool({ name: 'undo', arguments: { orgId: seed.orgId, changeSetId } });
  return { seed, update, undo };
}

/** Insert a cycle on a team, returning its id. */
async function seedCycle(seed: McpUpdateSeed, teamId: string, name: string): Promise<string> {
  const startsAt = new Date('2026-10-05T00:00:00Z');
  const [row] = await db
    .insert(schema.cycle)
    .values({
      organizationId: seed.orgId,
      teamId,
      number: Math.floor(Math.random() * 1_000_000),
      name,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: schema.cycle.id });
  return assertDefined(row).id;
}

/** The cycle a task sits in. */
async function cycleOf(taskId: string): Promise<string | null> {
  const [row] = await db
    .select({ cycleId: schema.task.cycleId })
    .from(schema.task)
    .where(eq(schema.task.id, taskId));
  return row?.cycleId ?? null;
}

/** The initiatives a project contributes to, sorted. */
async function projectInitiatives(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.initiativeProject.initiativeId })
    .from(schema.initiativeProject)
    .where(eq(schema.initiativeProject.projectId, projectId));
  return rows.map((row) => row.id).sort();
}

/** The initiatives a program contributes to, sorted. */
async function programInitiatives(programId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.initiativeProgram.initiativeId })
    .from(schema.initiativeProgram)
    .where(eq(schema.initiativeProgram.programId, programId));
  return rows.map((row) => row.id).sort();
}

describe('update set.cycle', () => {
  it('moves a task into a cycle by name, and undo takes it back out', async () => {
    const { seed, update, undo } = await setup();
    const cycleId = await seedCycle(seed, seed.teamId, 'Sprint 12');
    const taskId = await seedMcpUpdateTask(db, schema, seed);

    const result = body<UpdateResult>(await update('task', [taskId], { cycle: 'Sprint 12' }));

    expect(result.changed).toBe(1);
    expect(result.changes[0]?.fields).toEqual([{ field: 'cycleId', from: 'none', to: cycleId }]);
    expect(await cycleOf(taskId)).toBe(cycleId);

    await undo(result.changeSetId);
    expect(await cycleOf(taskId)).toBeNull();
  });

  it('takes a task out of its cycle with null', async () => {
    const { seed, update } = await setup();
    const cycleId = await seedCycle(seed, seed.teamId, 'Sprint 12');
    const taskId = await seedMcpUpdateTask(db, schema, seed, { cycleId });

    const result = body<UpdateResult>(await update('task', [taskId], { cycle: null }));

    expect(result.changed).toBe(1);
    expect(await cycleOf(taskId)).toBeNull();
  });

  it('skips a task on another team than the cycle', async () => {
    const { seed, update } = await setup();
    const design = await seedSecondTeam(db, schema, seed);
    const cycleId = await seedCycle(seed, design, 'Design sprint');
    const ours = await seedMcpUpdateTask(db, schema, seed, { title: 'Ours' });
    const theirs = await seedMcpUpdateTask(db, schema, seed, { title: 'Theirs', teamId: design });

    const result = body<UpdateResult>(await update('task', [ours, theirs], { cycle: cycleId }));

    expect(result.skipped).toEqual([
      expect.objectContaining({ id: ours, reason: 'cycle_out_of_team' }),
    ]);
    expect(await cycleOf(theirs)).toBe(cycleId);
    expect(await cycleOf(ours)).toBeNull();
  });

  it('refuses a cycle on a project', async () => {
    const { seed, update } = await setup();
    await seedCycle(seed, seed.teamId, 'Sprint 12');

    const result = await update('project', [seed.projectId], { cycle: 'Sprint 12' });

    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('set.cycle');
  });
});

describe('update set.initiatives', () => {
  it('adds a project to an initiative by name, and undo detaches it', async () => {
    const { seed, update, undo } = await setup();
    const q3 = await seedInitiative({ schema, db }, seed, 'Q3 Platform');

    const result = body<UpdateResult>(
      await update('project', [seed.projectId], { initiatives: { add: ['Q3 Platform'] } }),
    );

    expect(result.changes[0]?.fields).toEqual([
      { field: 'initiatives', from: 'none', to: 'Q3 Platform' },
    ]);
    expect(await projectInitiatives(seed.projectId)).toEqual([q3]);

    await undo(result.changeSetId);
    expect(await projectInitiatives(seed.projectId)).toEqual([]);
  });

  it('replaces the initiatives a program contributes to, and undo restores them', async () => {
    const { seed, update, undo } = await setup();
    const handle = { schema, db };
    const q3 = await seedInitiative(handle, seed, 'Q3 Platform');
    const q4 = await seedInitiative(handle, seed, 'Q4 Growth');
    const programId = await seedProgram(handle, seed, 'Reliability');
    await db
      .insert(schema.initiativeProgram)
      .values({ organizationId: seed.orgId, initiativeId: q3, programId });

    const result = body<UpdateResult>(
      await update('program', [programId], { initiatives: { replace: [q4] } }),
    );

    expect(result.changes[0]?.fields).toEqual([
      { field: 'initiatives', from: 'Q3 Platform', to: 'Q4 Growth' },
    ]);
    expect(await programInitiatives(programId)).toEqual([q4]);

    await undo(result.changeSetId);
    expect(await programInitiatives(programId)).toEqual([q3]);
  });

  it('removes an initiative and reports nothing when the set already matched', async () => {
    const { seed, update } = await setup();
    const q3 = await seedInitiative({ schema, db }, seed, 'Q3 Platform');
    await db
      .insert(schema.initiativeProject)
      .values({ organizationId: seed.orgId, initiativeId: q3, projectId: seed.projectId });

    const removed = body<UpdateResult>(
      await update('project', [seed.projectId], { initiatives: { remove: [q3] } }),
    );
    const again = body<UpdateResult>(
      await update('project', [seed.projectId], { initiatives: { remove: [q3] } }),
    );

    expect(removed.changed).toBe(1);
    expect(again.changed).toBe(0);
    expect(again.changeSetId).toBeNull();
    expect(await projectInitiatives(seed.projectId)).toEqual([]);
  });

  it('refuses replace mixed with add, and initiatives on a task', async () => {
    const { seed, update } = await setup();
    await seedInitiative({ schema, db }, seed, 'Q3 Platform');
    const taskId = await seedMcpUpdateTask(db, schema, seed);

    const mixed = await update('project', [seed.projectId], {
      initiatives: { add: ['Q3 Platform'], replace: [] },
    });
    const onTask = await update('task', [taskId], { initiatives: { add: ['Q3 Platform'] } });

    expect(mixed.isError).toBe(true);
    expect(onTask.isError).toBe(true);
    expect(errorText(onTask)).toContain('set.initiatives');
  });
});
