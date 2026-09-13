import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let statuses!: unknown;
let forkRouter!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const router = await import('../../src/routes/work-statuses');
  statuses = router.default;
  forkRouter = router.teamStatusFork;
});

const J = { 'content-type': 'application/json' };

interface StatusOut {
  id: string;
  category: string;
  position: number;
}
interface SetOut {
  entityType: string;
  teamId: string | null;
  forked: boolean;
  statuses: StatusOut[];
}

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function seed(capabilities: string[] = ['manage']) {
  const base = await seedBaseOrg(db, schema);
  return {
    ...base,
    w: appWithActor(statuses, base.orgId, capabilities, base.humanActorId),
    teams: appWithActor(forkRouter, base.orgId, capabilities, base.humanActorId),
  };
}

async function readSet(
  w: ReturnType<typeof appWithActor>,
  entityType: string,
  teamId?: string,
): Promise<SetOut> {
  const query = teamId === undefined ? '' : `&teamId=${teamId}`;
  const res = await w.request(`/?entityType=${entityType}${query}`);
  expect(res.status).toBe(200);
  const payload = await body<{ items: SetOut[] }>(res);
  return one(payload.items);
}

describe('giving a team its own task statuses', () => {
  it('copies the workspace set and brings the team’s tasks with it', async () => {
    const { teams, orgId, teamId, statusId } = await seed();
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Rides along',
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    );

    const res = await teams.request(`/${teamId}/statuses/fork`, { method: 'POST' });
    expect(res.status).toBe(200);
    const set = await body<SetOut>(res);
    expect(set.forked).toBe(true);
    expect(set.teamId).toBe(teamId);

    // The task keeps its key, and so its meaning, while pointing at the team's own copy.
    const after = one(
      await db
        .select({ state: schema.task.state, statusId: schema.task.statusId })
        .from(schema.task)
        .where(eq(schema.task.id, taskRow.id)),
    );
    expect(after.state).toBe('todo');
    expect(after.statusId).not.toBe(statusId('task', 'todo'));
    expect(set.statuses.map((status) => status.id)).toContain(after.statusId);
  });

  it('refuses a team belonging to another workspace', async () => {
    const { teams } = await seed();
    const elsewhere = await seedBaseOrg(db, schema);
    const res = await teams.request(`/${elsewhere.teamId}/statuses/fork`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('refuses a team that already keeps its own', async () => {
    const { teams, teamId } = await seed();
    expect((await teams.request(`/${teamId}/statuses/fork`, { method: 'POST' })).status).toBe(200);
    const again = await teams.request(`/${teamId}/statuses/fork`, { method: 'POST' });
    expect(again.status).toBe(409);
  });

  it('refuses a contributor', async () => {
    const { teams, teamId } = await seed(['contribute']);
    const res = await teams.request(`/${teamId}/statuses/fork`, { method: 'POST' });
    expect(res.status).toBe(403);
  });
});

describe('putting a team back on the workspace statuses', () => {
  it('returns the team’s work to the status of the same key', async () => {
    const { teams, orgId, teamId, statusId } = await seed();
    await teams.request(`/${teamId}/statuses/fork`, { method: 'POST' });
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Goes home',
          state: 'todo',
          statusId: one(
            await db
              .select({ id: schema.workStatus.id })
              .from(schema.workStatus)
              .where(and(eq(schema.workStatus.teamId, teamId), eq(schema.workStatus.key, 'todo'))),
          ).id,
        })
        .returning({ id: schema.task.id }),
    );

    const res = await teams.request(`/${teamId}/statuses/fork`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const after = one(
      await db
        .select({ state: schema.task.state, statusId: schema.task.statusId })
        .from(schema.task)
        .where(eq(schema.task.id, taskRow.id)),
    );
    expect(after.state).toBe('todo');
    expect(after.statusId).toBe(statusId('task', 'todo'));
  });

  it('falls back to a workspace status of the same category when the key is gone', async () => {
    const { teams, orgId, teamId, statusId } = await seed();
    await teams.request(`/${teamId}/statuses/fork`, { method: 'POST' });

    // A key the workspace set has never heard of, which is what a team rename produces.
    const invented = one(
      await db
        .insert(schema.workStatus)
        .values({
          organizationId: orgId,
          teamId,
          entityType: 'task',
          key: 'in_review',
          name: 'In Review',
          category: 'started',
          position: 5,
        })
        .returning({ id: schema.workStatus.id }),
    );
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Lands by category',
          state: 'in_review',
          statusId: invented.id,
        })
        .returning({ id: schema.task.id }),
    );

    const res = await teams.request(`/${teamId}/statuses/fork`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const after = one(
      await db
        .select({ state: schema.task.state, statusId: schema.task.statusId })
        .from(schema.task)
        .where(eq(schema.task.id, taskRow.id)),
    );
    // Nothing in the workspace set carries `in_review`, so it lands on the workspace status
    // sharing its category rather than on whatever happens to be first.
    expect(after.statusId).toBe(statusId('task', 'in_progress'));
    expect(after.state).toBe('in_progress');
  });

  it('refuses a team that follows the workspace already', async () => {
    const { teams, teamId } = await seed();
    const res = await teams.request(`/${teamId}/statuses/fork`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('a forked team’s set stands on its own', () => {
  it('reorders within the team’s set and reports it as forked', async () => {
    const { w, teams, teamId } = await seed();
    const forked = await body<SetOut>(
      await teams.request(`/${teamId}/statuses/fork`, { method: 'POST' }),
    );
    const started = forked.statuses.filter((status) => status.category === 'started');
    const others = forked.statuses.filter((status) => status.category !== 'started');

    // Adding a second started status gives the category something to reorder.
    const extra = await body<StatusOut>(
      await w.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({
          entityType: 'task',
          teamId,
          name: 'In Review',
          category: 'started',
        }),
      }),
    );

    const reordered = [
      ...others.filter((status) => status.category === 'backlog').map((status) => status.id),
      ...others.filter((status) => status.category === 'unstarted').map((status) => status.id),
      extra.id,
      ...started.map((status) => status.id),
      ...others
        .filter((status) => status.category === 'completed' || status.category === 'canceled')
        .map((status) => status.id),
    ];

    const res = await w.request('/reorder', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ entityType: 'task', teamId, order: reordered }),
    });
    expect(res.status).toBe(200);
    const set = await body<SetOut>(res);
    expect(set.forked).toBe(true);
    expect(set.teamId).toBe(teamId);
    const startedAfter = set.statuses.filter((status) => status.category === 'started');
    expect(startedAfter[0]?.id).toBe(extra.id);
    expect(startedAfter.map((status) => status.position)).toEqual([0, 1]);
  });

  it('leaves the workspace set untouched when the team reorders', async () => {
    const { w, teams, teamId, statusId } = await seed();
    await teams.request(`/${teamId}/statuses/fork`, { method: 'POST' });
    const workspaceBefore = await readSet(w, 'task');

    const teamSet = await readSet(w, 'task', teamId);
    await w.request('/reorder', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        entityType: 'task',
        teamId,
        order: teamSet.statuses.map((status) => status.id),
      }),
    });

    const workspaceAfter = await readSet(w, 'task');
    expect(workspaceAfter.statuses.map((status) => status.id)).toEqual(
      workspaceBefore.statuses.map((status) => status.id),
    );
    expect(workspaceAfter.forked).toBe(false);
    expect(statusId('task', 'todo')).toBeTruthy();
  });
});

describe('moving a container status across the terminal boundary', () => {
  it('keeps the work on it and changes what that work counts as', async () => {
    const { w, orgId, statusId } = await seed();
    const row = one(
      await db
        .insert(schema.program)
        .values({
          organizationId: orgId,
          name: 'Ongoing',
          status: 'paused',
          statusId: statusId('program', 'paused'),
        })
        .returning({ id: schema.program.id }),
    );

    // A Program can complete, so a workspace may decide Paused ends one.
    const res = await w.request(`/${statusId('program', 'paused')}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ category: 'completed' }),
    });
    expect(res.status).toBe(200);
    expect((await body<StatusOut>(res)).category).toBe('completed');

    const after = one(
      await db
        .select({ status: schema.program.status, statusId: schema.program.statusId })
        .from(schema.program)
        .where(eq(schema.program.id, row.id)),
    );
    // The row stays where it was; only the meaning of that status changed.
    expect(after.status).toBe('paused');
    expect(after.statusId).toBe(statusId('program', 'paused'));
  });
});
