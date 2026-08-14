/**
 * Resolving a task's per-team workflow state onto its canonical type.
 *
 * @remarks
 * The point of `stateType` is that `state` cannot be compared across teams. Two teams can call the
 * same stage `doing` and `in_flight`, and one team can rename `in_progress` to something else on a
 * Tuesday — so a reader that keys a status glyph off the stored key gets it wrong the moment
 * anybody edits a workflow. These tests seed two teams with deliberately unfamiliar keys and check
 * that the type still comes out right, which is the only property worth having here.
 *
 * The batching test is not a micro-optimisation check. `list_work` returns a page spanning
 * arbitrarily many teams, and resolving per row would turn one read into fifty-one.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { listWork } from '../../src/mcp/list-work';
import { stateOptionsOf, stateTypeOf, teamWorkflows } from '../../src/mcp/workflow-states';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

afterEach(() => {
  resetAuthMocks();
});

/** A team whose workflow uses names nobody would guess a type from. */
const RENAMED_STATES = [
  { key: 'icebox', name: 'Icebox', type: 'backlog' as const, position: 0 },
  { key: 'queued', name: 'Queued', type: 'unstarted' as const, position: 1 },
  { key: 'doing', name: 'Doing', type: 'started' as const, position: 2 },
  { key: 'shipped', name: 'Shipped', type: 'completed' as const, position: 3 },
  { key: 'dropped', name: 'Dropped', type: 'canceled' as const, position: 4 },
];

/** A second team that spells the same stages differently. */
const OTHER_STATES = [
  { key: 'todo', name: 'Todo', type: 'unstarted' as const, position: 0 },
  { key: 'in_progress', name: 'In progress', type: 'started' as const, position: 1 },
  { key: 'done', name: 'Done', type: 'completed' as const, position: 2 },
];

/** Seed an org with two teams on different workflows. */
async function seedTeams(): Promise<{
  orgId: string;
  renamed: string;
  other: string;
  actorId: string;
}> {
  const slug = `ws-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;

  const [renamed] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Renamed',
      key: `R${Math.random().toString(36).slice(2, 6)}`,
      workflowStates: RENAMED_STATES,
    })
    .returning({ id: schema.team.id });

  const [other] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Other',
      key: `O${Math.random().toString(36).slice(2, 6)}`,
      workflowStates: OTHER_STATES,
    })
    .returning({ id: schema.team.id });

  const [author] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada' })
    .returning({ id: schema.actor.id });

  return {
    orgId,
    renamed: assertDefined(renamed).id,
    other: assertDefined(other).id,
    actorId: assertDefined(author).id,
  };
}

describe('teamWorkflows', () => {
  it('maps every key a team defines onto its canonical type', async () => {
    const { orgId, renamed } = await seedTeams();
    const types = await teamWorkflows(orgId, [renamed]);

    expect(stateTypeOf(types, renamed, 'icebox')).toBe('backlog');
    expect(stateTypeOf(types, renamed, 'queued')).toBe('unstarted');
    expect(stateTypeOf(types, renamed, 'doing')).toBe('started');
    expect(stateTypeOf(types, renamed, 'shipped')).toBe('completed');
    expect(stateTypeOf(types, renamed, 'dropped')).toBe('canceled');
  });

  it('keeps two teams that reuse a stage apart', async () => {
    const { orgId, renamed, other } = await seedTeams();
    const types = await teamWorkflows(orgId, [renamed, other]);

    // The whole reason the type exists: 'doing' and 'in_progress' are the same stage under
    // different names, and neither team's key means anything to the other.
    expect(stateTypeOf(types, renamed, 'doing')).toBe('started');
    expect(stateTypeOf(types, other, 'in_progress')).toBe('started');
    // A key belonging to the other team's workflow resolves to nothing, rather than leaking across.
    expect(stateTypeOf(types, other, 'doing')).toBeUndefined();
    expect(stateTypeOf(types, renamed, 'in_progress')).toBeUndefined();
  });

  it('loads each team once however many rows name it', async () => {
    const { orgId, renamed, other } = await seedTeams();
    // A fifty-row page across two teams: the map is keyed by team, so the work is bounded by the
    // number of distinct teams and not by the page size.
    const perRow = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? renamed : other));
    const types = await teamWorkflows(orgId, perRow);

    expect(types.size).toBe(2);
  });

  it('returns nothing for a team in another org', async () => {
    const first = await seedTeams();
    const second = await seedTeams();
    // Scoped by org as well as id, so a team id guessed from elsewhere cannot be resolved.
    const types = await teamWorkflows(second.orgId, [first.renamed]);

    expect(stateTypeOf(types, first.renamed, 'doing')).toBeUndefined();
  });

  it('skips the lookup entirely when there is nothing to resolve', async () => {
    const { orgId } = await seedTeams();
    const types = await teamWorkflows(orgId, []);

    expect(types.size).toBe(0);
  });

  it('reaches the wire on every listed task, keyed off the type and not the name', async () => {
    const { orgId, renamed, other, actorId } = await seedTeams();
    await db.insert(schema.task).values([
      {
        organizationId: orgId,
        title: 'Doing it',
        teamId: renamed,
        state: 'doing',
        createdBy: actorId,
      },
      {
        organizationId: orgId,
        title: 'Iced',
        teamId: renamed,
        state: 'icebox',
        createdBy: actorId,
      },
      {
        organizationId: orgId,
        title: 'Underway',
        teamId: other,
        state: 'in_progress',
        createdBy: actorId,
      },
      // A state the owning team no longer lists, which must come back with no type at all.
      {
        organizationId: orgId,
        title: 'Orphaned',
        teamId: other,
        state: 'retired',
        createdBy: actorId,
      },
    ]);

    const rows = await listWork(orgId, 'task', {}, 50, undefined);
    const byTitle = new Map(rows.map((row) => [row.title, row]));

    // Two different keys, one type: this is the comparison the free-form key cannot support.
    expect(byTitle.get('Doing it')?.stateType).toBe('started');
    expect(byTitle.get('Underway')?.stateType).toBe('started');
    expect(byTitle.get('Iced')?.stateType).toBe('backlog');
    expect(byTitle.get('Orphaned')?.stateType).toBeUndefined();

    // The team's own name for the state still travels, because that is what a person reads.
    expect(byTitle.get('Doing it')?.state).toBe('doing');
    expect(byTitle.get('Underway')?.state).toBe('in_progress');

    // teamId is read to resolve the type and deliberately not published.
    expect(byTitle.get('Doing it')).not.toHaveProperty('teamId');
  });

  it('hands back the team’s own states, in board order, for a picker to offer', async () => {
    const { orgId, renamed } = await seedTeams();
    const workflows = await teamWorkflows(orgId, [renamed]);

    // Board order, not insertion order: a picker that listed "Dropped" above "Doing" would be
    // offering the workflow backwards.
    expect(stateOptionsOf(workflows, renamed).map((state) => state.key)).toEqual([
      'icebox',
      'queued',
      'doing',
      'shipped',
      'dropped',
    ]);
    // Nothing to offer beats a guessed list — `update` would reject an invented key anyway, and
    // the person would have watched a control do nothing.
    expect(stateOptionsOf(workflows, 'team_that_does_not_exist')).toEqual([]);
    expect(stateOptionsOf(workflows, null)).toEqual([]);
  });

  it('resolves nothing rather than guessing when the key left the workflow', async () => {
    const { orgId, renamed } = await seedTeams();
    const types = await teamWorkflows(orgId, [renamed]);

    // A task can outlive the state it sits in. No glyph is correct here; a guessed one is not.
    expect(stateTypeOf(types, renamed, 'retired_stage')).toBeUndefined();
    expect(stateTypeOf(types, renamed, null)).toBeUndefined();
    expect(stateTypeOf(types, null, 'doing')).toBeUndefined();
  });
});
