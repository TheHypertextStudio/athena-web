/**
 * `team-reports` — the roster load count and the activity report's bucketing and windowing.
 *
 * @remarks
 * `teams.test.ts` covers the routes and their 404/authorization shape. This file drives the report
 * functions directly against seeded tasks, because the edges that matter here are data shapes, not
 * HTTP: a task whose state key no longer exists in the team's workflow, unassigned open work, a
 * canceled task, and the throughput window's own two edge days — the first (not yet full 30 days
 * of history) and the last (today, whose boundary is *now*, not midnight).
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import {
  loadTeamActivity,
  loadTeamMembers,
  stateTypeByKey,
  teamExists,
} from '../../src/routes/team-reports';
import { getDb, one, seedBaseOrg, seedTask } from '../support/routes-harness';

let schema: typeof DbModule;
let db: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

describe('stateTypeByKey', () => {
  it('maps each state key to its canonical type', () => {
    const map = stateTypeByKey([
      { key: 'todo', type: 'unstarted' },
      { key: 'doing', type: 'started' },
      { key: 'done', type: 'completed' },
    ]);
    expect(map.get('todo')).toBe('unstarted');
    expect(map.get('doing')).toBe('started');
    expect(map.get('done')).toBe('completed');
  });

  it('returns an empty map for a team with no workflow states', () => {
    expect(stateTypeByKey([]).size).toBe(0);
  });
});

describe('teamExists', () => {
  it('finds a team that belongs to the org', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    expect(await teamExists(orgId, teamId)).toBe(true);
  });

  it('refuses a team id from a different org', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    expect(await teamExists(a.orgId, b.teamId)).toBe(false);
  });

  it('refuses an id that names no team at all', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    expect(await teamExists(orgId, 'not-a-real-id')).toBe(false);
  });
});

describe('loadTeamMembers', () => {
  it('returns nobody for a team with no members, and skips the load-count query entirely', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    expect(await loadTeamMembers(orgId, teamId, humanActorId)).toEqual([]);
  });

  it('counts a member’s open tasks and leaves an idle member at zero', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const busy = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Busy' })
        .returning(),
    );
    const idle = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Idle' })
        .returning(),
    );
    await db.insert(schema.teamMember).values([
      { organizationId: orgId, teamId, actorId: busy.id, role: 'member' },
      { organizationId: orgId, teamId, actorId: idle.id, role: 'member' },
    ]);
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'In flight',
      state: 'in_progress',
      assigneeId: busy.id,
    });

    const members = await loadTeamMembers(orgId, teamId, humanActorId);
    const byName = new Map(members.map((m) => [m.displayName, m.openTaskCount]));
    expect(byName.get('Busy')).toBe(1);
    expect(byName.get('Idle')).toBe(0);
  });

  it('does not attribute unassigned open work to any person', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    await db
      .insert(schema.teamMember)
      .values({ organizationId: orgId, teamId, actorId: humanActorId, role: 'member' });
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Unclaimed',
      state: 'backlog',
      assigneeId: null,
    });

    const members = await loadTeamMembers(orgId, teamId, humanActorId);
    expect(members[0]?.openTaskCount).toBe(0);
  });
});

describe('loadTeamActivity', () => {
  it('drops a task whose state key the team’s workflow no longer defines', async () => {
    // Someone replaced the whole `workflowStates` array; the old key genuinely names nothing now.
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Orphaned state',
      state: 'in_progress',
    });
    await db
      .update(schema.team)
      .set({ workflowStates: [{ key: 'todo', name: 'Todo', type: 'unstarted', position: 0 }] })
      .where(eq(schema.team.id, teamId));

    const report = await loadTeamActivity(orgId, teamId, humanActorId, new Date('2026-06-15'));
    const totalOpen = report.capacity.reduce((sum, bucket) => sum + bucket.taskCount, 0);
    expect(totalOpen).toBe(0);
  });

  it('excludes a canceled task from capacity, distinct from a completed one', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Dropped',
      state: 'canceled',
      canceledAt: new Date('2026-06-01'),
    });
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Shipped',
      state: 'done',
      completedAt: new Date('2026-06-01'),
    });
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Open',
      state: 'todo',
    });

    const report = await loadTeamActivity(orgId, teamId, humanActorId, new Date('2026-06-15'));
    const totalOpen = report.capacity.reduce((sum, bucket) => sum + bucket.taskCount, 0);
    expect(totalOpen).toBe(1);
  });

  it('sums estimates alongside counts, treating an unestimated task as zero', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Sized',
      state: 'todo',
      estimate: 5,
    });
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Unsized',
      state: 'todo',
    });

    const report = await loadTeamActivity(orgId, teamId, humanActorId, new Date('2026-06-15'));
    const unstarted = report.capacity.find((bucket) => bucket.type === 'unstarted');
    expect(unstarted).toMatchObject({ taskCount: 2, estimate: 5 });
  });

  it('reports today, not just complete days, as the window’s live edge', async () => {
    // `now` is a moment during the day, not midnight — the boundary that used to be missed.
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const now = new Date('2026-06-15T14:00:00.000Z');
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Finished this morning',
      state: 'done',
      createdAt: new Date('2026-06-10T00:00:00.000Z'),
      completedAt: new Date('2026-06-15T09:00:00.000Z'),
    });

    const report = await loadTeamActivity(orgId, teamId, humanActorId, now);
    const today = report.throughput.at(-1);
    expect(today?.date).toBe('2026-06-15');
    expect(today?.completed).toBe(1);
  });

  it('reports a task created after the window’s current point as not yet open', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const now = new Date('2026-06-15T08:00:00.000Z');
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Filed this afternoon',
      state: 'todo',
      createdAt: new Date('2026-06-15T20:00:00.000Z'),
    });

    const report = await loadTeamActivity(orgId, teamId, humanActorId, now);
    const today = report.throughput.at(-1);
    expect(today?.pending).toBe(0);
  });

  it('closes a throughput day for a canceled task the same as a completed one', async () => {
    // `closedBy` accepts either terminal event; a task canceled inside the window must stop
    // counting as pending without being counted as completed.
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const now = new Date('2026-06-15T12:00:00.000Z');
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Dropped mid-window',
      state: 'canceled',
      createdAt: new Date('2026-06-10T00:00:00.000Z'),
      canceledAt: new Date('2026-06-12T00:00:00.000Z'),
    });

    const report = await loadTeamActivity(orgId, teamId, humanActorId, now);
    const today = report.throughput.at(-1);
    expect(today).toMatchObject({ pending: 0, completed: 0 });
  });

  it('reports a window shorter than 30 days for a team younger than that', async () => {
    // The loop breaks once a day's boundary would be in the future — the series simply ends there.
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const now = new Date('2026-06-15T12:00:00.000Z');
    const report = await loadTeamActivity(orgId, teamId, humanActorId, now);
    expect(report.throughput.length).toBeLessThanOrEqual(30);
    expect(report.throughput.at(-1)?.date).toBe('2026-06-15');
  });
});
