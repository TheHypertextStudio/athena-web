import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
// Routers loaded after env is set in the harness.
const r: Record<string, unknown> = {};

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  r['labels'] = (await import('./labels')).default;
  r['savedViews'] = (await import('./saved-views')).default;
  r['comments'] = (await import('./comments')).default;
  r['roles'] = (await import('./roles')).default;
  r['agents'] = (await import('./agents')).default;
  r['tasks'] = (await import('./tasks')).default;
  r['projects'] = (await import('./projects')).default;
  r['updates'] = (await import('./updates')).default;
  r['activity'] = (await import('./activity')).default;
  r['grants'] = (await import('./grants')).default;
  r['integrations'] = (await import('./integrations')).default;
  r['billing'] = (await import('./billing')).default;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('labels router', () => {
  it('CRUD + 403/404/422', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['labels'], orgId, ['contribute'], humanActorId);
    expect((await body<{ items: unknown[] }>(await w.request('/'))).items).toHaveLength(0);
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'bug', color: '#f00', group: 'type', teamId }),
    });
    expect(created.status).toBe(200);
    const id = (await body<{ id: string }>(created)).id;
    expect((await w.request(`/${id}`)).status).toBe(200);
    const patched = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ name: 'defect', color: '#0f0', group: null, teamId }),
    });
    expect(patched.status).toBe(200);
    expect((await w.request(`/${id}`, { method: 'DELETE' })).status).toBe(200);

    const v = appWithActor(r['labels'], orgId, ['view']);
    expect((await v.request('/', { method: 'POST', headers: J, body: '{}' })).status).toBe(403);
    expect((await w.request(`/${MISSING}`)).status).toBe(404);
    expect(
      (
        await w.request(`/${MISSING}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect((await w.request(`/${MISSING}`, { method: 'DELETE' })).status).toBe(404);
    expect(
      (await w.request('/', { method: 'POST', headers: J, body: JSON.stringify({ name: '' }) }))
        .status,
    ).toBe(422);
  });
});

describe('saved-views router', () => {
  it('CRUD with defaults + explicit fields + 403/404/422', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['savedViews'], orgId, ['contribute'], humanActorId);
    expect((await body<{ items: unknown[] }>(await w.request('/'))).items).toHaveLength(0);

    // Defaults path (scope/ownerActorId/filters/sort default).
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'My view' }),
    });
    expect(created.status).toBe(200);
    const id = (await body<{ id: string }>(created)).id;

    // Explicit fields path.
    const created2 = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        name: 'Team view',
        scope: 'team',
        ownerActorId: humanActorId,
        teamId,
        filters: [],
        grouping: null,
        sort: [],
      }),
    });
    expect(created2.status).toBe(200);

    expect((await w.request(`/${id}`)).status).toBe(200);
    const patched = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        name: 'Renamed',
        scope: 'organization',
        ownerActorId: humanActorId,
        teamId,
        filters: [],
        grouping: null,
        sort: [],
      }),
    });
    expect(patched.status).toBe(200);
    expect((await w.request(`/${id}`, { method: 'DELETE' })).status).toBe(200);

    const v = appWithActor(r['savedViews'], orgId, ['view']);
    expect((await v.request('/', { method: 'POST', headers: J, body: '{}' })).status).toBe(403);
    expect((await w.request(`/${MISSING}`)).status).toBe(404);
    expect(
      (
        await w.request(`/${MISSING}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect((await w.request(`/${MISSING}`, { method: 'DELETE' })).status).toBe(404);
    expect(
      (await w.request('/', { method: 'POST', headers: J, body: JSON.stringify({ name: '' }) }))
        .status,
    ).toBe(422);
  });
});

describe('comments router', () => {
  it('list-by-subject + CRUD + 403/404/422', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['comments'], orgId, ['comment'], humanActorId);

    const subjectId = MISSING;
    const empty = await w.request(`/?subjectType=task&subjectId=${subjectId}`);
    expect((await body<{ items: unknown[] }>(empty)).items).toHaveLength(0);

    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ subjectType: 'task', subjectId, body: 'hi' }),
    });
    expect(created.status).toBe(200);
    const id = (await body<{ id: string }>(created)).id;

    expect((await w.request(`/${id}`)).status).toBe(200);
    const patched = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ body: 'edited' }),
    });
    expect(patched.status).toBe(200);
    expect((await w.request(`/${id}`, { method: 'DELETE' })).status).toBe(200);

    const v = appWithActor(r['comments'], orgId, ['view']);
    expect((await v.request('/', { method: 'POST', headers: J, body: '{}' })).status).toBe(403);
    expect((await w.request(`/${MISSING}`)).status).toBe(404);
    expect(
      (
        await w.request(`/${MISSING}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ body: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect((await w.request(`/${MISSING}`, { method: 'DELETE' })).status).toBe(404);
    expect(
      (
        await w.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ subjectType: 'task' }),
        })
      ).status,
    ).toBe(422);
  });
});

describe('roles router', () => {
  it('CRUD with defaults + explicit + system-role delete conflict + 403/404/422', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['roles'], orgId, ['manage']);

    expect((await body<{ items: unknown[] }>(await w.request('/'))).items).toHaveLength(0);

    // Defaults path (capabilities/baseCapability default; no defaultVisibility).
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ key: 'lead', name: 'Lead' }),
    });
    expect(created.status).toBe(200);
    const id = (await body<{ id: string }>(created)).id;

    // Explicit fields path.
    const created2 = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        key: 'lead2',
        name: 'Lead2',
        capabilities: ['view', 'contribute'],
        baseCapability: 'contribute',
        defaultVisibility: 'private',
      }),
    });
    expect(created2.status).toBe(200);

    expect((await w.request(`/${id}`)).status).toBe(200);
    const patched = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        name: 'Lead Renamed',
        capabilities: ['view'],
        baseCapability: 'view',
        defaultVisibility: 'public',
      }),
    });
    expect(patched.status).toBe(200);
    expect((await w.request(`/${id}`, { method: 'DELETE' })).status).toBe(200);

    // System role cannot be deleted (409 conflict).
    const [sys] = await db
      .insert(schema.role)
      .values({
        organizationId: orgId,
        key: 'owner',
        name: 'Owner',
        isSystem: true,
        capabilities: ['manage'],
      })
      .returning({ id: schema.role.id });
    expect((await w.request(`/${sys!.id}`, { method: 'DELETE' })).status).toBe(409);

    const v = appWithActor(r['roles'], orgId, ['view']);
    expect((await v.request('/', { method: 'POST', headers: J, body: '{}' })).status).toBe(403);
    expect((await w.request(`/${MISSING}`)).status).toBe(404);
    expect(
      (
        await w.request(`/${MISSING}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect((await w.request(`/${MISSING}`, { method: 'DELETE' })).status).toBe(404);
    expect(
      (await w.request('/', { method: 'POST', headers: J, body: JSON.stringify({ key: '' }) }))
        .status,
    ).toBe(422);
  });
});

describe('agents router', () => {
  it('register via displayName, via existing actor, conflicts + CRUD + 403/404/422', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['agents'], orgId, ['manage'], humanActorId);

    expect((await body<{ items: unknown[] }>(await w.request('/'))).items).toHaveLength(0);

    // Register by displayName (materializes a new agent actor).
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ displayName: 'Athena', guidance: 'be calm' }),
    });
    expect(created.status).toBe(200);
    const ag = await body<{ id: string }>(created);

    // Conflict: neither actorId nor displayName.
    expect(
      (await w.request('/', { method: 'POST', headers: J, body: JSON.stringify({}) })).status,
    ).toBe(409);

    // Register by existing agent actor.
    const [agentActor] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'agent', displayName: 'Bot' })
      .returning({ id: schema.actor.id });
    const created2 = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ actorId: agentActor!.id }),
    });
    expect(created2.status).toBe(200);

    // Conflict: that actor already has an agent.
    expect(
      (
        await w.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ actorId: agentActor!.id }),
        })
      ).status,
    ).toBe(409);

    // NotFound: actorId that isn't an agent actor in the org.
    expect(
      (
        await w.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ actorId: MISSING }),
        })
      ).status,
    ).toBe(404);

    expect((await w.request(`/${ag.id}`)).status).toBe(200);
    const patched = await w.request(`/${ag.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        connection: null,
        accountableOwnerId: null,
        guidance: 'x',
        approvalRouting: null,
        approvalPolicy: 'autonomous',
      }),
    });
    expect(patched.status).toBe(200);
    expect((await w.request(`/${ag.id}`, { method: 'DELETE' })).status).toBe(200);

    const v = appWithActor(r['agents'], orgId, ['view']);
    expect((await v.request('/', { method: 'POST', headers: J, body: '{}' })).status).toBe(403);
    expect((await w.request(`/${MISSING}`)).status).toBe(404);
    expect(
      (await w.request(`/${MISSING}`, { method: 'PATCH', headers: J, body: '{}' })).status,
    ).toBe(404);
    expect((await w.request(`/${MISSING}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('tasks router', () => {
  it('create (state default from team) + list + team-not-found + 403/422', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['tasks'], orgId, ['contribute'], humanActorId);

    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ title: 'Do it', teamId }),
    });
    expect(created.status).toBe(200);

    // Explicit state path + dueDate (covers the dueDate truthy branch).
    const created2 = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        title: 'Do it 2',
        teamId,
        state: 'in_progress',
        priority: 'high',
        assigneeId: humanActorId,
        dueDate: '2026-12-01',
      }),
    });
    expect(created2.status).toBe(200);

    expect(
      (await body<{ items: unknown[] }>(await w.request('/'))).items.length,
    ).toBeGreaterThanOrEqual(2);

    // Team not in org → 404.
    expect(
      (
        await w.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ title: 'x', teamId: MISSING }),
        })
      ).status,
    ).toBe(404);

    const v = appWithActor(r['tasks'], orgId, ['view']);
    expect((await v.request('/', { method: 'POST', headers: J, body: '{}' })).status).toBe(403);
    expect(
      (await w.request('/', { method: 'POST', headers: J, body: JSON.stringify({ title: '' }) }))
        .status,
    ).toBe(422);
  });

  it('falls back to backlog when team has no workflow states', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const [t] = await db
      .insert(schema.team)
      .values({
        organizationId: orgId,
        name: 'Empty',
        key: `E${Math.random().toString(36).slice(2, 6)}`,
        workflowStates: [],
      })
      .returning({ id: schema.team.id });
    const w = appWithActor(r['tasks'], orgId, ['contribute'], humanActorId);
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ title: 'No states', teamId: t!.id }),
    });
    expect(created.status).toBe(200);
    expect((await body<{ state: string }>(created)).state).toBe('backlog');
  });
});

describe('projects router', () => {
  it('create (with + without dates) + list + 403/422', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['projects'], orgId, ['contribute'], humanActorId);

    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        name: 'Proj',
        teamId,
        startDate: '2026-01-01',
        targetDate: '2026-03-01',
      }),
    });
    expect(created.status).toBe(200);

    const created2 = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Proj2' }),
    });
    expect(created2.status).toBe(200);

    expect(
      (await body<{ items: unknown[] }>(await w.request('/'))).items.length,
    ).toBeGreaterThanOrEqual(2);

    const v = appWithActor(r['projects'], orgId, ['view']);
    expect((await v.request('/', { method: 'POST', headers: J, body: '{}' })).status).toBe(403);
    expect(
      (await w.request('/', { method: 'POST', headers: J, body: JSON.stringify({ name: '' }) }))
        .status,
    ).toBe(422);
  });
});

describe('updates router', () => {
  it('list-by-subject + post (sets subject health) + post without health + 403/422', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['updates'], orgId, ['contribute'], humanActorId);

    // Seed a project to update the health of.
    const [proj] = await db
      .insert(schema.project)
      .values({ organizationId: orgId, name: 'P', teamId, createdBy: humanActorId })
      .returning({ id: schema.project.id });
    const subjectId = proj!.id;

    const empty = await w.request(`/?subjectType=project&subjectId=${subjectId}`);
    expect((await body<{ items: unknown[] }>(empty)).items).toHaveLength(0);

    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        subjectType: 'project',
        subjectId,
        health: 'at_risk',
        body: 'update',
      }),
    });
    expect(created.status).toBe(200);

    // Verify the project health was written.
    const updatedProj = await db
      .select({ health: schema.project.health })
      .from(schema.project)
      .where(eq(schema.project.id, subjectId))
      .limit(1);
    expect(updatedProj[0]?.health).toBe('at_risk');

    // Post without health (no subject health write branch).
    const created2 = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ subjectType: 'project', subjectId, body: 'no health' }),
    });
    expect(created2.status).toBe(200);

    const v = appWithActor(r['updates'], orgId, ['view']);
    expect((await v.request('/', { method: 'POST', headers: J, body: '{}' })).status).toBe(403);
    expect(
      (
        await w.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ subjectType: 'project' }),
        })
      ).status,
    ).toBe(422);
  });
});

describe('activity router + writeAudit', () => {
  it('lists the org audit feed newest-first after writeAudit', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const { writeAudit } = await import('./activity');
    await writeAudit({
      organizationId: orgId,
      actorId: humanActorId,
      subjectType: 'task',
      subjectId: MISSING,
      type: 'created',
    });
    const w = appWithActor(r['activity'], orgId, ['view'], humanActorId);
    const res = await w.request('/');
    expect(res.status).toBe(200);
    expect((await body<{ items: unknown[] }>(res)).items).toHaveLength(1);
  });
});

describe('integrations router (CRUD; import covered elsewhere)', () => {
  it('CRUD with defaults + explicit + 403/404/422', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['integrations'], orgId, ['manage'], humanActorId);

    expect((await body<{ items: unknown[] }>(await w.request('/'))).items).toHaveLength(0);

    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ provider: 'github', pattern: 'connector' }),
    });
    expect(created.status).toBe(200);
    const id = (await body<{ id: string }>(created)).id;

    // Explicit fields path.
    const created2 = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        provider: 'linear',
        pattern: 'migration',
        roles: ['work'],
        connection: {},
        status: 'connected',
        config: { teamId: 'x' },
        syncMode: 'mirror',
      }),
    });
    expect(created2.status).toBe(200);

    expect((await w.request(`/${id}`)).status).toBe(200);
    const patched = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        roles: ['work'],
        connection: {},
        status: 'disconnected',
        config: {},
        syncMode: 'mirror',
      }),
    });
    expect(patched.status).toBe(200);
    expect((await w.request(`/${id}`, { method: 'DELETE' })).status).toBe(200);

    const v = appWithActor(r['integrations'], orgId, ['view']);
    expect((await v.request('/', { method: 'POST', headers: J, body: '{}' })).status).toBe(403);
    expect((await w.request(`/${MISSING}`)).status).toBe(404);
    expect(
      (await w.request(`/${MISSING}`, { method: 'PATCH', headers: J, body: '{}' })).status,
    ).toBe(404);
    expect((await w.request(`/${MISSING}`, { method: 'DELETE' })).status).toBe(404);
    expect(
      (await w.request('/', { method: 'POST', headers: J, body: JSON.stringify({ provider: '' }) }))
        .status,
    ).toBe(422);
  });

  it('import: provider-not-importable conflict + no-team conflict', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);

    // An org WITH a team but a non-importable provider → 409.
    const w = appWithActor(r['integrations'], orgId, ['contribute'], humanActorId);
    const [bad] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'slack',
        pattern: 'connector',
        roles: ['work'],
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id });
    expect(
      (await w.request(`/${bad!.id}/import`, { method: 'POST', headers: J, body: '{}' })).status,
    ).toBe(409);

    // Import not found.
    expect(
      (await w.request(`/${MISSING}/import`, { method: 'POST', headers: J, body: '{}' })).status,
    ).toBe(404);

    // 403 for a view-only member.
    const v = appWithActor(r['integrations'], orgId, ['view']);
    expect(
      (await v.request(`/${bad!.id}/import`, { method: 'POST', headers: J, body: '{}' })).status,
    ).toBe(403);
  });

  it('import: org with no team → 409', async () => {
    // Seed a bare org (no team) with a github integration; import should 409 on no-team.
    const slug = `noteam-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const orgId = org!.id;
    const [human] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'A' })
      .returning({ id: schema.actor.id });
    const [intg] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'github',
        pattern: 'connector',
        roles: ['work'],
        createdBy: human!.id,
      })
      .returning({ id: schema.integration.id });
    const w = appWithActor(r['integrations'], orgId, ['contribute'], human!.id);
    expect(
      (await w.request(`/${intg!.id}/import`, { method: 'POST', headers: J, body: '{}' })).status,
    ).toBe(409);
  });
});

describe('billing router (GET status only; checkout/portal covered elsewhere)', () => {
  it('returns null before any subscription', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['billing'], `${orgId}_none`, ['view']);
    const res = await w.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});
