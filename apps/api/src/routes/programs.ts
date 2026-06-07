/**
 * `@docket/api` — programs router (mounted at `/v1/orgs/:orgId/programs`).
 */
import { cycle, db, program, project, task, update } from '@docket/db';
import {
  pageOf,
  ProgramCreate,
  ProgramDetail,
  ProgramOut,
  ProgramUpdate,
  ProgramWorkOut,
  ProgramWorkQuery,
  UpdateOut,
} from '@docket/types';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type ProgramRow = typeof program.$inferSelect;
type TaskRow = typeof task.$inferSelect;

function toOut(p: ProgramRow): z.input<typeof ProgramOut> {
  return {
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    description: p.description,
    ownerId: p.ownerId,
    status: p.status,
    health: p.health,
    visibility: p.visibility,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Project a task row into its `TaskOut` wire shape (shared with the tasks router). */
function taskToOut(
  t: TaskRow,
): z.input<typeof ProgramWorkOut>['groups'][number]['segments'][number]['tasks'][number] {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    description: t.description,
    teamId: t.teamId,
    state: t.state,
    priority: t.priority,
    assigneeId: t.assigneeId,
    delegateId: t.delegateId,
    projectId: t.projectId,
    programId: t.programId,
    dueDate: t.dueDate?.toISOString() ?? null,
    provenance: {
      source: t.source,
      sourceIntegrationId: t.sourceIntegrationId,
      externalId: t.externalId,
      externalUrl: t.externalUrl,
      syncMode: t.sourceSyncMode,
    },
    createdAt: t.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

/** Load a single Program scoped to the org, or throw {@link NotFoundError}. */
async function loadProgram(orgId: string, id: string): Promise<ProgramRow> {
  const rows = await db
    .select()
    .from(program)
    .where(and(eq(program.id, id), eq(program.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Program not found');
  return row;
}

/** Programs router: org-scoped CRUD; `manage` to mutate. */
const programs = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(program)
      .where(eq(program.organizationId, orgId))
      .orderBy(desc(program.createdAt));
    return ok(c, pageOf(ProgramOut), { items: rows.map(toOut) });
  })
  .post('/', capabilityGuard('manage'), zJson(ProgramCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');
    const inserted = await db
      .insert(program)
      .values({
        organizationId: orgId,
        name: body.name,
        description: body.description,
        ownerId: body.ownerId,
        status: body.status ?? 'active',
        health: body.health,
        visibility: body.visibility ?? 'public',
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('program insert returned no row');
    return ok(c, ProgramOut, toOut(row));
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const row = await loadProgram(orgId, id);

    // Roll up the Program's child work: Projects pointing at it, and active Tasks under
    // it (attached directly via task.program_id OR via one of those Projects).
    const projectRows = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.programId, id), eq(project.organizationId, orgId)));
    const projectIds = projectRows.map((p) => p.id);

    const taskRows = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.organizationId, orgId),
          isNull(task.archivedAt),
          projectIds.length > 0
            ? or(eq(task.programId, id), inArray(task.projectId, projectIds))
            : eq(task.programId, id),
        ),
      );

    return ok(c, ProgramDetail, {
      ...toOut(row),
      rollup: { projects: projectIds.length, tasks: taskRows.length },
    });
  })
  .patch('/:id', capabilityGuard('manage'), zParam(idParam), zJson(ProgramUpdate), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const updated = await db
      .update(program)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.health !== undefined ? { health: body.health } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
      })
      .where(and(eq(program.id, id), eq(program.organizationId, orgId)))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundError('Program not found');
    return ok(c, ProgramOut, toOut(row));
  })
  .delete('/:id', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const deleted = await db
      .delete(program)
      .where(and(eq(program.id, id), eq(program.organizationId, orgId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new NotFoundError('Program not found');
    return ok(c, ProgramOut, toOut(row));
  })
  .get('/:id/work', zParam(idParam), zQuery(ProgramWorkQuery), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const { cycleId, projectId } = c.req.valid('query');
    await loadProgram(orgId, id);

    // Projects under this Program; a task is "under the Program" if it carries the
    // Program directly (task.program_id) OR belongs to one of these Projects.
    const projectRows = await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(and(eq(project.programId, id), eq(project.organizationId, orgId)));
    const projectIds = projectRows.map((p) => p.id);
    const projectNameById = new Map(projectRows.map((p) => [p.id, p.name]));

    const underProgram =
      projectIds.length > 0
        ? or(eq(task.programId, id), inArray(task.projectId, projectIds))
        : eq(task.programId, id);

    const taskRows = await db
      .select()
      .from(task)
      .where(
        and(
          eq(task.organizationId, orgId),
          isNull(task.archivedAt),
          underProgram,
          // Optional filters narrow the view to one cadence / one project.
          ...(cycleId !== undefined ? [eq(task.cycleId, cycleId)] : []),
          ...(projectId !== undefined ? [eq(task.projectId, projectId)] : []),
        ),
      )
      .orderBy(desc(task.createdAt));

    // Names of any real cycles referenced, for the cycle-group labels.
    const cycleIds = [...new Set(taskRows.map((t) => t.cycleId).filter((v): v is string => !!v))];
    const cycleRows =
      cycleIds.length > 0
        ? await db
            .select({ id: cycle.id, name: cycle.name, number: cycle.number })
            .from(cycle)
            .where(and(eq(cycle.organizationId, orgId), inArray(cycle.id, cycleIds)))
        : [];
    const cycleById = new Map(cycleRows.map((cy) => [cy.id, cy]));

    // Group by cycle (null = "no cycle"), then segment by project (null = "no project").
    // A Map<cycleKey, Map<projectKey, tasks[]>> preserves first-seen ordering, which the
    // `desc(createdAt)` query fixes deterministically.
    const groups = new Map<string, Map<string, TaskRow[]>>();
    for (const t of taskRows) {
      const cycleKey = t.cycleId ?? ' ';
      const projectKey = t.projectId ?? ' ';
      const byProject = groups.get(cycleKey) ?? new Map<string, TaskRow[]>();
      if (!groups.has(cycleKey)) groups.set(cycleKey, byProject);
      const bucket = byProject.get(projectKey) ?? [];
      if (!byProject.has(projectKey)) byProject.set(projectKey, bucket);
      bucket.push(t);
    }

    const payload: z.input<typeof ProgramWorkOut> = {
      groups: [...groups.entries()].map(([cycleKey, byProject]) => {
        const cy = cycleKey === ' ' ? null : cycleById.get(cycleKey);
        return {
          cycle:
            cy == null ? { id: null } : { id: cy.id, name: cy.name ?? null, number: cy.number },
          segments: [...byProject.entries()].map(([projectKey, tasks]) => ({
            project:
              projectKey === ' '
                ? { id: null }
                : {
                    id: projectKey,
                    /* v8 ignore next -- @preserve defensive: projectKey came from a project row, so its name is always in the map */
                    name: projectNameById.get(projectKey) ?? null,
                  },
            tasks: tasks.map(taskToOut),
          })),
        };
      }),
    };
    return ok(c, ProgramWorkOut, payload);
  })
  .get('/:id/updates', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    await loadProgram(orgId, id);

    // Status updates whose subject is THIS program (subjectType='program', subjectId=id),
    // org-scoped, newest first.
    const rows = await db
      .select()
      .from(update)
      .where(
        and(
          eq(update.organizationId, orgId),
          eq(update.subjectType, 'program'),
          eq(update.subjectId, id),
        ),
      )
      .orderBy(desc(update.createdAt));

    return ok(c, pageOf(UpdateOut), {
      items: rows.map((u) => ({
        id: u.id,
        organizationId: u.organizationId,
        authorId: u.authorId,
        subjectType: u.subjectType,
        subjectId: u.subjectId,
        health: u.health,
        body: u.body,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  });

export default programs;
