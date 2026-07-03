import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { FIXED_NOW, MockConnector } from '@docket/boundaries';
import type { WorkGraphConnector, WorkGraphSnapshot } from '@docket/boundaries';

import type * as DbModule from '@docket/db';

import type * as ReconcileGraph from '../../src/routes/integration-reconcile-graph';
import { addMember, getDb, one, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let reconcileWorkGraph!: typeof ReconcileGraph.reconcileWorkGraph;
let planWorkItemReconcile!: typeof ReconcileGraph.planWorkItemReconcile;
/**
 * A single global user matching the fixture's `member@example.com`.
 *
 * @remarks
 * `user.email` is globally unique, and every test's org must reference the SAME account to
 * match `lin-user-member`; the tests share one pglite, so we seed this user once and re-attach
 * it (a fresh org-scoped actor) into each test org.
 */
let memberUserId!: string;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/integration-reconcile-graph');
  reconcileWorkGraph = mod.reconcileWorkGraph;
  planWorkItemReconcile = mod.planWorkItemReconcile;
  memberUserId = one(
    await db
      .insert(schema.user)
      .values({ name: 'Member', email: 'member@example.com' })
      .returning({ id: schema.user.id }),
  ).id;
});

const NOW = new Date(FIXED_NOW);

/** Seed a `linear` connector integration with the given routing + write-back. */
async function seedIntegration(
  orgId: string,
  actorId: string,
  teamMappings: { externalTeamId: string; teamId: string }[],
  writeBack = false,
): Promise<typeof schema.integration.$inferSelect> {
  return one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'linear',
        pattern: 'connector',
        roles: ['work'],
        writeBack,
        config: { teamMappings },
        createdBy: actorId,
      })
      .returning(),
  );
}

/** Attach the shared `member@example.com` user to an org as an active member actor. */
async function addMatchableMember(orgId: string): Promise<string> {
  return addMember(db, schema, orgId, memberUserId, 'member');
}

/** A fresh mock work-graph connector + a full pull of its snapshot. */
async function pull(): Promise<{
  connector: WorkGraphConnector;
  snapshot: WorkGraphSnapshot;
  mock: MockConnector;
}> {
  const mock = new MockConnector({ provider: 'linear' });
  const connector = mock.asWorkGraph();
  if (!connector) throw new Error('mock linear connector must be work-graph capable');
  const snapshot = await connector.pullWorkGraph({ externalTeamIds: [] });
  return { connector, snapshot, mock };
}

/** Load the single linked task for an integration by its provider external id. */
async function taskByExternal(integrationId: string, externalId: string) {
  const rows = await db
    .select()
    .from(schema.task)
    .where(
      and(
        eq(schema.task.sourceIntegrationId, integrationId),
        eq(schema.task.externalId, externalId),
      ),
    );
  return rows[0];
}

/**
 * Load an integration's mirrored projects/cycles by external id.
 *
 * @remarks
 * The tests share one pglite (no per-test reset), so every lookup MUST be scoped to the
 * integration — an `externalId`-only filter would match rows other tests seeded.
 */
async function projectByExternal(integrationId: string, externalId: string) {
  return db
    .select()
    .from(schema.project)
    .where(
      and(
        eq(schema.project.sourceIntegrationId, integrationId),
        eq(schema.project.externalId, externalId),
      ),
    );
}
async function cycleByExternal(integrationId: string, externalId: string) {
  return db
    .select()
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.sourceIntegrationId, integrationId),
        eq(schema.cycle.externalId, externalId),
      ),
    );
}

/** This integration's linked-row counts across task/project/cycle. */
async function linkedCounts(
  integrationId: string,
): Promise<{ tasks: number; projects: number; cycles: number }> {
  const [tasks, projects, cycles] = await Promise.all([
    db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(eq(schema.task.sourceIntegrationId, integrationId)),
    db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(eq(schema.project.sourceIntegrationId, integrationId)),
    db
      .select({ id: schema.cycle.id })
      .from(schema.cycle)
      .where(eq(schema.cycle.sourceIntegrationId, integrationId)),
  ]);
  return { tasks: tasks.length, projects: projects.length, cycles: cycles.length };
}

describe('planWorkItemReconcile', () => {
  const D = (iso: string) => new Date(iso);
  const item = (over: Record<string, unknown> = {}) =>
    ({
      externalId: 'x',
      identifier: 'X-1',
      title: 't',
      stateType: 'unstarted',
      stateName: 'Todo',
      priority: 'none',
      labelExternalIds: [],
      externalTeamId: 'team',
      url: 'u',
      updatedAt: '2026-01-02T00:00:00.000Z',
      ...over,
    }) as Parameters<typeof planWorkItemReconcile>[1];

  it('inserts a brand-new external item', () => {
    expect(planWorkItemReconcile(undefined, item(), { writeBack: true })).toBe('insert');
  });
  it('ignores a tombstone for an item we never had', () => {
    expect(planWorkItemReconcile(undefined, item({ removed: true }), { writeBack: true })).toBe(
      'noop',
    );
  });
  it('never archives on mere absence', () => {
    const local = {
      updatedAt: D('2026-01-01T00:00:00.000Z'),
      externalUpdatedAt: D('2026-01-01T00:00:00.000Z'),
    };
    expect(planWorkItemReconcile(local, undefined, { writeBack: true })).toBe('noop');
  });
  it('archives on an explicit tombstone', () => {
    const local = {
      updatedAt: D('2026-01-01T00:00:00.000Z'),
      externalUpdatedAt: D('2026-01-01T00:00:00.000Z'),
    };
    expect(planWorkItemReconcile(local, item({ removed: true }), { writeBack: true })).toBe(
      'archive',
    );
  });
  it('pulls a newer provider onto a clean local', () => {
    const local = {
      updatedAt: D('2026-01-01T00:00:00.000Z'),
      externalUpdatedAt: D('2026-01-01T00:00:00.000Z'),
    };
    expect(
      planWorkItemReconcile(local, item({ updatedAt: '2026-02-01T00:00:00.000Z' }), {
        writeBack: true,
      }),
    ).toBe('pull');
  });
  it('leaves a dirty local for the push phase when the provider has not changed', () => {
    const local = {
      updatedAt: D('2026-03-01T00:00:00.000Z'),
      externalUpdatedAt: D('2026-01-01T00:00:00.000Z'),
    };
    expect(
      planWorkItemReconcile(local, item({ updatedAt: '2026-01-01T00:00:00.000Z' }), {
        writeBack: true,
      }),
    ).toBe('noop');
  });
  it('both-changed → newer wins (remote)', () => {
    const local = {
      updatedAt: D('2026-02-01T00:00:00.000Z'),
      externalUpdatedAt: D('2026-01-01T00:00:00.000Z'),
    };
    expect(
      planWorkItemReconcile(local, item({ updatedAt: '2026-03-01T00:00:00.000Z' }), {
        writeBack: true,
      }),
    ).toBe('pull');
  });
  it('a read-only mirror never lets a dirty local win — it yields to the newer provider', () => {
    const local = {
      updatedAt: D('2026-02-01T00:00:00.000Z'),
      externalUpdatedAt: D('2026-01-01T00:00:00.000Z'),
    };
    expect(
      planWorkItemReconcile(local, item({ updatedAt: '2026-03-01T00:00:00.000Z' }), {
        writeBack: false,
      }),
    ).toBe('pull');
  });
});

describe('reconcileWorkGraph', () => {
  /** Seed an org + Core team, a matched member, and a both-teams-mapped integration. */
  async function scaffold(writeBack = false) {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    await addMatchableMember(orgId);
    const row = await seedIntegration(
      orgId,
      humanActorId,
      [
        { externalTeamId: 'lin-team-eng', teamId },
        { externalTeamId: 'lin-team-ops', teamId },
      ],
      writeBack,
    );
    return { orgId, teamId, humanActorId, row };
  }

  it('backfills projects, cycles, labels, and tasks with correct FKs and joins', async () => {
    const { orgId, teamId, humanActorId, row } = await scaffold();
    const { connector, snapshot } = await pull();

    const result = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot,
      connector,
      now: NOW,
    });

    expect(result.labels.created).toBe(3);
    expect(result.projects.created).toBe(2);
    expect(result.cycles.created).toBe(2);
    // 6 live issues insert; issue-7 is a tombstone with no local row → skipped, never inserted.
    expect(result.tasks.created).toBe(6);
    expect(result.tasks.skipped).toBe(1);

    // Project + cycle linkage on issue-1.
    const issue1 = await taskByExternal(row.id, 'lin-issue-1');
    const activeProject = one(await projectByExternal(row.id, 'lin-project-active'));
    const activeCycle = one(await cycleByExternal(row.id, 'lin-cycle-active'));
    expect(issue1?.projectId).toBe(activeProject.id);
    expect(issue1?.cycleId).toBe(activeCycle.id);
    expect(issue1?.teamId).toBe(teamId);
    expect(issue1?.state).toBe('in_progress'); // started → team's started-type key

    // Matched assignee resolves; unmatched assignee stays null (never a fallback).
    const memberActorRows = await db
      .select({ id: schema.externalActor.actorId })
      .from(schema.externalActor)
      .where(
        and(
          eq(schema.externalActor.integrationId, row.id),
          eq(schema.externalActor.externalId, 'lin-user-member'),
        ),
      );
    expect(issue1?.assigneeId).toBe(memberActorRows[0]?.id);
    const issue3 = await taskByExternal(row.id, 'lin-issue-3');
    expect(issue3?.assigneeId).toBeNull();

    // Completed issue carries the completed-type state + a completedAt; estimate rounded.
    const issue5 = await taskByExternal(row.id, 'lin-issue-5');
    expect(issue5?.state).toBe('done');
    expect(issue5?.completedAt).not.toBeNull();
    expect(issue5?.estimate).toBe(3);

    // Parent linkage (pass B).
    const issue4 = await taskByExternal(row.id, 'lin-issue-4');
    expect(issue4?.parentTaskId).toBe(issue3?.id);

    // Label joins: issue-1 → [Bug]; issue-2 → [Chore, Needs Design].
    const issue2 = await taskByExternal(row.id, 'lin-issue-2');
    const links = await db
      .select({ taskId: schema.taskLabel.taskId })
      .from(schema.taskLabel)
      .where(eq(schema.taskLabel.organizationId, orgId));
    expect(links.filter((l) => l.taskId === issue1?.id)).toHaveLength(1);
    expect(links.filter((l) => l.taskId === issue2?.id)).toHaveLength(2);

    // Cycle status derives from dates: active window straddles NOW; the ops cycle is complete.
    expect(activeCycle.status).toBe('active');
    const doneCycle = one(await cycleByExternal(row.id, 'lin-cycle-done'));
    expect(doneCycle.status).toBe('completed');
  });

  it('echo-guard: an immediate second reconcile writes nothing', async () => {
    const { orgId, humanActorId, row } = await scaffold();
    const first = await pull();
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: first.snapshot,
      connector: first.connector,
      now: NOW,
    });

    const second = await pull();
    const result = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: second.snapshot,
      connector: second.connector,
      now: NOW,
    });

    const writes = (['labels', 'projects', 'cycles', 'tasks'] as const).reduce(
      (n, k) => n + result[k].created + result[k].updated + result[k].removed + result[k].pushed,
      0,
    );
    expect(writes).toBe(0);
  });

  it('heals a legacy identifier-keyed task by re-keying it to the UUID (no duplicate)', async () => {
    const { orgId, teamId, humanActorId, row } = await scaffold();
    // A migration-era row keyed on the human identifier rather than the provider UUID.
    const legacy = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Legacy title',
          teamId,
          state: 'todo',
          source: 'linked',
          sourceIntegrationId: row.id,
          externalId: 'ENG-1', // the identifier of lin-issue-1
          sourceSyncMode: 'mirror',
          createdBy: humanActorId,
        })
        .returning({ id: schema.task.id }),
    );

    const { connector, snapshot } = await pull();
    await reconcileWorkGraph({ orgId, actorId: humanActorId, row, snapshot, connector, now: NOW });

    // Exactly one row for issue-1, and it is the SAME row (re-keyed, not duplicated).
    const rekeyed = await db
      .select()
      .from(schema.task)
      .where(
        and(eq(schema.task.sourceIntegrationId, row.id), eq(schema.task.externalId, 'lin-issue-1')),
      );
    expect(rekeyed).toHaveLength(1);
    expect(rekeyed[0]?.id).toBe(legacy.id);
    // The old identifier key is gone.
    const stale = await db.select().from(schema.task).where(eq(schema.task.externalId, 'ENG-1'));
    expect(stale).toHaveLength(0);
  });

  it('LWW: a newer provider overwrites a stale local; a dirty local is preserved read-only', async () => {
    const { orgId, humanActorId, row } = await scaffold();
    const first = await pull();
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: first.snapshot,
      connector: first.connector,
      now: NOW,
    });

    // Make issue-2 look STALE (clean + old anchor) → the provider is newer → overwrite.
    const issue2 = await taskByExternal(row.id, 'lin-issue-2');
    await db
      .update(schema.task)
      .set({
        title: 'STALE',
        updatedAt: new Date('2020-01-01T00:00:00.000Z'),
        externalUpdatedAt: new Date('2020-01-01T00:00:00.000Z'),
      })
      .where(eq(schema.task.id, issue2!.id));
    const second = await pull();
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: second.snapshot,
      connector: second.connector,
      now: NOW,
    });
    expect((await taskByExternal(row.id, 'lin-issue-2'))?.title).toBe(
      'Audit label mapping edge cases',
    );

    // Now make issue-3 DIRTY (edited after its anchor) → a read-only mirror must not touch it.
    const issue3 = await taskByExternal(row.id, 'lin-issue-3');
    await db
      .update(schema.task)
      .set({ title: 'LOCAL EDIT', updatedAt: new Date('2030-01-01T00:00:00.000Z') })
      .where(eq(schema.task.id, issue3!.id));
    const third = await pull();
    const res = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: third.snapshot,
      connector: third.connector,
      now: NOW,
    });
    expect((await taskByExternal(row.id, 'lin-issue-3'))?.title).toBe('LOCAL EDIT');
    expect(res.tasks.updated).toBe(0);
  });

  it('archives a task on tombstone and cancels a project on removal (never deletes)', async () => {
    const { orgId, teamId, humanActorId, row } = await scaffold();
    const first = await pull();
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: first.snapshot,
      connector: first.connector,
      now: NOW,
    });

    // Seed a live local row for the tombstoned issue-7 so the tombstone has something to archive.
    await db.insert(schema.task).values({
      organizationId: orgId,
      title: 'Spike',
      teamId,
      state: 'todo',
      source: 'linked',
      sourceIntegrationId: row.id,
      externalId: 'lin-issue-7',
      sourceSyncMode: 'mirror',
      externalUpdatedAt: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
      createdBy: humanActorId,
    });

    // A snapshot that tombstones a previously-live project as well.
    const base = await pull();
    const snapshot: WorkGraphSnapshot = {
      ...base.snapshot,
      projects: base.snapshot.projects.map((p) =>
        p.externalId === 'lin-project-active'
          ? { ...p, removed: true, updatedAt: '2026-03-01T00:00:00.000Z' }
          : p,
      ),
    };
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot,
      connector: base.connector,
      now: NOW,
    });

    const archived = await taskByExternal(row.id, 'lin-issue-7');
    expect(archived?.archivedAt).not.toBeNull();
    expect(archived?.state).toBe('canceled');

    const canceledProject = one(await projectByExternal(row.id, 'lin-project-active'));
    expect(canceledProject.status).toBe('canceled');
    // Never deleted: the row still exists.
    expect(canceledProject.id).toBeTruthy();
  });

  it('pushes a dirty task with the right state/priority/assignee omission, then no-ops', async () => {
    const { orgId, humanActorId, row } = await scaffold(true);
    const first = await pull();
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: first.snapshot,
      connector: first.connector,
      now: NOW,
    });

    // Dirty the unassigned issue-2 (title-only edit).
    const issue2 = await taskByExternal(row.id, 'lin-issue-2');
    await db
      .update(schema.task)
      .set({ title: 'Locally edited', updatedAt: new Date('2030-01-01T00:00:00.000Z') })
      .where(eq(schema.task.id, issue2!.id));

    const second = await pull();
    const res = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: second.snapshot,
      connector: second.connector,
      now: NOW,
    });
    expect(res.tasks.pushed).toBe(1);

    const pushed = second.mock.workItemPushLog.find(
      (op) => op.kind === 'update' && op.externalId === 'lin-issue-2',
    );
    expect(pushed).toBeDefined();
    if (pushed?.kind === 'update') {
      expect(pushed.fields.stateExternalId).toBe('lin-state-eng-todo');
      expect(pushed.fields.priority).toBe('high');
      expect(pushed.fields.assigneeExternalId).toBeUndefined(); // unassigned → omitted, not nulled
    }

    // The push stamped the echo anchors, so the next reconcile pushes nothing.
    const third = await pull();
    const again = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: third.snapshot,
      connector: third.connector,
      now: NOW,
    });
    expect(again.tasks.pushed).toBe(0);
  });

  it('skips items belonging to an unmapped external team entirely', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    await addMatchableMember(orgId);
    // Only Engineering is mapped; Ops is unmapped.
    const row = await seedIntegration(orgId, humanActorId, [
      { externalTeamId: 'lin-team-eng', teamId },
    ]);
    const { connector, snapshot } = await pull();

    const result = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot,
      connector,
      now: NOW,
    });

    // eng issues 1–4 insert; ops issues 5–6 skip; eng tombstone issue-7 skips.
    expect(result.tasks.created).toBe(4);
    expect(await taskByExternal(row.id, 'lin-issue-5')).toBeUndefined();
    expect(await taskByExternal(row.id, 'lin-issue-6')).toBeUndefined();
    // The ops-only cycle is skipped; the eng cycle is synced.
    const opsCycle = await cycleByExternal(row.id, 'lin-cycle-done');
    expect(opsCycle).toHaveLength(0);
  });

  it('is idempotent: running twice yields the same row counts', async () => {
    const { orgId, humanActorId, row } = await scaffold();
    const first = await pull();
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: first.snapshot,
      connector: first.connector,
      now: NOW,
    });
    const after1 = await linkedCounts(row.id);

    const second = await pull();
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: second.snapshot,
      connector: second.connector,
      now: NOW,
    });
    expect(await linkedCounts(row.id)).toEqual(after1);
  });
});
