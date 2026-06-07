/**
 * `@docket/api` — task lifecycle route tests: detail, patch, archive, state, subtasks.
 *
 * @remarks
 * Mirrors `harness.test.ts` (pglite + injected actor context). Dependency-edge
 * coverage lives in `task-dependencies.test.ts`.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';
import type tasksRouter from '../../src/routes/tasks';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// A valid ULID-shaped id that no seeded row uses (passes branded-id validation, 404s on lookup).
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Create a task via the router and return its id. */
async function createTask(
  app: ReturnType<typeof appWithActor>,
  teamId: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'T', teamId, ...body }),
  });
  expect(res.status).toBe(200);
  return (await json<{ id: string }>(res)).id;
}

describe('tasks detail (GET /:id)', () => {
  it('returns the task with empty dependency + subtask lists', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);

    const res = await writer.request(`/${id}`, { method: 'GET' });
    expect(res.status).toBe(200);
    const detail = await json<{
      id: string;
      blocking: unknown[];
      blockedBy: unknown[];
      subtasks: unknown[];
      completedAt: string | null;
      canceledAt: string | null;
    }>(res);
    expect(detail.id).toBe(id);
    expect(detail.blocking).toHaveLength(0);
    expect(detail.blockedBy).toHaveLength(0);
    expect(detail.subtasks).toHaveLength(0);
    expect(detail.completedAt).toBeNull();
    expect(detail.canceledAt).toBeNull();
  });

  it('404s on a missing id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    expect((await writer.request(`/${MISSING_ULID}`, { method: 'GET' })).status).toBe(404);
  });

  it('isolates tenants: a task in another org 404s', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const writerA = appWithActor(tasks, a.orgId, ['contribute'], a.humanActorId);
    const idA = await createTask(writerA, a.teamId);

    const writerB = appWithActor(tasks, b.orgId, ['contribute'], b.humanActorId);
    expect((await writerB.request(`/${idA}`, { method: 'GET' })).status).toBe(404);
  });
});

describe('tasks patch (PATCH /:id)', () => {
  it('updates content fields (every set branch incl. dueDate→null)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId, { dueDate: '2026-09-01' });

    const patched = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'T2',
        description: 'desc',
        state: 'todo',
        priority: 'high',
        estimate: 5,
        dueDate: null,
      }),
    });
    expect(patched.status).toBe(200);
    const body = await json<{ title: string; dueDate: string | null; priority: string }>(patched);
    expect(body.title).toBe('T2');
    expect(body.priority).toBe('high');
    expect(body.dueDate).toBeNull();
  });

  it('derives completedAt when PATCHing state to a terminal (completed) state', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);

    const patched = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    expect(patched.status).toBe(200);
    expect((await json<{ state: string }>(patched)).state).toBe('done');

    // The terminal timestamp must be stamped exactly as POST /:id/state does, so that
    // project progress (which counts completion via completedAt !== null) stays correct.
    const detail = await json<{ completedAt: string | null; canceledAt: string | null }>(
      await writer.request(`/${id}`, { method: 'GET' }),
    );
    expect(detail.completedAt).not.toBeNull();
    expect(detail.canceledAt).toBeNull();
  });

  it('clears terminal timestamps when PATCHing state back to a non-terminal state', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);
    await writer.request(`/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });

    const patched = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'in_progress' }),
    });
    expect(patched.status).toBe(200);

    const detail = await json<{ completedAt: string | null; canceledAt: string | null }>(
      await writer.request(`/${id}`, { method: 'GET' }),
    );
    expect(detail.completedAt).toBeNull();
    expect(detail.canceledAt).toBeNull();
  });

  it('422s when PATCHing state to a value not in the team workflow_states', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);

    const res = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'not_a_real_state' }),
    });
    expect(res.status).toBe(422);
    expect((await json<{ code: string }>(res)).code).toBe('validation_error');
  });

  it('404s when PATCHing state on a missing task', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${MISSING_ULID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    expect(res.status).toBe(404);
  });

  it('sets a dueDate value (non-null branch)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);
    const patched = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dueDate: '2027-01-01' }),
    });
    expect((await json<{ dueDate: string | null }>(patched)).dueDate).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('patches the project/program/milestone/cycle linkage fields (clear to null)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);

    // Seed a project + milestone + cycle and a task linked to all four so the patch
    // actually flips populated linkage columns back to null.
    const [proj] = await db
      .insert(schema.project)
      .values({ organizationId: orgId, name: 'P', teamId, createdBy: humanActorId })
      .returning({ id: schema.project.id });
    const [program] = await db
      .insert(schema.program)
      .values({ organizationId: orgId, name: 'Prog', createdBy: humanActorId })
      .returning({ id: schema.program.id });
    const [ms] = await db
      .insert(schema.milestone)
      .values({ organizationId: orgId, projectId: proj!.id, name: 'M', createdBy: humanActorId })
      .returning({ id: schema.milestone.id });
    const [cy] = await db
      .insert(schema.cycle)
      .values({
        organizationId: orgId,
        teamId,
        number: 1,
        startsAt: new Date('2026-01-01'),
        endsAt: new Date('2026-01-14'),
        createdBy: humanActorId,
      })
      .returning({ id: schema.cycle.id });

    const id = await createTask(writer, teamId, {
      projectId: proj!.id,
      programId: program!.id,
      milestoneId: ms!.id,
      cycleId: cy!.id,
    });

    const res = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: null,
        programId: null,
        milestoneId: null,
        cycleId: null,
      }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ projectId: string | null; programId: string | null }>(res);
    expect(body.projectId).toBeNull();
    expect(body.programId).toBeNull();

    // milestoneId/cycleId aren't surfaced by TaskOut's mapper, so verify the columns
    // were cleared by reading the stored row directly.
    const [row] = await db
      .select({ milestoneId: schema.task.milestoneId, cycleId: schema.task.cycleId })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    expect(row!.milestoneId).toBeNull();
    expect(row!.cycleId).toBeNull();
  });

  it('patches with an empty body as a no-op (200, row unchanged)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId, { title: 'Keep' });
    const res = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await json<{ id: string; title: string }>(res);
    expect(body.id).toBe(id);
    expect(body.title).toBe('Keep');
  });

  it('404s on an empty-body patch of a missing task', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${MISSING_ULID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('allows an assign-capable actor to set the assignee', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['assign'], humanActorId);
    const id = await createTask(writer, teamId);
    const patched = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assigneeId: humanActorId, delegateId: null }),
    });
    expect(patched.status).toBe(200);
    expect((await json<{ assigneeId: string | null }>(patched)).assigneeId).toBe(humanActorId);
  });

  it('403s when a contribute-only actor changes the assignee', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);
    const res = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assigneeId: humanActorId }),
    });
    expect(res.status).toBe(403);
  });

  it('403s for a view-only actor and 404s on a missing id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(tasks, orgId, ['view'], humanActorId);
    expect(
      (
        await viewer.request(`/${MISSING_ULID}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'x' }),
        })
      ).status,
    ).toBe(403);

    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    expect(
      (
        await writer.request(`/${MISSING_ULID}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'x' }),
        })
      ).status,
    ).toBe(404);
  });

  it('422s on an invalid update body', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);
    const res = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('tasks archive (DELETE /:id)', () => {
  it('soft-deletes the task and hides it from detail + list', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);

    const deleted = await writer.request(`/${id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    const body = await json<{ id: string; archivedAt: string }>(deleted);
    expect(body.id).toBe(id);
    expect(typeof body.archivedAt).toBe('string');

    expect((await writer.request(`/${id}`, { method: 'GET' })).status).toBe(404);
    const list = await writer.request('/', { method: 'GET' });
    expect((await json<{ items: { id: string }[] }>(list)).items.find((t) => t.id === id)).toBe(
      undefined,
    );
  });

  it('403s for a view-only actor and 404s on a missing/already-archived id', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(tasks, orgId, ['view'], humanActorId);
    expect((await viewer.request(`/${MISSING_ULID}`, { method: 'DELETE' })).status).toBe(403);

    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    expect((await writer.request(`/${MISSING_ULID}`, { method: 'DELETE' })).status).toBe(404);

    const id = await createTask(writer, teamId);
    expect((await writer.request(`/${id}`, { method: 'DELETE' })).status).toBe(200);
    // Second delete 404s (already archived).
    expect((await writer.request(`/${id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('tasks state transition (POST /:id/state)', () => {
  it('sets completedAt when entering a completed state', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);

    const res = await writer.request(`/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    expect(res.status).toBe(200);
    expect((await json<{ state: string }>(res)).state).toBe('done');

    const detail = await json<{ completedAt: string | null; canceledAt: string | null }>(
      await writer.request(`/${id}`, { method: 'GET' }),
    );
    expect(detail.completedAt).not.toBeNull();
    expect(detail.canceledAt).toBeNull();
  });

  it('sets canceledAt when entering a canceled state', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);
    await writer.request(`/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'canceled' }),
    });
    const detail = await json<{ completedAt: string | null; canceledAt: string | null }>(
      await writer.request(`/${id}`, { method: 'GET' }),
    );
    expect(detail.canceledAt).not.toBeNull();
    expect(detail.completedAt).toBeNull();
  });

  it('clears terminal timestamps when moving back to a non-terminal state', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);
    await writer.request(`/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    await writer.request(`/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'in_progress' }),
    });
    const detail = await json<{ completedAt: string | null; canceledAt: string | null }>(
      await writer.request(`/${id}`, { method: 'GET' }),
    );
    expect(detail.completedAt).toBeNull();
    expect(detail.canceledAt).toBeNull();
  });

  it('422s on a state not in the team workflow_states', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);
    const res = await writer.request(`/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'not_a_real_state' }),
    });
    expect(res.status).toBe(422);
  });

  it('403s for a view-only actor and 404s on a missing id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(tasks, orgId, ['view'], humanActorId);
    expect(
      (
        await viewer.request(`/${MISSING_ULID}/state`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: 'done' }),
        })
      ).status,
    ).toBe(403);

    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    expect(
      (
        await writer.request(`/${MISSING_ULID}/state`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: 'done' }),
        })
      ).status,
    ).toBe(404);
  });

  it('422s on an empty state body', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(writer, teamId);
    const res = await writer.request(`/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: '' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('tasks subtasks (GET + POST /:id/subtasks)', () => {
  it('creates a subtask (inherits team/project) and lists it', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);

    const [proj] = await db
      .insert(schema.project)
      .values({ organizationId: orgId, name: 'P', teamId, createdBy: humanActorId })
      .returning({ id: schema.project.id });
    const projectId = proj!.id;

    const parentId = await createTask(writer, teamId, { projectId });

    // Empty subtask list first.
    const empty = await writer.request(`/${parentId}/subtasks`, { method: 'GET' });
    expect((await json<{ items: unknown[] }>(empty)).items).toHaveLength(0);

    // No dueDate here: exercises the subtask `dueDate` ternary's falsy (undefined) branch.
    const created = await writer.request(`/${parentId}/subtasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Sub' }),
    });
    expect(created.status).toBe(200);
    const sub = await json<{
      id: string;
      projectId: string | null;
      teamId: string;
      dueDate: string | null;
    }>(created);
    expect(sub.projectId).toBe(projectId);
    expect(sub.teamId).toBe(teamId);
    expect(sub.dueDate).toBeNull();

    const listed = await writer.request(`/${parentId}/subtasks`, { method: 'GET' });
    expect((await json<{ items: { id: string }[] }>(listed)).items[0]?.id).toBe(sub.id);

    // The parent's detail surfaces the subtask ref.
    const detail = await json<{ subtasks: { id: string }[] }>(
      await writer.request(`/${parentId}`, { method: 'GET' }),
    );
    expect(detail.subtasks.map((s) => s.id)).toContain(sub.id);
  });

  it('creates a subtask with a dueDate (ternary truthy branch)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId);
    const created = await writer.request(`/${parentId}/subtasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Sub', dueDate: '2027-03-04' }),
    });
    expect(created.status).toBe(200);
    expect((await json<{ dueDate: string | null }>(created)).dueDate).toBe(
      '2027-03-04T00:00:00.000Z',
    );
  });

  it('403s for a view-only actor and 404s on a missing parent', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(tasks, orgId, ['view'], humanActorId);
    expect(
      (
        await viewer.request(`/${MISSING_ULID}/subtasks`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'x' }),
        })
      ).status,
    ).toBe(403);
    // GET subtasks is org:view; a missing parent 404s.
    expect((await viewer.request(`/${MISSING_ULID}/subtasks`, { method: 'GET' })).status).toBe(404);

    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    expect(
      (
        await writer.request(`/${MISSING_ULID}/subtasks`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'x' }),
        })
      ).status,
    ).toBe(404);
  });
});
