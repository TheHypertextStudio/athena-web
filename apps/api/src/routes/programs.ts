/**
 * `@docket/api` — programs router (mounted at `/v1/orgs/:orgId/programs`).
 */
import { cycle, db, program, project, task, update } from '@docket/db';
import {
  CursorQuery,
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
import { pageResult, seekAfter } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
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
  .get(
    '/',
    apiDoc({
      tag: 'Programs',
      summary: 'List programs',
      response: pageOf(ProgramOut),
      description: `List the organization's programs — ongoing areas of operation that have NO terminal state (a program is \`active\`, \`paused\`, or \`archived\`; intentionally never \`completed\`, because operational work never "finishes"). Unlike bounded Projects, Programs persist; they own Projects and host directly-attached Tasks. Keyset-paginated newest-first by \`createdAt\` (\`id\` tiebreak); the optional \`limit\` yields a bounded page plus \`nextCursor\` (omit for the full list). Each item is the flat {@link ProgramOut} — fetch \`GET /:id\` for the child-work roll-up. Read-only; org membership suffices. Strictly org-scoped.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      // Keyset-paginate newest-first (createdAt, id tiebreak). `limit` is optional: omitted returns
      // the full list as before; supplied returns a bounded page + `nextCursor`.
      const base = db
        .select()
        .from(program)
        .where(
          and(eq(program.organizationId, orgId), seekAfter(program.createdAt, program.id, cursor)),
        )
        .orderBy(desc(program.createdAt), desc(program.id));
      const rows = await (limit === undefined ? base : base.limit(limit + 1));
      const { items, nextCursor } = pageResult(rows, limit, (r) => r.createdAt);
      return ok(c, pageOf(ProgramOut), { items: items.map(toOut), nextCursor });
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Programs',
      summary: 'Create a program',
      capability: 'manage',
      response: ProgramOut,
      description: `Create a new program in the organization. The \`organizationId\` comes from the path, never the body. \`status\` defaults to \`active\` and \`visibility\` defaults to \`public\` when omitted; \`description\`, \`ownerId\`, and \`health\` are optional. Requires \`manage\` — the highest capability — NOT \`contribute\`: a program is a top-level structural container in the org's operating model (Projects and Tasks hang off it and cascade-down containment means its grants propagate to that child work), so standing up or tearing down a program is an administrative act reserved for org managers. Returns the created {@link ProgramOut}. No observation is emitted on program create. (Note: \`private\` programs are visible only to actors with an explicit grant; \`public\` programs are visible to all org members.)`,
    }),
    zJson(ProgramCreate),
    async (c) => {
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
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Programs',
      summary: 'Get program detail',
      response: ProgramDetail,
      description: `Fetch a single program plus a roll-up of its child work. Beyond the flat {@link ProgramOut} fields, the response carries \`rollup: { projects, tasks }\`: \`projects\` counts the Projects whose \`program_id\` is this program, and \`tasks\` counts every active (non-archived) Task under the program — meaning a Task attached directly via \`task.program_id\` OR belonging to one of those Projects (the union is de-duplicated by the query). This lets a detail card show the program's scope at a glance without a second round-trip. 404 (\`Program not found\`) when the id is absent or cross-tenant. Read-only; org membership suffices. Returns {@link ProgramDetail}. See \`GET /:id/work\` for the actual tasks grouped by cycle and project.`,
    }),
    zParam(idParam),
    async (c) => {
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
    },
  )
  .patch(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Programs',
      summary: 'Update a program',
      capability: 'manage',
      response: ProgramOut,
      description: `Partially update a program. Every field is optional: an absent key leaves the column untouched, while \`null\` (where allowed — \`description\`, \`ownerId\`, \`health\`) clears it. \`status\` is constrained to \`active\`/\`paused\`/\`archived\` (a program has no \`completed\` state by design). Editing \`visibility\` flips a program between org-wide visibility and grant-only access. Requires \`manage\` for the same reason as create: a program is a structural container whose grants cascade to its child Projects and Tasks, so re-scoping or archiving it is an administrative act. Unlike Project/Initiative updates this route emits no observation. 404 (\`Program not found\`) when the id is absent or cross-tenant. Returns the updated {@link ProgramOut}.`,
    }),
    zParam(idParam),
    zJson(ProgramUpdate),
    async (c) => {
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
    },
  )
  .delete(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Programs',
      summary: 'Delete a program',
      capability: 'manage',
      response: ProgramOut,
      description: `Permanently delete a program, scoped to the caller's org (404 \`Program not found\` when absent or cross-tenant). Requires \`manage\`. This removes the program row; child Projects' and Tasks' \`program_id\` references are handled by the database's foreign-key rules rather than being deleted here, and \`initiative_program\` association edges are cascaded away. Because tearing down a top-level operational container is irreversible and reshapes the portfolio, prefer setting \`status\` to \`archived\` via PATCH to retire a program while keeping its history. Returns the deleted {@link ProgramOut} as a tombstone.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(program)
        .where(and(eq(program.id, id), eq(program.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Program not found');
      return ok(c, ProgramOut, toOut(row));
    },
  )
  .get(
    '/:id/work',
    apiDoc({
      tag: 'Programs',
      summary: 'Get program work',
      response: ProgramWorkOut,
      description: `The work under a program, grouped by Cycle and then segmented by Project — the program's two-level work board. "Work under the program" is every active (non-archived) Task that either carries the program's \`program_id\` directly or belongs to a Project whose \`program_id\` is the program. Tasks are first bucketed by their \`cycle_id\` (the \`null\`-keyed "no cycle" group holds unscheduled tasks), then within each group segmented by \`project_id\` (the \`null\`-keyed "no project" segment holds tasks attached straight to the program). Group/segment ordering is deterministic — tasks are read \`createdAt\` descending, so first-seen order is stable. Each cycle group carries a lightweight cycle ref (id, name, number, resolved from the real cycles referenced); each segment carries a project ref (id, name). Optional \`cycleId\` and/or \`projectId\` query filters narrow the board to a single cadence and/or project. The program must exist in the caller's org (404 \`Program not found\`). Read-only. Returns {@link ProgramWorkOut}.`,
    }),
    zParam(idParam),
    zQuery(ProgramWorkQuery),
    async (c) => {
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
    },
  )
  .get(
    '/:id/updates',
    apiDoc({
      tag: 'Programs',
      summary: 'List program updates',
      response: pageOf(UpdateOut),
      description: `List the status Updates posted about this program — the narrative health log (each Update carries a \`health\` verdict and a free-text \`body\`, distinct from threaded Comments). Returns only Updates whose subject is THIS program (\`subjectType = 'program'\`, \`subjectId = :id\`), org-scoped, newest first. The program is confirmed to exist in the caller's org first (404 \`Program not found\`). This endpoint returns the full set (it does not key-paginate). Read-only; org membership suffices. Returns a page of {@link UpdateOut}. Updates are authored via the \`updates\` resource; this is the program-scoped read view of them.`,
    }),
    zParam(idParam),
    async (c) => {
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
    },
  );

export default programs;
