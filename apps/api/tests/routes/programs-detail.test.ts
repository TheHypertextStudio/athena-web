import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';
import type programsRouter from '../../src/routes/programs';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let programs!: typeof programsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  programs = (await import('../../src/routes/programs')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// A valid ULID-shaped id that no seeded row uses (passes branded-id validation, 404s on lookup).
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Insert a program row directly and return its id. */
async function seedProgram(orgId: string, createdBy: string): Promise<string> {
  const [p] = await db
    .insert(schema.program)
    .values({ organizationId: orgId, name: 'Platform', createdBy })
    .returning({ id: schema.program.id });
  return p!.id;
}

/** Insert a project under a program and return its id. */
async function seedProject(
  orgId: string,
  teamId: string,
  programId: string | null,
  createdBy: string,
  name = 'Proj',
): Promise<string> {
  const [proj] = await db
    .insert(schema.project)
    .values({ organizationId: orgId, name, teamId, programId, createdBy })
    .returning({ id: schema.project.id });
  return proj!.id;
}

/** Insert a cycle on a team and return its id. `name` may be null (cycles allow it). */
async function seedCycle(
  orgId: string,
  teamId: string,
  number: number,
  name: string | null = `Cycle ${number}`,
): Promise<string> {
  const [cy] = await db
    .insert(schema.cycle)
    .values({
      organizationId: orgId,
      teamId,
      number,
      name,
      startsAt: new Date('2026-01-01'),
      endsAt: new Date('2026-01-14'),
    })
    .returning({ id: schema.cycle.id });
  return cy!.id;
}

/** Insert a task with the given program/project/cycle wiring; returns its id. */
async function seedTask(args: {
  orgId: string;
  teamId: string;
  title?: string;
  programId?: string | null;
  projectId?: string | null;
  cycleId?: string | null;
  archived?: boolean;
}): Promise<string> {
  const [t] = await db
    .insert(schema.task)
    .values({
      organizationId: args.orgId,
      title: args.title ?? 'T',
      teamId: args.teamId,
      state: 'backlog',
      programId: args.programId ?? null,
      projectId: args.projectId ?? null,
      cycleId: args.cycleId ?? null,
      archivedAt: args.archived ? new Date() : null,
    })
    .returning({ id: schema.task.id });
  return t!.id;
}

/** Insert a status update on a subject; returns its id. */
async function seedUpdate(args: {
  orgId: string;
  subjectType: 'project' | 'program' | 'initiative';
  subjectId: string;
  authorId: string;
  body?: string;
  health?: 'on_track' | 'at_risk' | 'off_track' | null;
}): Promise<string> {
  const [u] = await db
    .insert(schema.update)
    .values({
      organizationId: args.orgId,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      authorId: args.authorId,
      body: args.body ?? 'progressing',
      health: args.health ?? null,
      createdBy: args.authorId,
    })
    .returning({ id: schema.update.id });
  return u!.id;
}

describe('programs detail (GET /:id with roll-up)', () => {
  it('returns the program plus counts of its projects and active tasks', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    const programId = await seedProgram(orgId, humanActorId);

    // Two projects under the program; one stray project under no program.
    const projA = await seedProject(orgId, teamId, programId, humanActorId, 'A');
    await seedProject(orgId, teamId, programId, humanActorId, 'B');
    await seedProject(orgId, teamId, null, humanActorId, 'Stray');

    // Tasks: one attached directly to the program, one via project A, one archived
    // (excluded), one fully unrelated (excluded).
    await seedTask({ orgId, teamId, programId });
    await seedTask({ orgId, teamId, projectId: projA });
    await seedTask({ orgId, teamId, programId, archived: true });
    await seedTask({ orgId, teamId });

    const res = await reader.request(`/${programId}`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{ id: string; rollup: { projects: number; tasks: number } }>(res);
    expect(body.id).toBe(programId);
    expect(body.rollup).toEqual({ projects: 2, tasks: 2 });
  });

  it('returns zero counts for an empty program (no-projects branch)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    const programId = await seedProgram(orgId, humanActorId);

    const res = await reader.request(`/${programId}`, { method: 'GET' });
    const body = await json<{ rollup: { projects: number; tasks: number } }>(res);
    expect(body.rollup).toEqual({ projects: 0, tasks: 0 });
  });

  it('counts a directly-attached task even when the program has no projects', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    const programId = await seedProgram(orgId, humanActorId);
    await seedTask({ orgId, teamId, programId });

    const body = await json<{ rollup: { projects: number; tasks: number } }>(
      await reader.request(`/${programId}`, { method: 'GET' }),
    );
    expect(body.rollup).toEqual({ projects: 0, tasks: 1 });
  });

  it('404s on a missing program id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    expect((await reader.request(`/${MISSING_ULID}`, { method: 'GET' })).status).toBe(404);
  });

  it("isolates tenants: cannot read another org's program detail", async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const programId = await seedProgram(orgA.orgId, orgA.humanActorId);
    const readerB = appWithActor(programs, orgB.orgId, ['view'], orgB.humanActorId);
    expect((await readerB.request(`/${programId}`, { method: 'GET' })).status).toBe(404);
  });
});

interface WorkOut {
  groups: {
    cycle: { id: string | null; name?: string | null; number?: number | null };
    segments: { project: { id: string | null; name?: string | null }; tasks: { id: string }[] }[];
  }[];
}

describe('programs work view (GET /:id/work)', () => {
  it('groups by cycle and segments by project, including the null buckets', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    const programId = await seedProgram(orgId, humanActorId);
    const projA = await seedProject(orgId, teamId, programId, humanActorId, 'A');
    const cycle1 = await seedCycle(orgId, teamId, 1);

    // In cycle1, project A (two tasks -> exercises the bucket-reuse branch).
    await seedTask({ orgId, teamId, projectId: projA, cycleId: cycle1 });
    await seedTask({ orgId, teamId, projectId: projA, cycleId: cycle1 });
    // In cycle1, no project (directly on the program).
    await seedTask({ orgId, teamId, programId, cycleId: cycle1 });
    // No cycle, project A.
    await seedTask({ orgId, teamId, projectId: projA });
    // Archived task under the program must be excluded.
    await seedTask({ orgId, teamId, programId, cycleId: cycle1, archived: true });

    const res = await reader.request(`/${programId}/work`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<WorkOut>(res);

    // Two cycle groups: the real cycle1 and the "no cycle" group.
    expect(body.groups).toHaveLength(2);

    const realGroup = body.groups.find((g) => g.cycle.id === cycle1);
    expect(realGroup).toBeDefined();
    expect(realGroup!.cycle.number).toBe(1);
    // cycle1 has two segments: project A and the "no project" segment.
    expect(realGroup!.segments).toHaveLength(2);
    const noProjectSeg = realGroup!.segments.find((s) => s.project.id === null);
    expect(noProjectSeg!.tasks).toHaveLength(1);
    const projASeg = realGroup!.segments.find((s) => s.project.id === projA);
    expect(projASeg!.project.name).toBe('A');
    expect(projASeg!.tasks).toHaveLength(2);

    const nullCycleGroup = body.groups.find((g) => g.cycle.id === null);
    expect(nullCycleGroup!.segments).toHaveLength(1);
    expect(nullCycleGroup!.segments[0]!.tasks).toHaveLength(1);

    // The archived task never appears.
    const allTaskCount = body.groups
      .flatMap((g) => g.segments)
      .reduce((n, s) => n + s.tasks.length, 0);
    expect(allTaskCount).toBe(4);
  });

  it('labels a name-less cycle group with a null name', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    const programId = await seedProgram(orgId, humanActorId);
    const namelessCycle = await seedCycle(orgId, teamId, 7, null);
    await seedTask({ orgId, teamId, programId, cycleId: namelessCycle });

    const body = await json<WorkOut>(await reader.request(`/${programId}/work`, { method: 'GET' }));
    const group = body.groups.find((g) => g.cycle.id === namelessCycle);
    expect(group).toBeDefined();
    expect(group!.cycle.name).toBeNull();
    expect(group!.cycle.number).toBe(7);
  });

  it('filters by cycleId and projectId', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    const programId = await seedProgram(orgId, humanActorId);
    const projA = await seedProject(orgId, teamId, programId, humanActorId, 'A');
    const projB = await seedProject(orgId, teamId, programId, humanActorId, 'B');
    const cycle1 = await seedCycle(orgId, teamId, 1);
    const cycle2 = await seedCycle(orgId, teamId, 2);

    await seedTask({ orgId, teamId, projectId: projA, cycleId: cycle1 });
    await seedTask({ orgId, teamId, projectId: projB, cycleId: cycle2 });

    // cycleId filter -> only cycle1's single task.
    const byCycle = await json<WorkOut>(
      await reader.request(`/${programId}/work?cycleId=${cycle1}`, { method: 'GET' }),
    );
    const cycleTaskCount = byCycle.groups
      .flatMap((g) => g.segments)
      .reduce((n, s) => n + s.tasks.length, 0);
    expect(cycleTaskCount).toBe(1);
    expect(byCycle.groups.every((g) => g.cycle.id === cycle1)).toBe(true);

    // projectId filter -> only project B's single task.
    const byProject = await json<WorkOut>(
      await reader.request(`/${programId}/work?projectId=${projB}`, { method: 'GET' }),
    );
    const projTaskCount = byProject.groups
      .flatMap((g) => g.segments)
      .reduce((n, s) => n + s.tasks.length, 0);
    expect(projTaskCount).toBe(1);
    expect(byProject.groups[0]!.segments[0]!.project.id).toBe(projB);
  });

  it('returns no groups for a program with no work', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    const programId = await seedProgram(orgId, humanActorId);
    const body = await json<WorkOut>(await reader.request(`/${programId}/work`, { method: 'GET' }));
    expect(body.groups).toEqual([]);
  });

  it('422s on an invalid cycleId filter (non-ULID)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    const programId = await seedProgram(orgId, humanActorId);
    const res = await reader.request(`/${programId}/work?cycleId=not-a-ulid`, { method: 'GET' });
    expect(res.status).toBe(422);
  });

  it('404s on /work for a missing program id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    expect((await reader.request(`/${MISSING_ULID}/work`, { method: 'GET' })).status).toBe(404);
  });

  it("isolates tenants: another org's program /work is 404", async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const programId = await seedProgram(orgA.orgId, orgA.humanActorId);
    const readerB = appWithActor(programs, orgB.orgId, ['view'], orgB.humanActorId);
    expect((await readerB.request(`/${programId}/work`, { method: 'GET' })).status).toBe(404);
  });
});

describe('programs updates (GET /:id/updates)', () => {
  it('returns this program subject updates newest-first, excluding other subjects', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    const programId = await seedProgram(orgId, humanActorId);
    const otherProgramId = await seedProgram(orgId, humanActorId);

    await seedUpdate({
      orgId,
      subjectType: 'program',
      subjectId: programId,
      authorId: humanActorId,
      body: 'older',
      health: 'on_track',
    });
    // Slight delay so createdAt ordering is deterministic.
    await new Promise((r) => setTimeout(r, 5));
    await seedUpdate({
      orgId,
      subjectType: 'program',
      subjectId: programId,
      authorId: humanActorId,
      body: 'newer',
      health: 'at_risk',
    });
    // An update on a DIFFERENT program (excluded) and on a project subject (excluded).
    await seedUpdate({
      orgId,
      subjectType: 'program',
      subjectId: otherProgramId,
      authorId: humanActorId,
    });
    await seedUpdate({
      orgId,
      subjectType: 'project',
      subjectId: programId,
      authorId: humanActorId,
    });

    const res = await reader.request(`/${programId}/updates`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{
      items: { subjectType: string; subjectId: string; body: string; health: string | null }[];
    }>(res);
    expect(body.items).toHaveLength(2);
    expect(body.items.map((u) => u.body)).toEqual(['newer', 'older']);
    expect(body.items.every((u) => u.subjectType === 'program' && u.subjectId === programId)).toBe(
      true,
    );
    expect(body.items[0]!.health).toBe('at_risk');
  });

  it('returns an empty page for a program with no updates', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    const programId = await seedProgram(orgId, humanActorId);
    const body = await json<{ items: unknown[] }>(
      await reader.request(`/${programId}/updates`, { method: 'GET' }),
    );
    expect(body.items).toEqual([]);
  });

  it('404s on /updates for a missing program id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(programs, orgId, ['view'], humanActorId);
    expect((await reader.request(`/${MISSING_ULID}/updates`, { method: 'GET' })).status).toBe(404);
  });

  it("isolates tenants: another org's program /updates is 404", async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const programId = await seedProgram(orgA.orgId, orgA.humanActorId);
    await seedUpdate({
      orgId: orgA.orgId,
      subjectType: 'program',
      subjectId: programId,
      authorId: orgA.humanActorId,
    });
    const readerB = appWithActor(programs, orgB.orgId, ['view'], orgB.humanActorId);
    expect((await readerB.request(`/${programId}/updates`, { method: 'GET' })).status).toBe(404);
  });
});
