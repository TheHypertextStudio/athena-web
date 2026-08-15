import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type {
  ExternalCycle,
  ExternalLabel,
  ExternalProject,
  ExternalWorkItem,
} from '@docket/integrations';

import type * as ReconcileGraph from '../../src/routes/integration-reconcile-graph';
import type * as WorkStatus from '../../src/lib/work-status';
import type { ResolvedStatus } from '../../src/lib/work-status';
import { ConflictError } from '../../src/error';
import { getDb, one, seedBaseOrg, seedStatus } from '../support/routes-harness';

/**
 * Direct unit tests for `integration-reconcile-graph.ts`'s exported single-entity appliers
 * (`applyLabel`/`applyProject`/`applyCycle`/`applyWorkItem`) — the "Slice-3b webhook applier"
 * seam the module documents as independently drivable outside a full snapshot. These target
 * branches `integration-reconcile-graph.test.ts`'s full-`reconcileWorkGraph` scenarios don't
 * reach: unmapped-team skips, tombstones-for-never-mirrored-rows no-ops, label rename/adopt/
 * collision, project/cycle literal-state mapping, and the state-resolution fallbacks.
 */
let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let applyLabel!: typeof ReconcileGraph.applyLabel;
let applyProject!: typeof ReconcileGraph.applyProject;
let applyCycle!: typeof ReconcileGraph.applyCycle;
let applyWorkItem!: typeof ReconcileGraph.applyWorkItem;
let loadStatusSets!: typeof WorkStatus.loadStatusSets;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/integration-reconcile-graph');
  applyLabel = mod.applyLabel;
  applyProject = mod.applyProject;
  applyCycle = mod.applyCycle;
  applyWorkItem = mod.applyWorkItem;
  ({ loadStatusSets } = await import('../../src/lib/work-status'));
});

const NOW = new Date('2026-07-02T12:00:00.000Z');
const OLD = new Date('2026-01-01T00:00:00.000Z');

function emptyTally() {
  return { created: 0, updated: 0, skipped: 0, removed: 0, pushed: 0 };
}

/**
 * The Task statuses a team resolves to — what the orchestrator preloads into `statesByTeam`.
 *
 * @remarks
 * A workspace names its own statuses, so a test driving an applier has to hand it the real set
 * rather than a literal: the row the applier writes stores both the key and the `status_id`, and
 * the composite foreign key refuses a pair the workspace does not define.
 */
async function teamTaskStatuses(orgId: string, teamId: string): Promise<readonly ResolvedStatus[]> {
  const sets = await loadStatusSets(orgId, { entityTypes: ['task'], teamIds: [teamId] });
  return sets.for('task', teamId);
}

/** Build a minimal, fully-overridable `GraphApplyContext`. */
async function baseCtx(
  orgId: string,
  actorId: string,
  integrationId: string,
  overrides: Partial<ReconcileGraph.GraphApplyContext> = {},
): Promise<ReconcileGraph.GraphApplyContext> {
  const sets = await loadStatusSets(orgId, { entityTypes: ['project'] });
  return {
    orgId,
    actorId,
    integrationId,
    writeBack: false,
    now: NOW,
    identityMap: new Map(),
    resolveTeam: () => undefined,
    statesByTeam: new Map(),
    projectStatuses: sets.for('project'),
    existingLabelsByExternal: new Map(),
    existingLabelsByScopeName: new Map(),
    existingProjectsByExternal: new Map(),
    existingCyclesByExternal: new Map(),
    existingTasksByExternal: new Map(),
    labelIdByExternal: new Map(),
    projectIdByExternal: new Map(),
    cycleIdByExternal: new Map(),
    taskIdByExternal: new Map(),
    result: {
      labels: emptyTally(),
      projects: emptyTally(),
      cycles: emptyTally(),
      tasks: emptyTally(),
    },
    ...overrides,
  };
}

async function seedIntegrationRow(orgId: string, actorId: string): Promise<string> {
  return one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'linear',
        pattern: 'connector',
        roles: ['work'],
        createdBy: actorId,
      })
      .returning({ id: schema.integration.id }),
  ).id;
}

function extLabel(over: Partial<ExternalLabel> = {}): ExternalLabel {
  return { externalId: 'lbl-1', name: 'Bug', color: '#ff0000', ...over };
}

function extProject(over: Partial<ExternalProject> = {}): ExternalProject {
  return {
    externalId: 'proj-1',
    name: 'Q3 Launch',
    state: 'started',
    url: 'https://linear.app/proj-1',
    updatedAt: NOW.toISOString(),
    externalTeamIds: ['ext-team-1'],
    ...over,
  };
}

function extCycle(over: Partial<ExternalCycle> = {}): ExternalCycle {
  return {
    externalId: 'cyc-1',
    externalTeamId: 'ext-team-1',
    number: 1,
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-06-08T00:00:00.000Z',
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

function extWorkItem(over: Partial<ExternalWorkItem> = {}): ExternalWorkItem {
  return {
    externalId: 'item-1',
    identifier: 'ENG-1',
    title: 'Fix the thing',
    stateType: 'started',
    stateName: 'In Progress',
    priority: 'medium',
    labelExternalIds: [],
    externalTeamId: 'ext-team-1',
    url: 'https://linear.app/item-1',
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

describe('applyLabel', () => {
  it('skips a team-scoped label whose team is unmapped', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId, { resolveTeam: () => undefined });
    await applyLabel(ctx, extLabel({ externalTeamId: 'unmapped-team' }));
    // A no-op — not even a tally bump, since the label was never even scoped.
    expect(ctx.result.labels).toEqual({
      created: 0,
      updated: 0,
      skipped: 0,
      removed: 0,
      pushed: 0,
    });
    expect(ctx.labelIdByExternal.size).toBe(0);
    const rows = await db.select().from(schema.label).where(eq(schema.label.organizationId, orgId));
    expect(rows).toHaveLength(0);
  });

  it('renames/recolors an already-linked label in place', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const existing = one(
      await db
        .insert(schema.label)
        .values({
          organizationId: orgId,
          name: 'Old name',
          color: '#000000',
          sourceIntegrationId: integrationId,
          externalId: 'lbl-1',
        })
        .returning(),
    );
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      existingLabelsByExternal: new Map([['lbl-1', existing]]),
    });
    await applyLabel(ctx, extLabel({ name: 'New name', color: '#123456' }));
    expect(ctx.result.labels.updated).toBe(1);
    const after = one(await db.select().from(schema.label).where(eq(schema.label.id, existing.id)));
    expect(after.name).toBe('New name');
    expect(after.color).toBe('#123456');
  });

  it('adopts a native (unlinked) label occupying the same scope+name', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const native = one(
      await db
        .insert(schema.label)
        .values({ organizationId: orgId, name: 'Bug', color: '#111111' })
        .returning(),
    );
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      existingLabelsByScopeName: new Map([['@org::Bug', native]]),
    });
    await applyLabel(ctx, extLabel({ color: '#ff0000' }));
    expect(ctx.result.labels.updated).toBe(1);
    expect(ctx.labelIdByExternal.get('lbl-1')).toBe(native.id);
    const after = one(await db.select().from(schema.label).where(eq(schema.label.id, native.id)));
    expect(after.sourceIntegrationId).toBe(integrationId);
    expect(after.externalId).toBe('lbl-1');
    expect(after.color).toBe('#ff0000');
  });

  it('skips (never duplicates) when a same-name label already belongs to another integration', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const otherIntegrationId = await seedIntegrationRow(orgId, humanActorId);
    const foreign = one(
      await db
        .insert(schema.label)
        .values({
          organizationId: orgId,
          name: 'Bug',
          color: '#111111',
          sourceIntegrationId: otherIntegrationId,
          externalId: 'other-lbl',
        })
        .returning(),
    );
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      existingLabelsByScopeName: new Map([['@org::Bug', foreign]]),
    });
    await applyLabel(ctx, extLabel());
    expect(ctx.result.labels.skipped).toBe(1);
    expect(ctx.labelIdByExternal.size).toBe(0);
  });

  it('lands a workspace-level label (no externalTeamId) org-wide (teamId: null)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId);
    await applyLabel(ctx, extLabel({ externalTeamId: undefined }));
    expect(ctx.result.labels.created).toBe(1);
    const created = one(
      await db
        .select()
        .from(schema.label)
        .where(eq(schema.label.sourceIntegrationId, integrationId)),
    );
    expect(created.teamId).toBeNull();
  });
});

describe('applyProject', () => {
  it('skips a project shared only with unmapped teams', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId);
    await applyProject(ctx, extProject({ externalTeamIds: ['unmapped'] }));
    expect(ctx.result.projects.skipped).toBe(1);
  });

  it('never materializes a tombstone for a project it never mirrored', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
    });
    await applyProject(ctx, extProject({ removed: true }));
    expect(ctx.result.projects.skipped).toBe(1);
    const rows = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.sourceIntegrationId, integrationId));
    expect(rows).toHaveLength(0);
  });

  it.each(['backlog', 'planned', 'paused'] as const)(
    "maps external state '%s' onto the planned status",
    async (state) => {
      const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
      const integrationId = await seedIntegrationRow(orgId, humanActorId);
      const ctx = await baseCtx(orgId, humanActorId, integrationId, {
        resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      });
      await applyProject(ctx, extProject({ state }));
      const created = one(
        await db
          .select()
          .from(schema.project)
          .where(eq(schema.project.sourceIntegrationId, integrationId)),
      );
      expect(created.status).toBe('planned');
    },
  );

  it('tallies updated (not removed) when a newer, non-tombstoned remote updates an existing project', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const existing = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Old name',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
          source: 'linked',
          sourceIntegrationId: integrationId,
          externalId: 'proj-1',
          createdBy: humanActorId,
          updatedAt: OLD,
          externalUpdatedAt: OLD,
        })
        .returning(),
    );
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      existingProjectsByExternal: new Map([['proj-1', existing]]),
    });
    await applyProject(ctx, extProject({ name: 'New name', updatedAt: NOW.toISOString() }));
    expect(ctx.result.projects.updated).toBe(1);
    expect(ctx.result.projects.removed).toBe(0);
    const after = one(
      await db.select().from(schema.project).where(eq(schema.project.id, existing.id)),
    );
    expect(after.name).toBe('New name');
  });

  it('maps a literal canceled external state onto the canceled status', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
    });
    await applyProject(ctx, extProject({ state: 'canceled' }));
    const created = one(
      await db
        .select()
        .from(schema.project)
        .where(eq(schema.project.sourceIntegrationId, integrationId)),
    );
    expect(created.status).toBe('canceled');
  });

  it('preserves a locally-dirty project when the remote has not changed since the anchor', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const existing = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Dirty locally',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
          source: 'linked',
          sourceIntegrationId: integrationId,
          externalId: 'proj-1',
          createdBy: humanActorId,
          updatedAt: new Date('2026-02-01T00:00:00.000Z'), // dirty vs the OLD anchor below
          externalUpdatedAt: OLD,
        })
        .returning(),
    );
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      existingProjectsByExternal: new Map([['proj-1', existing]]),
    });
    await applyProject(
      ctx,
      extProject({ name: 'Remote name (loses)', updatedAt: OLD.toISOString() }),
    );
    expect(ctx.result.projects.skipped).toBe(1);
    const after = one(
      await db.select().from(schema.project).where(eq(schema.project.id, existing.id)),
    );
    expect(after.name).toBe('Dirty locally');
  });

  it('tallies removed (not updated) when a newer remote tombstones an existing mirrored project', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const existing = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Still active',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
          source: 'linked',
          sourceIntegrationId: integrationId,
          externalId: 'proj-1',
          createdBy: humanActorId,
          updatedAt: OLD,
          externalUpdatedAt: OLD,
        })
        .returning(),
    );
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      existingProjectsByExternal: new Map([['proj-1', existing]]),
    });
    await applyProject(ctx, extProject({ removed: true, updatedAt: NOW.toISOString() }));
    expect(ctx.result.projects.removed).toBe(1);
    expect(ctx.result.projects.updated).toBe(0);
    const after = one(
      await db.select().from(schema.project).where(eq(schema.project.id, existing.id)),
    );
    expect(after.status).toBe('canceled');
  });
});

describe('applyCycle', () => {
  it('skips a cycle on an unmapped team', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId);
    await applyCycle(ctx, extCycle());
    expect(ctx.result.cycles.skipped).toBe(1);
  });

  it('never materializes a tombstone for a cycle it never mirrored', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
    });
    await applyCycle(ctx, extCycle({ removed: true }));
    expect(ctx.result.cycles.skipped).toBe(1);
    const rows = await db
      .select()
      .from(schema.cycle)
      .where(eq(schema.cycle.sourceIntegrationId, integrationId));
    expect(rows).toHaveLength(0);
  });

  it("derives 'upcoming' status for a cycle window that hasn't started yet", async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      now: new Date('2026-01-01T00:00:00.000Z'), // before the cycle's window
    });
    await applyCycle(
      ctx,
      extCycle({ startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-08T00:00:00.000Z' }),
    );
    const created = one(
      await db
        .select()
        .from(schema.cycle)
        .where(eq(schema.cycle.sourceIntegrationId, integrationId)),
    );
    expect(created.status).toBe('upcoming');
  });

  it('preserves a locally-dirty cycle when the remote has not changed since the anchor', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const existing = one(
      await db
        .insert(schema.cycle)
        .values({
          organizationId: orgId,
          teamId,
          number: 1,
          name: 'Dirty locally',
          startsAt: new Date('2026-06-01T00:00:00.000Z'),
          endsAt: new Date('2026-06-08T00:00:00.000Z'),
          source: 'linked',
          sourceIntegrationId: integrationId,
          externalId: 'cyc-1',
          createdBy: humanActorId,
          updatedAt: new Date('2026-02-01T00:00:00.000Z'), // dirty vs the OLD anchor below
          externalUpdatedAt: OLD,
        })
        .returning(),
    );
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      existingCyclesByExternal: new Map([['cyc-1', existing]]),
    });
    await applyCycle(ctx, extCycle({ name: 'Remote name (loses)', updatedAt: OLD.toISOString() }));
    expect(ctx.result.cycles.skipped).toBe(1);
    const after = one(await db.select().from(schema.cycle).where(eq(schema.cycle.id, existing.id)));
    expect(after.name).toBe('Dirty locally');
  });

  it('tallies removed when a newer remote tombstones an existing mirrored cycle', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const existing = one(
      await db
        .insert(schema.cycle)
        .values({
          organizationId: orgId,
          teamId,
          number: 1,
          startsAt: new Date('2026-06-01T00:00:00.000Z'),
          endsAt: new Date('2026-06-08T00:00:00.000Z'),
          source: 'linked',
          sourceIntegrationId: integrationId,
          externalId: 'cyc-1',
          createdBy: humanActorId,
          updatedAt: OLD,
          externalUpdatedAt: OLD,
        })
        .returning(),
    );
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      existingCyclesByExternal: new Map([['cyc-1', existing]]),
    });
    await applyCycle(ctx, extCycle({ removed: true, updatedAt: NOW.toISOString() }));
    expect(ctx.result.cycles.removed).toBe(1);
    const after = one(await db.select().from(schema.cycle).where(eq(schema.cycle.id, existing.id)));
    expect(after.archivedAt).not.toBeNull();
  });

  it('tallies updated (not removed) when a newer, non-tombstoned remote updates an existing cycle', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const existing = one(
      await db
        .insert(schema.cycle)
        .values({
          organizationId: orgId,
          teamId,
          number: 1,
          name: 'Old name',
          startsAt: new Date('2026-06-01T00:00:00.000Z'),
          endsAt: new Date('2026-06-08T00:00:00.000Z'),
          source: 'linked',
          sourceIntegrationId: integrationId,
          externalId: 'cyc-1',
          createdBy: humanActorId,
          updatedAt: OLD,
          externalUpdatedAt: OLD,
        })
        .returning(),
    );
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      existingCyclesByExternal: new Map([['cyc-1', existing]]),
    });
    await applyCycle(ctx, extCycle({ name: 'New name', updatedAt: NOW.toISOString() }));
    expect(ctx.result.cycles.updated).toBe(1);
    expect(ctx.result.cycles.removed).toBe(0);
    const after = one(await db.select().from(schema.cycle).where(eq(schema.cycle.id, existing.id)));
    expect(after.name).toBe('New name');
  });
});

describe('applyWorkItem — state resolution fallbacks', () => {
  it("falls back to the team's first state when no state matches the item's type", async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    // Only 'canceled'-category statuses — the item's 'started' type matches none of them. The row
    // has to exist in the workspace's set for the key to be storable at all.
    const weirdId = await seedStatus(db, schema, {
      organizationId: orgId,
      entityType: 'task',
      teamId: null,
      key: 'weird',
      name: 'Weird',
      description: null,
      category: 'canceled',
      position: 1,
    });
    const oddStates: readonly ResolvedStatus[] = [
      {
        id: weirdId,
        key: 'weird',
        name: 'Weird',
        description: null,
        category: 'canceled',
        position: 1,
        isDefault: false,
        teamId: null,
      },
    ];
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      statesByTeam: new Map([[teamId, oddStates]]),
    });
    await applyWorkItem(ctx, extWorkItem({ stateType: 'started' }));
    expect(ctx.result.tasks.created).toBe(1);
    const created = one(
      await db.select().from(schema.task).where(eq(schema.task.sourceIntegrationId, integrationId)),
    );
    expect(created.state).toBe('weird');
  });

  it('throws a descriptive ConflictError when the team has no workflow states to map onto at all', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      statesByTeam: new Map(), // no entry for teamId -> itemColumns' `?? []` fallback
    });
    await expect(applyWorkItem(ctx, extWorkItem())).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws a descriptive ConflictError archiving a tombstoned item into a team with no states', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const start = one(await teamTaskStatuses(orgId, teamId));
    const existingTask = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Existing',
          state: start.key,
          statusId: start.id,
          source: 'linked',
          sourceIntegrationId: integrationId,
          externalId: 'item-1',
          updatedAt: OLD,
          externalUpdatedAt: OLD,
        })
        .returning(),
    );
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      existingTasksByExternal: new Map([['item-1', existingTask]]),
      statesByTeam: new Map(), // no entry -> archiveLinkedItem's `?? []` fallback
    });
    await expect(
      applyWorkItem(ctx, extWorkItem({ removed: true, updatedAt: NOW.toISOString() })),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('applyWorkItem — triage folding and implicit lifecycle stamps', () => {
  it("folds a 'triage' stateType into the team's backlog-type state", async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const states = await teamTaskStatuses(orgId, teamId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      statesByTeam: new Map([[teamId, states]]),
    });
    await applyWorkItem(ctx, extWorkItem({ stateType: 'triage' }));
    const created = one(
      await db.select().from(schema.task).where(eq(schema.task.sourceIntegrationId, integrationId)),
    );
    const backlogKey = one(states.filter((s) => s.category === 'backlog')).key;
    expect(created.state).toBe(backlogKey);
  });

  it('stamps completedAt from the reconcile anchor when the item carries no explicit timestamp', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      statesByTeam: new Map([[teamId, await teamTaskStatuses(orgId, teamId)]]),
      now: NOW,
    });
    await applyWorkItem(
      ctx,
      extWorkItem({ stateType: 'completed', updatedAt: NOW.toISOString(), completedAt: undefined }),
    );
    const created = one(
      await db.select().from(schema.task).where(eq(schema.task.sourceIntegrationId, integrationId)),
    );
    expect(created.completedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('stamps canceledAt from the reconcile anchor when the item carries no explicit timestamp', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegrationRow(orgId, humanActorId);
    const ctx = await baseCtx(orgId, humanActorId, integrationId, {
      resolveTeam: (id) => (id === 'ext-team-1' ? teamId : undefined),
      statesByTeam: new Map([[teamId, await teamTaskStatuses(orgId, teamId)]]),
      now: NOW,
    });
    await applyWorkItem(
      ctx,
      extWorkItem({ stateType: 'canceled', updatedAt: NOW.toISOString(), canceledAt: undefined }),
    );
    const created = one(
      await db.select().from(schema.task).where(eq(schema.task.sourceIntegrationId, integrationId)),
    );
    expect(created.canceledAt?.toISOString()).toBe(NOW.toISOString());
  });
});
