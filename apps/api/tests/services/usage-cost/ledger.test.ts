import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import { rollupAiTokens } from '../../../src/services/usage-cost/ai-tokens';
import { runUsageRollup } from '../../../src/services/usage-cost/rollup';
import {
  snapshotObjectStorage,
  snapshotPostgresStorage,
} from '../../../src/services/usage-cost/storage';
import {
  addMember,
  getDb,
  seedBaseOrg,
  seedTask,
  seedUserWithHub,
} from '../../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

beforeEach(async () => {
  await db.delete(schema.usageDaily);
  await db.delete(schema.usageMeterRun);
  await db.delete(schema.agentSessionRun);
  await db.delete(schema.agentSession);
});

const DAY = '2026-03-10';
const WINDOW = { from: '2026-03-09', to: '2026-03-12' } as const;

/** Seed a user-owned Athena session and return its id. */
async function seedSession(ownerUserId: string, contextOrganizationId?: string): Promise<string> {
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId,
      contextOrganizationId: contextOrganizationId ?? null,
      kind: 'chat',
      trigger: 'delegation',
      status: 'pending',
      workLinkage: 'conversation',
    })
    .returning({ id: schema.agentSession.id });
  return assertDefined(session).id;
}

let generation = 0;
/** Seed one run of a session. */
async function seedRun(
  sessionId: string,
  ownerUserId: string,
  values: Partial<typeof DbModule.agentSessionRun.$inferInsert>,
): Promise<string> {
  generation += 1;
  const [run] = await db
    .insert(schema.agentSessionRun)
    .values({
      sessionId,
      ownerUserId,
      generation,
      workflowInstanceId: `${sessionId}:${String(generation)}`,
      status: 'completed',
      dispatchOrigin: 'athena_admission',
      startedAt: new Date(`${DAY}T09:00:00Z`),
      completedAt: new Date(`${DAY}T09:05:00Z`),
      ...values,
    })
    .returning({ id: schema.agentSessionRun.id });
  return assertDefined(run).id;
}

/** The ledger rows for one resource. */
async function ledger(
  resource: DbModule.UsageResource,
): Promise<(typeof DbModule.usageDaily.$inferSelect)[]> {
  return db.select().from(schema.usageDaily).where(eq(schema.usageDaily.resource, resource));
}

describe('AI token rollup', () => {
  it('separates own-hardware volume from the same hosted model and retains missing counts', async () => {
    const userId = await seedUserWithHub(db, schema, 'Local owner');
    const sessionId = await seedSession(userId);
    await seedRun(sessionId, userId, { model: 'same-model', inputTokens: 100 });
    await seedRun(sessionId, userId, {
      model: 'same-model',
      inputTokens: 200,
      usageBackend: 'lattice',
    });
    await seedRun(sessionId, userId, { model: null, inputTokens: null, usageBackend: 'lattice' });
    await rollupAiTokens(WINDOW);
    const rows = await ledger('ai_input_tokens');
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: 'same-model', quantity: 100, unmeasuredEvents: 0 }),
        expect.objectContaining({
          dimension: 'lattice:same-model',
          quantity: 200,
          unmeasuredEvents: 0,
        }),
        expect.objectContaining({ dimension: 'lattice:', quantity: 0, unmeasuredEvents: 1 }),
      ]),
    );
  });

  it('records each measured run against its owner, day and model', async () => {
    const userId = await seedUserWithHub(db, schema, 'Cara');
    const sessionId = await seedSession(userId);
    await seedRun(sessionId, userId, {
      inputTokens: 1_000,
      outputTokens: 200,
      cacheReadTokens: 30,
      cacheCreationTokens: 4,
      model: 'model-a',
    });
    await seedRun(sessionId, userId, {
      inputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      model: 'model-a',
    });

    await rollupAiTokens(WINDOW);

    const input = assertDefined((await ledger('ai_input_tokens'))[0]);
    expect(input).toMatchObject({ day: DAY, userId, dimension: 'model-a', quantity: 1_500 });
    expect(assertDefined((await ledger('ai_output_tokens'))[0]).quantity).toBe(300);
    expect(assertDefined((await ledger('ai_cache_read_tokens'))[0]).quantity).toBe(30);
    expect(assertDefined((await ledger('ai_cache_write_tokens'))[0]).quantity).toBe(4);
  });

  it('counts a run with no token counts as unmeasured and adds no quantity', async () => {
    const userId = await seedUserWithHub(db, schema, 'Lena');
    const sessionId = await seedSession(userId);
    await seedRun(sessionId, userId, { inputTokens: null, model: null });
    await seedRun(sessionId, userId, { inputTokens: null, model: null });

    await rollupAiTokens(WINDOW);

    const input = assertDefined((await ledger('ai_input_tokens'))[0]);
    expect(input.quantity).toBe(0);
    expect(input.unmeasuredEvents).toBe(2);
    expect(await ledger('ai_output_tokens')).toEqual([]);
  });

  it('attributes a run to the workspace its session was operating in', async () => {
    const userId = await seedUserWithHub(db, schema, 'Orla');
    const { orgId } = await seedBaseOrg(db, schema);
    const sessionId = await seedSession(userId, orgId);
    await seedRun(sessionId, userId, { inputTokens: 10, model: 'model-a' });

    await rollupAiTokens(WINDOW);

    expect(assertDefined((await ledger('ai_input_tokens'))[0])).toMatchObject({
      userId,
      organizationId: orgId,
    });
  });

  it('skips runs that never started and runs outside the window', async () => {
    const userId = await seedUserWithHub(db, schema, 'Quin');
    const sessionId = await seedSession(userId);
    await seedRun(sessionId, userId, {
      status: 'queued',
      startedAt: null,
      completedAt: null,
      inputTokens: 999,
    });
    await seedRun(sessionId, userId, {
      startedAt: new Date('2026-01-01T09:00:00Z'),
      completedAt: new Date('2026-01-01T09:05:00Z'),
      inputTokens: 888,
    });

    await rollupAiTokens(WINDOW);

    expect(await ledger('ai_input_tokens')).toEqual([]);
  });

  it('replaces its window on repeat, so a late finish lands once and in the right day', async () => {
    const userId = await seedUserWithHub(db, schema, 'Rey');
    const sessionId = await seedSession(userId);
    const runId = await seedRun(sessionId, userId, { inputTokens: 100, model: 'model-a' });

    await rollupAiTokens(WINDOW);
    await rollupAiTokens(WINDOW);
    expect((await ledger('ai_input_tokens')).map((entry) => entry.quantity)).toEqual([100]);

    await db
      .update(schema.agentSessionRun)
      .set({ inputTokens: 250 })
      .where(eq(schema.agentSessionRun.id, runId));
    await rollupAiTokens(WINDOW);

    expect((await ledger('ai_input_tokens')).map((entry) => entry.quantity)).toEqual([250]);
  });
});

describe('storage snapshots', () => {
  it('attributes Postgres bytes to the workspace and person that own the rows', async () => {
    const { orgId, statusId, teamId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'Sol');
    const actorId = await addMember(db, schema, orgId, userId, 'owner');
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Measured task',
      state: 'todo',
      createdBy: actorId,
    });

    await snapshotPostgresStorage(DAY);

    const tasks = await db
      .select()
      .from(schema.usageDaily)
      .where(
        and(
          eq(schema.usageDaily.resource, 'postgres_bytes'),
          eq(schema.usageDaily.dimension, 'task'),
          eq(schema.usageDaily.organizationId, orgId),
        ),
      );
    expect(assertDefined(tasks[0]).userId).toBe(userId);
    expect(assertDefined(tasks[0]).quantity).toBeGreaterThan(0);
  });

  it('writes the unclaimed remainder as one unattributed line and replaces the day on repeat', async () => {
    await snapshotPostgresStorage(DAY);
    const first = await ledger('postgres_bytes');
    await snapshotPostgresStorage(DAY);
    const second = await ledger('postgres_bytes');

    const remainder = second.filter((entry) => entry.dimension === 'unattributed');
    expect(remainder).toHaveLength(1);
    expect(assertDefined(remainder[0]).userId).toBeNull();
    expect(assertDefined(remainder[0]).organizationId).toBeNull();
    expect(second.length).toBe(first.length);
  });

  it('sums recorded blob sizes per store, workspace and person', async () => {
    const { orgId, statusId, teamId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'Tam');
    const actorId = await addMember(db, schema, orgId, userId, 'owner');
    const task = await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Has files',
      state: 'todo',
      createdBy: actorId,
    });
    await db.insert(schema.attachment).values([
      {
        organizationId: orgId,
        createdBy: actorId,
        subjectType: 'task',
        subjectId: task.id,
        kind: 'file',
        title: 'One',
        blobKey: 'blob/one',
        byteSize: 1_000,
      },
      {
        organizationId: orgId,
        createdBy: actorId,
        subjectType: 'task',
        subjectId: task.id,
        kind: 'file',
        title: 'Two',
        blobKey: 'blob/two',
        byteSize: 2_000,
      },
      {
        organizationId: orgId,
        createdBy: actorId,
        subjectType: 'task',
        subjectId: task.id,
        kind: 'url',
        title: 'A link, not stored bytes',
        url: 'https://example.com',
      },
    ]);
    await db.insert(schema.documentImage).values({
      organizationId: orgId,
      createdBy: actorId,
      blobKey: 'img/one',
      mimeType: 'image/png',
      byteSize: 4_000,
    });

    await snapshotObjectStorage(DAY);

    const rows = await ledger('object_bytes');
    const byStore = new Map(rows.map((entry) => [entry.dimension, entry]));
    expect(byStore.get('attachment')).toMatchObject({
      quantity: 3_000,
      userId,
      organizationId: orgId,
    });
    expect(byStore.get('document_image')).toMatchObject({ quantity: 4_000, userId });
  });
});

describe('usage rollup', () => {
  it('runs every meter and records when each one last succeeded', async () => {
    const now = new Date(`${DAY}T04:00:00Z`);

    const outcomes = await runUsageRollup(now);

    expect(outcomes.map((outcome) => [outcome.meter, outcome.ok])).toEqual([
      ['ai_tokens', true],
      ['postgres_storage', true],
      ['object_storage', true],
    ]);
    const runs = await db.select().from(schema.usageMeterRun);
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      expect(run.failed).toBe(false);
      expect(run.lastSuccessAt?.toISOString()).toBe(now.toISOString());
    }
  });
});
