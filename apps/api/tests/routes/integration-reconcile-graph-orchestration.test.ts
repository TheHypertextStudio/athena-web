import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type {
  ExternalWorkflowState,
  ExternalWorkItem,
  PullWorkGraphInput,
  WorkGraphConnector,
  WorkGraphSnapshot,
  WorkItemPushOp,
} from '@docket/integrations';

import type * as ReconcileGraph from '../../src/routes/integration-reconcile-graph';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

/**
 * Full-`reconcileWorkGraph` orchestration tests targeting the private helpers only reachable
 * through the orchestrator (`buildTeamResolver`'s legacy `listIds` path, `loadTeamStates`'
 * early-empty return, `diffTaskLabels`' removal branch, and `pushDirtyTasks`' `teamStates`
 * fallback) — every existing scenario in `integration-reconcile-graph.test.ts` seeds a
 * non-empty `config.teamMappings`, so the legacy routing path and the "team not in this run's
 * preload" push fallback are otherwise entirely untested.
 */
let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let reconcileWorkGraph!: typeof ReconcileGraph.reconcileWorkGraph;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  reconcileWorkGraph = (await import('../../src/routes/integration-reconcile-graph'))
    .reconcileWorkGraph;
});

const NOW = new Date('2026-07-02T12:00:00.000Z');

async function seedLegacyIntegration(
  orgId: string,
  actorId: string,
  config: Record<string, unknown>,
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
        config,
        createdBy: actorId,
      })
      .returning(),
  );
}

function emptySnapshot(): WorkGraphSnapshot {
  return { users: [], labels: [], projects: [], cycles: [], items: [] };
}

function workItem(over: Partial<ExternalWorkItem> = {}): ExternalWorkItem {
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

/** A minimal, fully-controllable fake `WorkGraphConnector`. */
function fakeConnector(input: {
  snapshot: WorkGraphSnapshot;
  teamStates?: ExternalWorkflowState[];
  pushResult?: { externalId: string; externalUpdatedAt: string };
}): { connector: WorkGraphConnector; pushCalls: WorkItemPushOp[] } {
  const pushCalls: WorkItemPushOp[] = [];
  return {
    pushCalls,
    connector: {
      pullWorkGraph: (_pullInput: PullWorkGraphInput) => Promise.resolve(input.snapshot),
      listTeamStates: () => Promise.resolve(input.teamStates ?? []),
      pushWorkItem: (op) => {
        pushCalls.push(op);
        return Promise.resolve(
          input.pushResult ?? { externalId: 'item-1', externalUpdatedAt: NOW.toISOString() },
        );
      },
    },
  };
}

async function taskRow(integrationId: string, externalId: string) {
  return one(
    await db
      .select()
      .from(schema.task)
      .where(
        and(
          eq(schema.task.sourceIntegrationId, integrationId),
          eq(schema.task.externalId, externalId),
        ),
      ),
  );
}

describe('legacy team routing (no config.teamMappings)', () => {
  it('honors config.listIds to include one external team and skip another', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLegacyIntegration(orgId, humanActorId, {
      teamId,
      listIds: ['ext-team-1'],
    });
    const snapshot: WorkGraphSnapshot = {
      ...emptySnapshot(),
      items: [
        workItem({ externalId: 'included', externalTeamId: 'ext-team-1' }),
        workItem({ externalId: 'excluded', externalTeamId: 'ext-team-2' }),
      ],
    };
    const { connector } = fakeConnector({ snapshot });

    const result = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot,
      connector,
      now: NOW,
    });

    expect(result.tasks.created).toBe(1);
    expect(result.tasks.skipped).toBe(1);
    const created = await taskRow(row.id, 'included');
    expect(created.teamId).toBe(teamId);
  });

  it('with no listIds at all, every external team routes to the configured single team', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLegacyIntegration(orgId, humanActorId, { teamId });
    const snapshot: WorkGraphSnapshot = {
      ...emptySnapshot(),
      items: [workItem({ externalId: 'any-team', externalTeamId: 'literally-anything' })],
    };
    const { connector } = fakeConnector({ snapshot });

    const result = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot,
      connector,
      now: NOW,
    });

    expect(result.tasks.created).toBe(1);
    const created = await taskRow(row.id, 'any-team');
    expect(created.teamId).toBe(teamId);
  });

  it('treats an explicit empty teamMappings array the same as absent (falls back to legacy routing)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLegacyIntegration(orgId, humanActorId, { teamId, teamMappings: [] });
    const snapshot: WorkGraphSnapshot = {
      ...emptySnapshot(),
      items: [workItem({ externalId: 'any-team-2', externalTeamId: 'whatever' })],
    };
    const { connector } = fakeConnector({ snapshot });

    const result = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot,
      connector,
      now: NOW,
    });

    expect(result.tasks.created).toBe(1);
  });
});

describe('reconcileWorkGraph — a same-name label already owned by another integration in the org', () => {
  it('preloads it as excluded-by-external-id but still name-scoped, without miscounting it as this integration’s', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLegacyIntegration(orgId, humanActorId, {
      teamMappings: [{ externalTeamId: 'ext-team-1', teamId }],
    });
    const otherRow = await seedLegacyIntegration(orgId, humanActorId, {
      teamMappings: [{ externalTeamId: 'ext-team-1', teamId }],
    });
    await db.insert(schema.label).values({
      organizationId: orgId,
      name: 'Bug',
      color: '#000000',
      sourceIntegrationId: otherRow.id,
      externalId: 'foreign-lbl',
    });
    const snapshot: WorkGraphSnapshot = {
      ...emptySnapshot(),
      // Workspace-level (no externalTeamId) — same scope the foreign org-level label above
      // occupies (teamId: null), so their scope keys collide (`labelScopeKey(null, 'Bug')`).
      labels: [{ externalId: 'lbl-1', name: 'Bug', color: '#ff0000' }],
      items: [workItem({ labelExternalIds: ['lbl-1'] })],
    };
    const { connector } = fakeConnector({ snapshot });

    const result = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot,
      connector,
      now: NOW,
    });

    // The foreign label blocks adoption (same scope+name, owned elsewhere) — this integration's
    // label is skipped, never duplicated or misattributed to the other integration.
    expect(result.labels.skipped).toBe(1);
    expect(result.labels.created).toBe(0);
  });
});

describe('loadTeamStates — every snapshot entity on an unmapped team', () => {
  it('returns cleanly with no team-state preload when nothing in the snapshot resolves', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLegacyIntegration(orgId, humanActorId, {
      teamId,
      listIds: ['only-this-team'],
    });
    const snapshot: WorkGraphSnapshot = {
      ...emptySnapshot(),
      items: [workItem({ externalTeamId: 'not-the-allowed-team' })],
    };
    const { connector } = fakeConnector({ snapshot });

    const result = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot,
      connector,
      now: NOW,
    });

    expect(result.tasks.skipped).toBe(1);
    expect(result.tasks.created).toBe(0);
  });
});

describe('diffTaskLabels — a label removed at the provider is unlinked locally', () => {
  it('removes a stale task-label link on the next reconcile when the item drops the label', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLegacyIntegration(orgId, humanActorId, {
      teamMappings: [{ externalTeamId: 'ext-team-1', teamId }],
    });
    const withLabel: WorkGraphSnapshot = {
      ...emptySnapshot(),
      labels: [
        { externalId: 'lbl-1', name: 'Bug', color: '#ff0000', externalTeamId: 'ext-team-1' },
      ],
      items: [workItem({ labelExternalIds: ['lbl-1'] })],
    };
    const first = fakeConnector({ snapshot: withLabel });
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: withLabel,
      connector: first.connector,
      now: NOW,
    });
    const created = await taskRow(row.id, 'item-1');
    const linksBefore = await db
      .select()
      .from(schema.taskLabel)
      .where(eq(schema.taskLabel.taskId, created.id));
    expect(linksBefore).toHaveLength(1);

    // Second pass: the same label still exists (so it's still mirrored), but the item no
    // longer references it — the stale link must be diffed away.
    const withoutLabel: WorkGraphSnapshot = {
      ...emptySnapshot(),
      labels: withLabel.labels,
      items: [workItem({ labelExternalIds: [], updatedAt: '2026-07-03T00:00:00.000Z' })],
    };
    const second = fakeConnector({ snapshot: withoutLabel });
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: withoutLabel,
      connector: second.connector,
      now: new Date('2026-07-03T00:00:00.000Z'),
    });

    const linksAfter = await db
      .select()
      .from(schema.taskLabel)
      .where(eq(schema.taskLabel.taskId, created.id));
    expect(linksAfter).toHaveLength(0);
  });
});

describe('pushDirtyTasks — the teamStates() fallback for a team not preloaded this run', () => {
  it('pushes a dirty task whose team was not referenced by this snapshot, loading its states on demand', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLegacyIntegration(
      orgId,
      humanActorId,
      { teamMappings: [{ externalTeamId: 'ext-team-1', teamId }] },
      true, // writeBack
    );
    // First pass: create the linked task normally.
    const seedSnapshot: WorkGraphSnapshot = { ...emptySnapshot(), items: [workItem()] };
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: seedSnapshot,
      connector: fakeConnector({ snapshot: seedSnapshot }).connector,
      now: NOW,
    });
    const created = await taskRow(row.id, 'item-1');

    // Dirty it locally (edited after the last sync).
    await db
      .update(schema.task)
      .set({ title: 'Edited locally', updatedAt: new Date('2026-07-03T00:00:00.000Z') })
      .where(eq(schema.task.id, created.id));

    // Second pass: an EMPTY snapshot means `loadTeamStates` preloads nothing this run, so
    // `pushDirtyTasks` must fall back to `teamStates()` to resolve this team's states —
    // and the fake team-states list has no 'started'-type state, so `stateExternalId` is
    // omitted from the push rather than sent as undefined.
    const empty = emptySnapshot();
    const { connector, pushCalls } = fakeConnector({
      snapshot: empty,
      teamStates: [{ externalId: 'ext-state-done', name: 'Done', type: 'completed', position: 0 }],
    });

    const result = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: empty,
      connector,
      now: new Date('2026-07-04T00:00:00.000Z'),
    });

    expect(result.tasks.pushed).toBe(1);
    expect(pushCalls).toHaveLength(1);
    const op = pushCalls[0];
    expect(op?.kind).toBe('update');
    if (op?.kind === 'update') {
      expect(op.fields.title).toBe('Edited locally');
      expect(op.fields.stateExternalId).toBeUndefined(); // no matching external state -> omitted
    }
    const after = await taskRow(row.id, 'item-1');
    expect(after.lastPushedAt).not.toBeNull();
  });

  it('pushes assignee/dueDate/matched-state/mirrored-labels, caches per-team states across two dirty tasks, and skips a task with no externalListId', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLegacyIntegration(
      orgId,
      humanActorId,
      { teamMappings: [{ externalTeamId: 'ext-team-1', teamId }] },
      true, // writeBack
    );
    const seedSnapshot: WorkGraphSnapshot = {
      ...emptySnapshot(),
      labels: [
        { externalId: 'lbl-1', name: 'Bug', color: '#ff0000', externalTeamId: 'ext-team-1' },
      ],
      items: [
        workItem({ externalId: 'item-a', labelExternalIds: ['lbl-1'] }),
        workItem({ externalId: 'item-b' }),
        workItem({ externalId: 'item-c' }),
      ],
    };
    await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: seedSnapshot,
      connector: fakeConnector({ snapshot: seedSnapshot }).connector,
      now: NOW,
    });
    const taskA = await taskRow(row.id, 'item-a');
    const taskB = await taskRow(row.id, 'item-b');
    const taskC = await taskRow(row.id, 'item-c');

    // Give taskA an assignee (with a reverse external-actor mapping) and a due date, then
    // dirty both A and B; strip taskC's externalListId to exercise the skip branch.
    await db.insert(schema.externalActor).values({
      organizationId: orgId,
      integrationId: row.id,
      externalId: 'ext-user-1',
      displayName: 'Assignee',
      actorId: humanActorId,
      matchedBy: 'manual',
    });
    const dirtyAt = new Date('2026-07-03T00:00:00.000Z');
    await db
      .update(schema.task)
      .set({ assigneeId: humanActorId, dueDate: new Date('2026-08-01'), updatedAt: dirtyAt })
      .where(eq(schema.task.id, taskA.id));
    await db.update(schema.task).set({ updatedAt: dirtyAt }).where(eq(schema.task.id, taskB.id));
    await db
      .update(schema.task)
      .set({ externalListId: null, updatedAt: dirtyAt })
      .where(eq(schema.task.id, taskC.id));

    const empty = emptySnapshot();
    const { connector, pushCalls } = fakeConnector({
      snapshot: empty,
      teamStates: [
        { externalId: 'ext-state-started', name: 'In Progress', type: 'started', position: 0 },
      ],
    });

    const result = await reconcileWorkGraph({
      orgId,
      actorId: humanActorId,
      row,
      snapshot: empty,
      connector,
      now: new Date('2026-07-04T00:00:00.000Z'),
    });

    // taskC (no externalListId) is silently skipped — only A and B push.
    expect(result.tasks.pushed).toBe(2);
    expect(pushCalls).toHaveLength(2);

    const opA = pushCalls.find(
      (c): c is Extract<WorkItemPushOp, { kind: 'update' }> =>
        c.kind === 'update' && c.externalId === 'item-a',
    );
    expect(opA?.fields.assigneeExternalId).toBe('ext-user-1');
    expect(opA?.fields.dueDate).toBe('2026-08-01');
    expect(opA?.fields.stateExternalId).toBe('ext-state-started'); // matched this time
    expect(opA?.fields.labelExternalIds).toEqual(['lbl-1']); // backfilled from the DB, not the (empty) snapshot map

    const opB = pushCalls.find(
      (c): c is Extract<WorkItemPushOp, { kind: 'update' }> =>
        c.kind === 'update' && c.externalId === 'item-b',
    );
    expect(opB?.fields.assigneeExternalId).toBeUndefined();
  });
});
