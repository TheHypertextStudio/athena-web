import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';
import type teamsRouter from '../../src/routes/teams';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let teams!: typeof teamsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  teams = (await import('../../src/routes/teams')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** A unique team key per call (keeps the shared PGlite org-key index collision-free). */
function uniqueKey(): string {
  return `K${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// A valid ULID-shaped id that no seeded row uses (passes branded-id validation, 404s on lookup).
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

interface TeamBody {
  id: string;
  name: string;
  key: string;
  description: string | null;
  workflowStates: { key: string; name: string; type: string; position: number }[];
  triageEnabled: boolean;
  agentGuidance: string | null;
  archivedAt?: string;
}

describe('teams router', () => {
  it('lists, creates with defaults, gets detail, patches every branch, soft-deletes', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(teams, orgId, ['manage'], humanActorId);

    // seedBaseOrg already inserts one team ('Core'); the list reflects it.
    const initial = await writer.request('/', { method: 'GET' });
    expect(initial.status).toBe(200);
    expect((await json<{ items: unknown[] }>(initial)).items).toHaveLength(1);

    // Create with defaults (no workflowStates / triageEnabled / agentGuidance supplied).
    const key = uniqueKey();
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Engineering', key }),
    });
    expect(created.status).toBe(200);
    const team = await json<TeamBody>(created);
    expect(team.key).toBe(key);
    expect(team.triageEnabled).toBe(true); // default
    expect(team.description).toBeNull();
    expect(team.agentGuidance).toBeNull();
    // Default workflow seeded (5 canonical states, backlog first).
    expect(team.workflowStates).toHaveLength(5);
    expect(team.workflowStates[0]?.key).toBe('backlog');

    // List now has both teams.
    const listed = await writer.request('/', { method: 'GET' });
    expect((await json<{ items: unknown[] }>(listed)).items).toHaveLength(2);

    // Get detail by id.
    const got = await writer.request(`/${team.id}`, { method: 'GET' });
    expect(got.status).toBe(200);
    expect((await json<TeamBody>(got)).id).toBe(team.id);

    // Patch every settable branch, incl. replacing workflowStates + approvalRouting.
    const newKey = uniqueKey();
    const patched = await writer.request(`/${team.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Engineering v2',
        key: newKey,
        description: 'The eng team',
        triageEnabled: false,
        agentGuidance: 'be careful',
        approvalRouting: { mode: 'role', approverRoleId: humanActorId },
        workflowStates: [
          { key: 'open', name: 'Open', type: 'unstarted', position: 0 },
          { key: 'closed', name: 'Closed', type: 'completed', position: 1 },
        ],
      }),
    });
    expect(patched.status).toBe(200);
    const after = await json<TeamBody>(patched);
    expect(after.name).toBe('Engineering v2');
    expect(after.key).toBe(newKey);
    expect(after.description).toBe('The eng team');
    expect(after.triageEnabled).toBe(false);
    expect(after.workflowStates).toHaveLength(2);

    // Soft-delete returns { id, archivedAt }.
    const deleted = await writer.request(`/${team.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    const delBody = await json<{ id: string; archivedAt: string }>(deleted);
    expect(delBody.id).toBe(team.id);
    expect(typeof delBody.archivedAt).toBe('string');

    // The archived team disappears from list + 404s on get.
    const afterList = await writer.request('/', { method: 'GET' });
    expect((await json<{ items: unknown[] }>(afterList)).items).toHaveLength(1);
    expect((await writer.request(`/${team.id}`, { method: 'GET' })).status).toBe(404);
  });

  it('create with explicit workflowStates + description + triage off + null agentGuidance', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(teams, orgId, ['manage'], humanActorId);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Design',
        key: uniqueKey(),
        description: 'Design team',
        triageEnabled: false,
        agentGuidance: null,
        approvalRouting: { mode: 'assigner' },
        workflowStates: [{ key: 'wip', name: 'WIP', type: 'started', position: 0 }],
      }),
    });
    expect(created.status).toBe(200);
    const team = await json<TeamBody>(created);
    expect(team.triageEnabled).toBe(false);
    expect(team.description).toBe('Design team');
    expect(team.workflowStates).toHaveLength(1);
  });

  it('409s on create with a key already used in the org', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(teams, orgId, ['manage'], humanActorId);
    const key = uniqueKey();
    const first = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'First', key }),
    });
    expect(first.status).toBe(200);
    const dup = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Dup', key }),
    });
    expect(dup.status).toBe(409);
  });

  it('409s on patch that collides with another team key (and allows same-key self-patch)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(teams, orgId, ['manage'], humanActorId);
    const keyA = uniqueKey();
    const keyB = uniqueKey();
    const a = await json<TeamBody>(
      await writer.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'A', key: keyA }),
      }),
    );
    await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B', key: keyB }),
    });

    // Patching A to B's key collides → 409.
    const collide = await writer.request(`/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: keyB }),
    });
    expect(collide.status).toBe(409);

    // Patching A to its OWN key is allowed (exceptId excludes self).
    const self = await writer.request(`/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: keyA, name: 'A2' }),
    });
    expect(self.status).toBe(200);
    expect((await json<TeamBody>(self)).name).toBe('A2');
  });

  it('patches with an empty body as a no-op (200, row unchanged)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(teams, orgId, ['manage'], humanActorId);
    const key = uniqueKey();
    const created = await json<TeamBody>(
      await writer.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'NoOp', key }),
      }),
    );
    const res = await writer.request(`/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const after = await json<TeamBody>(res);
    expect(after.id).toBe(created.id);
    expect(after.name).toBe('NoOp');
    expect(after.key).toBe(key);
  });

  it('404s on an empty-body patch of a missing team', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(teams, orgId, ['manage'], humanActorId);
    const res = await writer.request(`/${MISSING_ULID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('isolates tenants: a team in another org is invisible (404 / not listed)', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const writerA = appWithActor(teams, a.orgId, ['manage'], a.humanActorId);
    const createdInA = await json<TeamBody>(
      await writerA.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'OnlyA', key: uniqueKey() }),
      }),
    );

    // Org B's actor cannot see A's team.
    const writerB = appWithActor(teams, b.orgId, ['manage'], b.humanActorId);
    expect((await writerB.request(`/${createdInA.id}`, { method: 'GET' })).status).toBe(404);
    expect(
      (
        await writerB.request(`/${createdInA.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'hijack' }),
        })
      ).status,
    ).toBe(404);
    expect((await writerB.request(`/${createdInA.id}`, { method: 'DELETE' })).status).toBe(404);

    // Reusing A's key in org B is allowed (uniqueness is per-org).
    const reuse = await writerB.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'AlsoOnlyA', key: createdInA.key }),
    });
    expect(reuse.status).toBe(200);
  });

  it('403s on create/patch/delete for a view-only actor', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(teams, orgId, ['view']);
    expect(
      (
        await viewer.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x', key: uniqueKey() }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await viewer.request(`/${MISSING_ULID}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(403);
    expect((await viewer.request(`/${MISSING_ULID}`, { method: 'DELETE' })).status).toBe(403);

    // A view-only actor CAN list (read capability).
    expect((await viewer.request('/', { method: 'GET' })).status).toBe(200);
  });

  it('404s on get/patch/delete of a missing id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(teams, orgId, ['manage'], humanActorId);
    expect((await writer.request(`/${MISSING_ULID}`, { method: 'GET' })).status).toBe(404);
    expect(
      (
        await writer.request(`/${MISSING_ULID}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect((await writer.request(`/${MISSING_ULID}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('422s on invalid create bodies (missing key, empty name, bad workflow state)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(teams, orgId, ['manage'], humanActorId);

    // Missing key.
    expect(
      (
        await writer.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'NoKey' }),
        })
      ).status,
    ).toBe(422);

    // Empty name.
    expect(
      (
        await writer.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: '', key: uniqueKey() }),
        })
      ).status,
    ).toBe(422);

    // Invalid workflow-state type.
    expect(
      (
        await writer.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'BadWf',
            key: uniqueKey(),
            workflowStates: [{ key: 'x', name: 'X', type: 'nope', position: 0 }],
          }),
        })
      ).status,
    ).toBe(422);
  });
});
