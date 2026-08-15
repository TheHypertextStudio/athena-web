/**
 * `@docket/api` — the workspace-statuses router.
 *
 * @remarks
 * The interesting behaviour here is what the router refuses. A status set that has lost its only
 * way to finish work, or its only place for work that has not ended, is one the rest of the
 * product silently misbehaves against — completing a task would have nowhere to go, a connector
 * mirroring an abandoned item would have nothing to map onto. So every one of those refusals is
 * exercised, along with the delete that moves work rather than blocking on it.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let statuses!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  statuses = (await import('../../src/routes/work-statuses')).default;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };

interface StatusOut {
  id: string;
  key: string;
  name: string;
  category: string;
  position: number;
  isDefault: boolean;
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

/** A manager-capability client for a freshly seeded workspace. */
async function seed(capabilities: string[] = ['manage']) {
  const base = await seedBaseOrg(db, schema);
  return { ...base, w: appWithActor(statuses, base.orgId, capabilities, base.humanActorId) };
}

/** One resolved set from the list endpoint. */
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

describe('reading the sets', () => {
  it('returns a set for every kind of work a workspace tracks', async () => {
    const { w } = await seed(['view']);
    const res = await w.request('/');
    expect(res.status).toBe(200);
    const payload = await body<{ items: SetOut[] }>(res);
    expect(payload.items.map((set) => set.entityType).sort()).toEqual([
      'initiative',
      'program',
      'project',
      'task',
    ]);
  });

  it('orders a set by category, then by position within it', async () => {
    const { w } = await seed();
    const program = await readSet(w, 'program');
    expect(program.statuses.map((status) => status.category)).toEqual([
      'backlog',
      'started',
      'started',
      'completed',
      'canceled',
    ]);
    const started = program.statuses.filter((status) => status.category === 'started');
    expect(started.map((status) => status.position)).toEqual([0, 1]);
  });

  it('names exactly one status as where new work starts', async () => {
    const { w } = await seed();
    for (const entityType of ['task', 'project', 'program', 'initiative']) {
      const set = await readSet(w, entityType);
      expect(set.statuses.filter((status) => status.isDefault)).toHaveLength(1);
    }
  });
});

describe('adding a status', () => {
  it('derives a stable key from the name', async () => {
    const { w } = await seed();
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ entityType: 'task', name: 'In Review', category: 'started' }),
    });
    expect(res.status).toBe(200);
    expect((await body<StatusOut>(res)).key).toBe('in_review');
  });

  it('keeps the key unique when two names slugify the same way', async () => {
    const { w } = await seed();
    const make = (name: string) =>
      w.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ entityType: 'task', name, category: 'started' }),
      });
    const first = await body<StatusOut>(await make('In Review'));
    const second = await body<StatusOut>(await make('in review'));
    expect(second.key).not.toBe(first.key);
  });

  it('places a new status after the others sharing its category', async () => {
    const { w } = await seed();
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ entityType: 'task', name: 'In Review', category: 'started' }),
    });
    expect((await body<StatusOut>(res)).position).toBe(1);
  });

  it('refuses a team scope on work a team does not own', async () => {
    const { w, teamId } = await seed();
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ entityType: 'project', teamId, name: 'Blocked', category: 'started' }),
    });
    expect(res.status).toBe(422);
  });

  it('refuses a contributor', async () => {
    const { w } = await seed(['contribute']);
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ entityType: 'task', name: 'In Review', category: 'started' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('changing a status', () => {
  it('renames without touching the key every row stores', async () => {
    const { w } = await seed();
    const before = (await readSet(w, 'task')).statuses.filter((s) => s.key === 'in_progress');
    const target = one(before);
    const res = await w.request(`/${target.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ name: 'Doing' }),
    });
    expect(res.status).toBe(200);
    const after = await body<StatusOut>(res);
    expect(after.name).toBe('Doing');
    expect(after.key).toBe('in_progress');
  });

  it('records completion on work already sitting in a status moved to completed', async () => {
    const { w, orgId, teamId, statusId } = await seed();
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Carried along',
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    );

    const res = await w.request(`/${statusId('task', 'todo')}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ category: 'completed' }),
    });
    expect(res.status).toBe(200);

    const after = one(
      await db
        .select({ completedAt: schema.task.completedAt })
        .from(schema.task)
        .where(eq(schema.task.id, taskRow.id)),
    );
    expect(after.completedAt).not.toBeNull();
  });

  it('moves the default rather than allowing two', async () => {
    const { w, statusId } = await seed();
    const res = await w.request(`/${statusId('task', 'done')}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ isDefault: true }),
    });
    expect(res.status).toBe(200);
    const set = await readSet(w, 'task');
    expect(set.statuses.filter((status) => status.isDefault).map((status) => status.key)).toEqual([
      'done',
    ]);
  });

  it('refuses a status from another workspace', async () => {
    const { w } = await seed();
    const res = await w.request(`/${MISSING}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('reordering a set', () => {
  it('rewrites the order within a category', async () => {
    const { w } = await seed();
    const added = await body<StatusOut>(
      await w.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ entityType: 'task', name: 'In Review', category: 'started' }),
      }),
    );
    const set = await readSet(w, 'task');
    const reordered = set.statuses.map((status) => status.id);
    const from = reordered.indexOf(added.id);
    const lifted = reordered.splice(from, 1)[0];
    if (lifted === undefined) throw new Error('nothing to move');
    reordered.splice(from - 1, 0, lifted);

    const res = await w.request('/reorder', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ entityType: 'task', order: reordered }),
    });
    expect(res.status).toBe(200);
    const after = await body<SetOut>(res);
    const started = after.statuses.filter((status) => status.category === 'started');
    expect(started[0]?.key).toBe('in_review');
  });

  it('refuses an order that omits a status', async () => {
    const { w, statusId } = await seed();
    const res = await w.request('/reorder', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ entityType: 'task', order: [statusId('task', 'todo')] }),
    });
    expect(res.status).toBe(422);
  });

  it('refuses an order that splits one category into two runs', async () => {
    const { w } = await seed();
    // A second started status, so a category exists that an order could actually split.
    await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ entityType: 'task', name: 'In Review', category: 'started' }),
    });
    const set = await readSet(w, 'task');
    const idOf = (key: string): string => {
      const found = set.statuses.find((status) => status.key === key);
      if (!found) throw new Error(`no seeded status ${key}`);
      return found.id;
    };
    // `done` sits between the two started statuses, so `started` appears twice.
    const split = [
      idOf('backlog'),
      idOf('todo'),
      idOf('in_progress'),
      idOf('done'),
      idOf('in_review'),
      idOf('canceled'),
    ];
    const res = await w.request('/reorder', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ entityType: 'task', order: split }),
    });
    expect(res.status).toBe(422);
  });
});

describe('a team that keeps its own statuses', () => {
  it('is listed alongside the workspace sets, so one read answers for the whole workspace', async () => {
    const { w, orgId, teamId } = await seed();
    // Stand in for a fork: a team-owned set the workspace read has to surface.
    await db.insert(schema.workStatus).values([
      {
        organizationId: orgId,
        teamId,
        entityType: 'task',
        key: 'doing',
        name: 'Doing',
        category: 'started',
        position: 0,
        isDefault: true,
      },
      {
        organizationId: orgId,
        teamId,
        entityType: 'task',
        key: 'shipped',
        name: 'Shipped',
        category: 'completed',
        position: 0,
      },
    ]);

    const res = await w.request('/');
    expect(res.status).toBe(200);
    const payload = await body<{ items: SetOut[] }>(res);
    const teamSet = payload.items.find((set) => set.teamId === teamId);
    expect(teamSet?.forked).toBe(true);
    expect(teamSet?.statuses.map((status) => status.key)).toEqual(['doing', 'shipped']);
    // The workspace's own sets are still there, unshadowed by the team's.
    expect(payload.items.filter((set) => set.teamId === null)).toHaveLength(4);
  });

  it('refuses a team-scoped status on a team that still follows the workspace', async () => {
    const { w, teamId } = await seed();
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        entityType: 'task',
        teamId,
        name: 'Blocked',
        category: 'started',
      }),
    });
    // One team-scoped row would otherwise become that team's entire set and strand every task.
    expect(res.status).toBe(409);
  });
});

describe('deleting a status', () => {
  it('moves the work on it to the replacement', async () => {
    const { w, orgId, teamId, statusId } = await seed();
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Needs a new home',
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    );

    const res = await w.request(
      `/${statusId('task', 'todo')}?remapTo=${statusId('task', 'backlog')}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(200);
    expect((await body<{ remappedCount: number }>(res)).remappedCount).toBe(1);

    const after = one(
      await db
        .select({ state: schema.task.state, statusId: schema.task.statusId })
        .from(schema.task)
        .where(eq(schema.task.id, taskRow.id)),
    );
    expect(after.state).toBe('backlog');
    expect(after.statusId).toBe(statusId('task', 'backlog'));
  });

  it('refuses to remove the only way to finish work', async () => {
    const { w, statusId } = await seed();
    const res = await w.request(
      `/${statusId('task', 'done')}?remapTo=${statusId('task', 'todo')}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(409);
  });

  it('refuses to remove the only way to abandon work', async () => {
    const { w, statusId } = await seed();
    const res = await w.request(
      `/${statusId('task', 'canceled')}?remapTo=${statusId('task', 'todo')}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(409);
  });

  it('refuses to remove where new work starts', async () => {
    const { w, statusId } = await seed();
    const res = await w.request(
      `/${statusId('task', 'backlog')}?remapTo=${statusId('task', 'todo')}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(409);
  });

  it('refuses a replacement from another set', async () => {
    const { w, statusId } = await seed();
    const res = await w.request(
      `/${statusId('task', 'todo')}?remapTo=${statusId('project', 'planned')}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(422);
  });

  it('refuses to move the work onto the status being deleted', async () => {
    const { w, statusId } = await seed();
    const res = await w.request(
      `/${statusId('task', 'todo')}?remapTo=${statusId('task', 'todo')}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(422);
  });
});
