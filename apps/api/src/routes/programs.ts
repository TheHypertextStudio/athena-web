/** Program routes mounted under an organization. */
import { actor, cycle, db, program, project, task, update } from '@docket/db';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { defaultCycleName } from '@docket/work/cycle-contract';
import {
  ProgramCreate,
  ProgramDetail,
  ProgramLabelLink,
  ProgramLabelLinked,
  ProgramOut,
  ProgramUpdate,
  ProgramWorkOut,
  ProgramWorkQuery,
} from '@docket/work/program-contract';
import { ProgramDetailAggregate } from '../contracts/detail-aggregate';
import { ProgramId } from '@docket/work/ids';
import { UpdateFeed } from '@docket/work/update-contract';
import { and, count, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { clearableTextPatch } from '../lib/clearable-text';
import {
  attachLabels,
  labelsForSubject,
  labelsForSubjects,
  resolveAttachedLabels,
  resolveLabelSet,
} from '../lib/labels';
import { detailCapabilities } from '../lib/detail-capabilities';
import { deferAfterResponse } from '../lib/after-response';
import { created, ok } from '../lib/ok';
import { resolveContainerStatus } from '../lib/work-status';
import { pageResult, seekAfter } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

import { emitEvent } from './event-emit';
import { buildTaskViewCondition, buildTaskViewFilter, toOut as taskToOut } from './task-helpers';

type ProgramRow = typeof program.$inferSelect;
type TaskRow = typeof task.$inferSelect;

function toOut(p: ProgramRow): z.input<typeof ProgramOut> {
  return {
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    summary: p.summary,
    description: p.description,
    ownerId: p.ownerId,
    status: p.status,
    health: p.health,
    visibility: p.visibility,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Project one named actor without fetching the organization member roster. */
function actorReference(row: typeof actor.$inferSelect) {
  return { actorId: row.id, displayName: row.displayName, avatar: row.avatar };
}
const idParam = z.object({ id: z.string() });
/** The aggregate route refuses malformed Program ids before it can start a data read. */
const aggregateIdParam = z.object({ id: ProgramId });

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
      description: `List the organization's programs — ongoing areas of operation that have NO terminal state (a program is \`active\`, \`paused\`, or \`archived\`; intentionally never \`completed\`, because operational work never "finishes"). Unlike bounded Projects, Programs persist; they own Projects and host directly-attached Tasks. Results use a stable keyset order of \`createdAt DESC, id DESC\`. \`limit\` defaults to 50 and accepts at most 100. Copy \`nextCursor\` unchanged into \`cursor\`; it is absent when the result set is exhausted. Each item is the flat {@link ProgramOut} — fetch \`GET /:id\` for the child-work roll-up. Read-only; org membership suffices. Strictly org-scoped.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const rows = await db
        .select()
        .from(program)
        .where(
          and(eq(program.organizationId, orgId), seekAfter(program.createdAt, program.id, cursor)),
        )
        .orderBy(desc(program.createdAt), desc(program.id))
        .limit(limit + 1);
      const { items, nextCursor } = pageResult(rows, limit, (r) => r.createdAt);
      return ok(c, pageOf(ProgramOut), { items: items.map(toOut), nextCursor });
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      status: 201,
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
      const status = await resolveContainerStatus(orgId, 'program', body.status ?? 'active');
      const inserted = await db
        .insert(program)
        .values({
          organizationId: orgId,
          name: body.name,
          summary: body.summary,
          description: body.description,
          ownerId: body.ownerId,
          status: status.status,
          statusId: status.statusId,
          health: body.health,
          visibility: body.visibility ?? 'public',
          createdBy: actorId,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('program insert returned no row');
      // Stream: record the creation (mirrors projects.ts) so it surfaces to owners/followers.
      // Post-commit and unread by the response, so it runs after the caller has been answered.
      // Stamped here rather than inside the deferred callback: `emitEvent` defaults `occurredAt`
      // to the moment it runs, which is now after the response, so under concurrent creates the
      // feed could order two entities against the order their rows were actually written. It is
      // also part of the dedupe key, so it needs to name the domain event, not the drain.
      const occurredAt = new Date();
      deferAfterResponse('program-created-event', () =>
        emitEvent({
          organizationId: orgId,
          kind: 'created',
          actorId,
          occurredAt,
          title: row.name,
          subject: { type: 'program', id: row.id, title: row.name },
        }),
      );
      deferAfterResponse('program-created-search-upsert', () =>
        enqueueSearchUpsert(orgId, 'program', row.id),
      );
      return created(c, ProgramOut, toOut(row));
    },
  )
  .get(
    '/:id/aggregate-detail',
    apiDoc({
      tag: 'Programs',
      summary: 'Get the bounded Program detail aggregate',
      response: ProgramDetailAggregate,
      description:
        'Returns the Program snapshot, visible-control capabilities, its named owner, and default rollup content in one request. It excludes project and work rosters until their tabs open.',
    }),
    zParam(aggregateIdParam),
    async (c) => {
      const { orgId, actorId, capabilities } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const aggregateRows = await db
        .select({ row: program, ownerRow: actor })
        .from(program)
        .leftJoin(actor, and(eq(program.ownerId, actor.id), eq(actor.organizationId, orgId)))
        .where(and(eq(program.id, id), eq(program.organizationId, orgId)))
        .limit(1);
      const aggregateRow = aggregateRows[0];
      if (!aggregateRow) throw new NotFoundError('Program not found');
      const { row, ownerRow } = aggregateRow;
      const taskView = await buildTaskViewCondition(orgId, actorId);
      const [projectCountRows, taskCountRows] = await Promise.all([
        db
          .select({ total: count(project.id) })
          .from(project)
          .where(
            and(
              eq(project.programId, id),
              eq(project.organizationId, orgId),
              isNull(project.archivedAt),
            ),
          ),
        db
          .select({ total: count(task.id) })
          .from(task)
          .leftJoin(project, eq(task.projectId, project.id))
          .where(
            and(
              eq(task.organizationId, orgId),
              isNull(task.archivedAt),
              or(
                eq(task.programId, id),
                and(
                  eq(project.programId, id),
                  eq(project.organizationId, orgId),
                  isNull(project.archivedAt),
                ),
              ),
              taskView,
            ),
          ),
      ]);

      return ok(c, ProgramDetailAggregate, {
        target: 'program',
        snapshot: {
          target: 'program',
          organizationId: row.organizationId,
          id: row.id,
          name: row.name,
          status: row.status,
          health: row.health,
          updatedAt: row.updatedAt.toISOString(),
        },
        viewer: { actorId },
        capabilities: detailCapabilities(capabilities),
        references: { owner: ownerRow ? actorReference(ownerRow) : null },
        defaultView: {
          program: {
            ...toOut(row),
            rollup: {
              projects: projectCountRows[0]?.total ?? 0,
              tasks: taskCountRows[0]?.total ?? 0,
            },
          },
        },
      });
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Programs',
      summary: 'Get program detail',
      response: ProgramDetail,
      description: `Fetch a program with counts of its visible projects and active tasks. The task count includes tasks attached directly to the program and tasks that belong to one of its projects. Docket applies the caller's task visibility before calculating the count. An absent or inaccessible program returns 404. Returns {@link ProgramDetail}. Use \`GET /:id/work\` to retrieve the tasks grouped by cycle and project.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadProgram(orgId, id);

      // Roll up the Program's child work: Projects pointing at it, and active Tasks under
      // it (attached directly via task.program_id OR via one of those Projects).
      const projectRows = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(
            eq(project.programId, id),
            eq(project.organizationId, orgId),
            isNull(project.archivedAt),
          ),
        );
      const projectIds = projectRows.map((p) => p.id);

      const taskRows = await db
        .select({
          id: task.id,
          teamId: task.teamId,
          projectId: task.projectId,
          programId: task.programId,
          visibility: task.visibility,
        })
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

      const canView = await buildTaskViewFilter(orgId, actorId);
      return ok(c, ProgramDetail, {
        ...toOut(row),
        rollup: { projects: projectIds.length, tasks: taskRows.filter(canView).length },
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
      description: `Update the supplied program fields and return the current {@link ProgramOut}. Omitted fields remain unchanged. Set \`description\`, \`ownerId\`, or \`health\` to null to clear it. \`status\` accepts \`active\`, \`paused\`, or \`archived\`; programs do not have a \`completed\` status. Changing \`visibility\` switches between organization-wide visibility and grant-only access. Because program grants extend to child projects and tasks, this operation requires \`manage\`. It does not add a status event to organization activity. An unavailable program returns 404.`,
    }),
    zParam(idParam),
    zJson(ProgramUpdate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const nextStatus =
        body.status === undefined
          ? undefined
          : await resolveContainerStatus(orgId, 'program', body.status);
      const updated = await db
        .update(program)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...clearableTextPatch('summary', body.summary),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          ...(nextStatus === undefined
            ? {}
            : { status: nextStatus.status, statusId: nextStatus.statusId }),
          ...(body.health !== undefined ? { health: body.health } : {}),
          ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
        })
        .where(and(eq(program.id, id), eq(program.organizationId, orgId)))
        .returning();
      const row = updated[0];
      if (!row) throw new NotFoundError('Program not found');
      if (body.status !== undefined) {
        await emitEvent({
          organizationId: orgId,
          kind: 'status_change',
          actorId,
          title: row.name,
          subject: { type: 'program', id: row.id, title: row.name },
          detail: { schema: 'docket.state_change', fromState: null, toState: row.status },
        });
      }
      await enqueueSearchUpsert(orgId, 'program', row.id);
      return ok(c, ProgramOut, toOut(row));
    },
  )
  .post(
    '/:id/labels',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Programs',
      summary: 'Add a label to a program',
      capability: 'manage',
      response: ProgramLabelLinked,
      description:
        'Add one workspace-wide Label to a Program without replacing its existing Labels. Repeating an existing link succeeds without another write.',
    }),
    zParam(idParam),
    zJson(ProgramLabelLink),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { labelId } = c.req.valid('json');
      await loadProgram(orgId, id);
      await db.transaction(async (tx) => {
        const refs = await labelsForSubject('program', orgId, id, tx);
        if (refs.some((label) => label.id === labelId)) return;
        const [existing, incoming] = await Promise.all([
          resolveAttachedLabels(
            orgId,
            refs.map((label) => label.id),
            tx,
          ),
          resolveLabelSet(orgId, [labelId], { dbh: tx }),
        ]);
        await attachLabels(tx, 'program', id, orgId, existing, incoming);
      });
      await enqueueSearchUpsert(orgId, 'program', id);
      return ok(c, ProgramLabelLinked, { programId: id, labelId, linked: true });
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
      description: `Permanently delete a program. The program must belong to the organization, and the caller needs the \`manage\` capability. Projects and tasks are not deleted, but they no longer belong to the program. Initiative links are removed. To preserve the program and its history, update its \`status\` to \`archived\` instead. Returns the deleted {@link ProgramOut}.`,
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
      await enqueueSearchDelete(orgId, 'program', row.id);
      return ok(c, ProgramOut, toOut(row));
    },
  )
  .get(
    '/:id/work',
    apiDoc({
      tag: 'Programs',
      summary: 'Get program work',
      response: ProgramWorkOut,
      description: `List the active tasks under a program, grouped by cycle and then by project. The result includes tasks attached directly to the program and tasks that belong to one of its projects. Unscheduled tasks appear in the no-cycle group, and tasks attached directly to the program appear in the no-project segment. Groups and segments preserve newest-task-first order. Use \`cycleId\` or \`projectId\` to narrow the result. Docket applies the caller's task visibility, and an absent or inaccessible program returns 404. Returns {@link ProgramWorkOut}.`,
    }),
    zParam(idParam),
    zQuery(ProgramWorkQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { cycleId, projectId } = c.req.valid('query');
      await loadProgram(orgId, id);

      // Projects under this Program; a task is "under the Program" if it carries the
      // Program directly (task.program_id) OR belongs to one of these Projects.
      const projectRows = await db
        .select({ id: project.id, name: project.name })
        .from(project)
        .where(
          and(
            eq(project.programId, id),
            eq(project.organizationId, orgId),
            isNull(project.archivedAt),
          ),
        );
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
      const canView = await buildTaskViewFilter(orgId, actorId);
      const visibleTaskRows = taskRows.filter(canView);

      // Names of any real cycles referenced, for the cycle-group labels. The window is selected
      // alongside the name because an unnamed cycle is named by its dates — the same `displayName`
      // derivation `cycle-helpers.toOut` applies, so a cycle reads identically on this board and on
      // the Cycles roster.
      const cycleIds = [
        ...new Set(visibleTaskRows.map((t) => t.cycleId).filter((v): v is string => !!v)),
      ];
      const cycleRows =
        cycleIds.length > 0
          ? await db
              .select({
                id: cycle.id,
                name: cycle.name,
                number: cycle.number,
                startsAt: cycle.startsAt,
                endsAt: cycle.endsAt,
              })
              .from(cycle)
              .where(and(eq(cycle.organizationId, orgId), inArray(cycle.id, cycleIds)))
          : [];
      const cycleById = new Map(cycleRows.map((cy) => [cy.id, cy]));

      // Group by cycle (null = "no cycle"), then segment by project (null = "no project").
      // A Map<cycleKey, Map<projectKey, tasks[]>> preserves first-seen ordering, which the
      // `desc(createdAt)` query fixes deterministically.
      // `'\0'` stands in for a null id because no ULID can contain it, so the sentinel cannot
      // collide with a real key. Written as an escape rather than a literal NUL byte: the raw
      // character made this file test as binary, so grep and every other text tool silently
      // skipped it — which is how a wrong claim about this file's search hooks got made.
      const groups = new Map<string, Map<string, TaskRow[]>>();
      for (const t of visibleTaskRows) {
        const cycleKey = t.cycleId ?? '\0';
        const projectKey = t.projectId ?? '\0';
        const byProject = groups.get(cycleKey) ?? new Map<string, TaskRow[]>();
        if (!groups.has(cycleKey)) groups.set(cycleKey, byProject);
        const bucket = byProject.get(projectKey) ?? [];
        if (!byProject.has(projectKey)) byProject.set(projectKey, bucket);
        bucket.push(t);
      }

      // One batched read for the whole work view; the grouping below just looks labels up.
      const labelsByTask = await labelsForSubjects(
        'task',
        orgId,
        visibleTaskRows.map((t) => t.id),
      );

      const payload: z.input<typeof ProgramWorkOut> = {
        groups: [...groups.entries()].map(([cycleKey, byProject]) => {
          const cy = cycleKey === '\0' ? null : cycleById.get(cycleKey);
          return {
            cycle:
              cy == null
                ? { id: null }
                : {
                    id: cy.id,
                    name: cy.name ?? null,
                    displayName: cy.name ?? defaultCycleName(cy.startsAt, cy.endsAt),
                    number: cy.number,
                  },
            segments: [...byProject.entries()].map(([projectKey, tasks]) => ({
              project:
                projectKey === '\0'
                  ? { id: null }
                  : {
                      id: projectKey,
                      /* v8 ignore next -- @preserve defensive: projectKey came from a project row, so its name is always in the map */
                      name: projectNameById.get(projectKey) ?? null,
                    },
              tasks: tasks.map((t) => taskToOut(t, labelsByTask.get(t.id) ?? [])),
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
      response: UpdateFeed,
      description: `List status updates for this program, newest first. Each Update carries a \`health\` value and free-text \`body\`; threaded discussion belongs in Comments instead. The response includes the people and agents who authored the returned updates. A missing or inaccessible program returns 404.`,
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

      const authorIds = [...new Set(rows.flatMap((row) => (row.authorId ? [row.authorId] : [])))];
      const authors =
        authorIds.length === 0
          ? []
          : await db
              .select({
                actorId: actor.id,
                displayName: actor.displayName,
                avatar: actor.avatar,
                kind: actor.kind,
              })
              .from(actor)
              .where(and(eq(actor.organizationId, orgId), inArray(actor.id, authorIds)));

      return ok(c, UpdateFeed, {
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
        authors,
      });
    },
  );
export default programs;
