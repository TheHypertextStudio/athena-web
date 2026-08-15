/**
 * `@docket/api` — label groups, re-scoping, and the label edit paths.
 *
 * @remarks
 * Covers the parts of the labels router that the first pass shipped without exercising: the group
 * PATCH surface, the empty-body no-ops, and the scope rules that tie a group to its members. Each
 * of these encodes a product decision that would be invisible if it regressed — a group silently
 * leaving its members behind, or an empty PATCH being treated as a delete of everything.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let labels!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  labels = (await import('../../src/routes/labels')).default;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** A manager-capability client for a freshly seeded org. */
async function seed(): Promise<{
  orgId: string;
  teamId: string;
  actorId: string;
  w: ReturnType<typeof appWithActor>;
}> {
  const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
  return {
    orgId,
    teamId,
    actorId: humanActorId,
    w: appWithActor(labels, orgId, ['manage'], humanActorId),
  };
}

/** Create a label through the router and return its id. */
async function mkLabel(
  w: ReturnType<typeof appWithActor>,
  name: string,
  groupId?: string,
): Promise<string> {
  const res = await w.request('/', {
    method: 'POST',
    headers: J,
    body: JSON.stringify({ name, ...(groupId ? { groupId } : {}) }),
  });
  expect(res.status).toBe(201);
  return (await body<{ id: string }>(res)).id;
}

/** Create a group through the router and return its id. */
async function mkGroup(
  w: ReturnType<typeof appWithActor>,
  name: string,
  exclusive?: boolean,
): Promise<string> {
  const res = await w.request('/groups', {
    method: 'POST',
    headers: J,
    body: JSON.stringify({ name, ...(exclusive === undefined ? {} : { exclusive }) }),
  });
  expect(res.status).toBe(201);
  return (await body<{ id: string }>(res)).id;
}

describe('label group updates', () => {
  it('renames, reorders, and toggles exclusivity', async () => {
    const { w } = await seed();
    const groupId = await mkGroup(w, 'Type');

    const patched = await w.request(`/groups/${groupId}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ name: '  Stage  ', exclusive: false, sortOrder: 3 }),
    });
    expect(patched.status).toBe(200);
    const out = await body<{ name: string; exclusive: boolean; sortOrder: number }>(patched);
    expect(out.name).toBe('Stage');
    expect(out.exclusive).toBe(false);
    expect(out.sortOrder).toBe(3);
  });

  it('treats an empty group PATCH as a read, not a wipe', async () => {
    // Drizzle rejects an empty `.set({})`, so this path re-reads instead — and must still enforce
    // the org-scoped existence check rather than returning whatever it was handed.
    const { w } = await seed();
    const groupId = await mkGroup(w, 'Type');
    const res = await w.request(`/groups/${groupId}`, { method: 'PATCH', headers: J, body: '{}' });
    expect(res.status).toBe(200);
    expect((await body<{ name: string }>(res)).name).toBe('Type');
  });

  it('404s an empty PATCH against an unknown group', async () => {
    const { w } = await seed();
    const res = await w.request(`/groups/${MISSING}`, { method: 'PATCH', headers: J, body: '{}' });
    expect(res.status).toBe(404);
  });

  it('404s a populated PATCH and a DELETE against an unknown group', async () => {
    const { w } = await seed();
    expect(
      (
        await w.request(`/groups/${MISSING}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect((await w.request(`/groups/${MISSING}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('carries its members with it when the group is limited to a team', async () => {
    // A group and its labels must share one scope, or a single-choice dimension would be split
    // across two pickers with no indication that it had been.
    const { teamId, w } = await seed();
    const groupId = await mkGroup(w, 'Type');
    const featureId = await mkLabel(w, 'feature', groupId);
    const bugId = await mkLabel(w, 'bug', groupId);
    const looseId = await mkLabel(w, 'unrelated');

    const res = await w.request(`/groups/${groupId}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ teamId }),
    });
    expect(res.status).toBe(200);

    const byId = new Map(
      (await db.select().from(schema.label)).map((r) => [r.id, r.teamId] as const),
    );
    expect(byId.get(featureId)).toBe(teamId);
    expect(byId.get(bugId)).toBe(teamId);
    // A label outside the group is untouched.
    expect(byId.get(looseId)).toBeNull();
  });
});

describe('label updates', () => {
  it('treats an empty PATCH as a read', async () => {
    const { w } = await seed();
    const id = await mkLabel(w, 'bug');
    const res = await w.request(`/${id}`, { method: 'PATCH', headers: J, body: '{}' });
    expect(res.status).toBe(200);
    expect((await body<{ name: string }>(res)).name).toBe('bug');
  });

  it('404s an empty PATCH against an unknown label', async () => {
    const { w } = await seed();
    const res = await w.request(`/${MISSING}`, { method: 'PATCH', headers: J, body: '{}' });
    expect(res.status).toBe(404);
  });

  it('409s a rename that collides case-insensitively, leaving merge as the way out', async () => {
    const { w } = await seed();
    await mkLabel(w, 'bug');
    const otherId = await mkLabel(w, 'bugs');
    const res = await w.request(`/${otherId}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ name: 'BUG' }),
    });
    expect(res.status).toBe(409);
  });

  it('lets a label keep its own name on an otherwise-empty rename', async () => {
    // The collision check must exclude the label being renamed, or recolouring by way of a PATCH
    // that re-sends the current name would 409 against itself.
    const { w } = await seed();
    const id = await mkLabel(w, 'bug');
    const res = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ name: 'bug', color: 'green' }),
    });
    expect(res.status).toBe(200);
    expect((await body<{ color: string }>(res)).color).toBe('green');
  });

  it('adopts the scope of the group it joins', async () => {
    const { teamId, w } = await seed();
    const groupId = await mkGroup(w, 'Type');
    await w.request(`/groups/${groupId}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ teamId }),
    });

    const id = await mkLabel(w, 'feature');
    const res = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ groupId }),
    });
    expect(res.status).toBe(200);
    expect((await body<{ teamId: string | null }>(res)).teamId).toBe(teamId);
  });

  it('promotes a team-limited label back to the whole workspace', async () => {
    const { teamId, w } = await seed();
    const id = await mkLabel(w, 'internal');
    await w.request(`/${id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ teamId }) });
    const res = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ teamId: null }),
    });
    expect(res.status).toBe(200);
    expect((await body<{ teamId: string | null }>(res)).teamId).toBeNull();
  });

  it('404s when joining a group that does not exist', async () => {
    const { w } = await seed();
    const id = await mkLabel(w, 'bug');
    const res = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ groupId: MISSING }),
    });
    expect(res.status).toBe(404);
  });
});

describe('label creation against a group', () => {
  it('404s on an unknown group', async () => {
    const { w } = await seed();
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'x', groupId: MISSING }),
    });
    expect(res.status).toBe(404);
  });

  it('409s on a team-limited group, since a new label is workspace-wide', async () => {
    const { teamId, w } = await seed();
    const groupId = await mkGroup(w, 'Type');
    await w.request(`/groups/${groupId}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ teamId }),
    });

    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'feature', groupId }),
    });
    expect(res.status).toBe(409);
  });
});

describe('merge edge cases', () => {
  it('404s when the surviving label does not exist', async () => {
    const { w } = await seed();
    const id = await mkLabel(w, 'bug');
    const res = await w.request(`/${id}/merge`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ intoId: MISSING }),
    });
    expect(res.status).toBe(404);
  });

  it('404s when the label being merged does not exist', async () => {
    const { w } = await seed();
    const target = await mkLabel(w, 'bug');
    const res = await w.request(`/${MISSING}/merge`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ intoId: target }),
    });
    expect(res.status).toBe(404);
  });
});
