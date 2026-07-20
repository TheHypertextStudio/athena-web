/**
 * `@docket/api` — projects router (mounted at `/v1/orgs/:orgId/projects`).
 */
import {
  actor,
  db,
  entityDisplay,
  initiative,
  initiativeProject,
  label,
  program,
  project,
  projectDependency,
  projectLabel,
  task,
  team,
} from '@docket/db';
import {
  CursorQuery,
  defaultEntityDisplay,
  pageOf,
  ProjectCreate,
  ProjectOut,
  ProjectOverviewOut,
  ProjectProgress,
  ProjectUpdate,
} from '@docket/types';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { pageResult, seekAfter } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { capabilityGuard } from '../permissions/capability-guard';
import { zJson, zParam, zQuery } from '../lib/validate';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import { emitEvent } from './event-emit';
import { projectDependencyRoutes } from './project-dependency-routes';

type ProjectRow = typeof project.$inferSelect;

function toOut(p: ProjectRow): z.input<typeof ProjectOut> {
  return {
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    summary: p.summary,
    description: p.description,
    status: p.status,
    health: p.health,
    leadId: p.leadId,
    teamId: p.teamId,
    programId: p.programId,
    startDate: p.startDate?.toISOString() ?? null,
    targetDate: p.targetDate?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Path-param schema for the single-project routes. */
const idParam = z.object({ id: z.string() });

/**
 * Assert that a referenced row belongs to the caller's org, or throw {@link NotFoundError}.
 *
 * @remarks
 * The work-layer FKs (`leadId → actor`, `programId → program`, `teamId → team`) target
 * each table's *global* primary key with no `organization_id` constraint baked into the
 * FK, so the database alone will happily accept a PATCH that points a project at an actor,
 * program, or team owned by a *different* tenant (data-model §0.2: tenant isolation is
 * enforced in the data-access layer, never by the bare FK). Before writing such a
 * reference we therefore re-read the target scoped by `eq(table.organizationId, orgId)` —
 * exactly as `POST /tasks` already does for its `teamId` — and 404 (existence-hiding: we
 * do not reveal that the row exists in another org) when it is absent. A `null`/`undefined`
 * `refId` is a no-op: clearing or leaving a nullable reference untouched needs no check.
 *
 * @param table - The org-scoped table the reference points at (`actor`/`program`/`team`).
 * @param orgId - The tenant the reference must belong to.
 * @param refId - The referenced row id (a no-op when `null`/`undefined`).
 * @param notFoundMessage - The {@link NotFoundError} message when the row is out-of-org.
 * @throws {NotFoundError} When the referenced row is missing or owned by another org.
 */
async function assertRefInOrg(
  table: typeof actor | typeof program | typeof team,
  orgId: string,
  refId: string | null | undefined,
  notFoundMessage: string,
): Promise<void> {
  if (refId === null || refId === undefined) return;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, refId), eq(table.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError(notFoundMessage);
}

/**
 * Validate that every requested Initiative association lives in the caller's org, or 404.
 *
 * @remarks
 * `ProjectCreate.initiativeIds` writes `initiative_project` join rows. The join keeps a
 * frozen `organization_id`, but the bare FK to `initiative.id` does not constrain the
 * tenant, so without this check a CREATE could link the new project to another tenant's
 * Initiative. We re-read each id scoped by `eq(initiative.organizationId, orgId)` and 404
 * (existence-hiding) on any miss. Duplicate ids in the request are de-duplicated so the
 * join's composite PK never collides within a single create.
 *
 * @param orgId - The tenant the initiatives must belong to.
 * @param initiativeIds - The requested association ids (may be empty/undefined).
 * @returns the de-duplicated, validated initiative ids to link.
 * @throws {NotFoundError} When any id is missing or owned by another org.
 */
async function validatedInitiativeIds(
  orgId: string,
  initiativeIds: readonly string[] | undefined,
): Promise<string[]> {
  if (!initiativeIds || initiativeIds.length === 0) return [];
  const unique = [...new Set(initiativeIds)];
  const rows = await db
    .select({ id: initiative.id })
    .from(initiative)
    .where(and(inArray(initiative.id, unique), eq(initiative.organizationId, orgId)));
  const found = new Set(rows.map((r) => r.id));
  for (const id of unique) {
    if (!found.has(id)) throw new NotFoundError('Initiative not found');
  }
  return unique;
}

/** Validate and de-duplicate organization-global Project Labels. */
async function validatedLabelIds(
  orgId: string,
  labelIds: readonly string[] | undefined,
): Promise<string[]> {
  const unique = [...new Set(labelIds ?? [])];
  if (unique.length === 0) return [];
  const rows = await db
    .select({ id: label.id })
    .from(label)
    .where(and(eq(label.organizationId, orgId), isNull(label.teamId), inArray(label.id, unique)));
  if (rows.length !== unique.length) throw new NotFoundError('Label not found');
  return unique;
}

/**
 * Compute a Project's weighted completion roll-up from its Tasks.
 *
 * @remarks
 * A Task is "completed" when its `completedAt` timestamp is set (data-model §3.3:
 * lifecycle rows carry `completed_at`). Weight is the sum of Task estimates when ANY
 * task in the project carries one; when no estimates exist it falls back to a plain
 * Task count (each Task weighs `1`). `percent` is `completedWeight / totalWeight`, or
 * `0` for an empty project.
 *
 * @param rows - The project's tasks (each with its `estimate` and `completedAt`).
 * @returns the {@link ProjectProgress} payload.
 */
function computeProgress(
  rows: { estimate: number | null; completedAt: Date | null }[],
): z.input<typeof ProjectProgress> {
  const taskCount = rows.length;
  const completedCount = rows.filter((r) => r.completedAt !== null).length;
  const hasEstimates = rows.some((r) => r.estimate !== null && r.estimate > 0);

  let totalWeight: number;
  let completedWeight: number;
  if (hasEstimates) {
    // Estimate-weighted: bigger tasks count for more. Treat a missing estimate as 0.
    totalWeight = rows.reduce((sum, r) => sum + (r.estimate ?? 0), 0);
    completedWeight = rows
      .filter((r) => r.completedAt !== null)
      .reduce((sum, r) => sum + (r.estimate ?? 0), 0);
  } else {
    // Count fallback: every task weighs 1.
    totalWeight = taskCount;
    completedWeight = completedCount;
  }

  const percent = totalWeight > 0 ? completedWeight / totalWeight : 0;
  return { percent, completedWeight, totalWeight, taskCount, completedCount };
}

/** Projects router: org-scoped CRUD + weighted-progress; `contribute` to edit, `manage` to delete. */
const projects = new Hono<AppEnv>()
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Projects',
      summary: 'Create a project',
      capability: 'contribute',
      response: ProjectOut,
      description: `Create a bounded, dated effort (a Project moves \`planned → active → completed\`, or is \`canceled\`). The \`organizationId\` comes from the path. \`startDate\`/\`targetDate\` are optional ISO dates parsed to timestamps; \`leadId\` and \`teamId\` are optional references and \`initiativeIds\` is an optional set of themes to associate at creation. Tenant isolation: a supplied \`leadId\` (Actor) and \`teamId\` (Team) are each re-read scoped to the caller's org and rejected with 404 (\`Lead not found\` / \`Team not found\`, existence-hiding) when they belong to another tenant — the bare FKs target global PKs without a tenant constraint, so this guard is what prevents cross-org attachment. (\`programId\` is not accepted on create; set it later via PATCH.) Every \`initiativeIds\` entry is validated to live in the org BEFORE the write (404 \`Initiative not found\` on any miss) and de-duplicated so the \`initiative_project\` join's composite PK never collides. The project row and its initiative links are written in a single transaction, so a partial create (project saved but links lost) is impossible. Side effect: emits a \`created\` observation. Requires \`contribute\`. Returns the created {@link ProjectOut}. Track completion via \`GET /:id/progress\`.`,
    }),
    zJson(ProjectCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');

      // Tenant isolation: a body-provided lead/team must live in the caller's org. The bare
      // FK references each table's global PK, so without this a CREATE could attach another
      // tenant's actor/team to this project — exactly the gap PATCH already closes. Omitted
      // fields are no-ops inside the helper. (`programId` is not on ProjectCreate.)
      await assertRefInOrg(actor, orgId, body.leadId, 'Lead not found');
      await assertRefInOrg(team, orgId, body.teamId, 'Team not found');

      // `initiativeIds` writes `initiative_project` association rows; validate each lives in
      // the caller's org BEFORE the transaction so a bad id rejects the whole create.
      const [initiativeIds, labelIds] = await Promise.all([
        validatedInitiativeIds(orgId, body.initiativeIds),
        validatedLabelIds(orgId, body.labelIds),
      ]);

      const row = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(project)
          .values({
            organizationId: orgId,
            name: body.name,
            summary: body.summary,
            description: body.description,
            leadId: body.leadId,
            teamId: body.teamId,
            startDate: body.startDate ? new Date(body.startDate) : undefined,
            targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
            createdBy: actorId,
          })
          .returning();
        const created = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!created) throw new Error('project insert returned no row');

        // Persist the m2m Initiative links inside the same transaction so a partial create
        // (project saved, links lost) is impossible.
        if (initiativeIds.length > 0) {
          await tx.insert(initiativeProject).values(
            initiativeIds.map((initiativeId) => ({
              initiativeId,
              projectId: created.id,
              organizationId: orgId,
            })),
          );
        }
        if (labelIds.length > 0) {
          await tx.insert(projectLabel).values(
            labelIds.map((labelId) => ({
              projectId: created.id,
              labelId,
              organizationId: orgId,
            })),
          );
        }
        return created;
      });

      await emitEvent({
        organizationId: orgId,
        kind: 'created',
        actorId,
        title: row.name,
        subject: { type: 'project', id: row.id, title: row.name },
      });
      await enqueueSearchUpsert(orgId, 'project', row.id);
      return ok(c, ProjectOut, toOut(row));
    },
  )
  .get(
    '/',
    apiDoc({
      tag: 'Projects',
      summary: 'List projects',
      response: pageOf(ProjectOut),
      description: `List the organization's projects — the bounded, dated efforts that sit between ongoing Programs above and Tasks/Milestones below. Keyset-paginated newest-first by \`createdAt\` (\`id\` tiebreak); the optional \`limit\` yields a bounded page plus \`nextCursor\` (omit for the full list). Each item is the flat {@link ProjectOut} (no progress roll-up — call \`GET /:id/progress\` for weighted completion, or \`GET /:id/rollup\` for the detail-screen extras). Read-only; org membership suffices. Strictly org-scoped.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      // Keyset-paginate newest-first (createdAt, id tiebreak). `limit` is optional: omitted returns
      // the full list as before; supplied returns a bounded page + `nextCursor`.
      const base = db
        .select()
        .from(project)
        .where(
          and(eq(project.organizationId, orgId), seekAfter(project.createdAt, project.id, cursor)),
        )
        .orderBy(desc(project.createdAt), desc(project.id));
      const rows = await (limit === undefined ? base : base.limit(limit + 1));
      const { items, nextCursor } = pageResult(rows, limit, (r) => r.createdAt);
      return ok(c, pageOf(ProjectOut), { items: items.map(toOut), nextCursor });
    },
  )
  .get(
    '/overview',
    apiDoc({
      tag: 'Projects',
      summary: 'Get Project portfolio overview',
      response: ProjectOverviewOut,
      description:
        'Returns every visible Project with its decoupled display metadata, direct task completion counts, and Project dependency edges in one bounded read. The same aggregate powers list, dependency, and timeline lenses so switching views never changes the underlying portfolio scope.',
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const [projectRows, taskRows, dependencyRows, displayRows] = await Promise.all([
        db
          .select()
          .from(project)
          .where(eq(project.organizationId, orgId))
          .orderBy(desc(project.createdAt), desc(project.id)),
        db
          .select({ projectId: task.projectId, completedAt: task.completedAt })
          .from(task)
          .where(eq(task.organizationId, orgId)),
        db
          .select({
            blockingProjectId: projectDependency.blockingProjectId,
            blockedProjectId: projectDependency.blockedProjectId,
          })
          .from(projectDependency)
          .where(eq(projectDependency.organizationId, orgId)),
        db
          .select()
          .from(entityDisplay)
          .where(
            and(eq(entityDisplay.organizationId, orgId), eq(entityDisplay.subjectType, 'project')),
          ),
      ]);

      const taskCounts = new Map<string, { total: number; completed: number }>();
      for (const row of taskRows) {
        if (!row.projectId) continue;
        const current = taskCounts.get(row.projectId) ?? { total: 0, completed: 0 };
        current.total += 1;
        if (row.completedAt) current.completed += 1;
        taskCounts.set(row.projectId, current);
      }
      const blockedBy = new Map<string, string[]>();
      const blocks = new Map<string, string[]>();
      for (const row of dependencyRows) {
        blockedBy.set(row.blockedProjectId, [
          ...(blockedBy.get(row.blockedProjectId) ?? []),
          row.blockingProjectId,
        ]);
        blocks.set(row.blockingProjectId, [
          ...(blocks.get(row.blockingProjectId) ?? []),
          row.blockedProjectId,
        ]);
      }
      const displays = new Map(displayRows.map((row) => [row.subjectId, row]));

      return ok(c, ProjectOverviewOut, {
        items: projectRows.map((row) => {
          const counts = taskCounts.get(row.id) ?? { total: 0, completed: 0 };
          const display = displays.get(row.id);
          return {
            ...toOut(row),
            display: display
              ? {
                  subjectType: 'project' as const,
                  subjectId: row.id,
                  iconKey: display.iconKey,
                  colorKey: display.colorKey,
                  customized: true,
                }
              : defaultEntityDisplay('project', row.id),
            taskCount: counts.total,
            completedTaskCount: counts.completed,
            blockedByIds: [...(blockedBy.get(row.id) ?? [])].sort(),
            blocksIds: [...(blocks.get(row.id) ?? [])].sort(),
          };
        }),
      });
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Projects',
      summary: 'Get a project',
      response: ProjectOut,
      description: `Fetch a single project by id, scoped to the caller's org (404 \`Project not found\` when absent or cross-tenant). Returns the flat {@link ProjectOut} — its lifecycle \`status\`, \`health\` verdict, \`leadId\`/\`teamId\`/\`programId\` references, and \`startDate\`/\`targetDate\`. This read does NOT include the weighted completion roll-up or the milestone/initiative/activity extras; use \`GET /:id/progress\` and \`GET /:id/rollup\` respectively for those. Read-only; org membership suffices.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(project)
        .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Project not found');
      return ok(c, ProjectOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Projects',
      summary: 'Update a project',
      capability: 'contribute',
      response: ProjectOut,
      description: `Partially update a project. Every field is optional: an absent key leaves the column untouched, while \`null\` (where allowed) clears a nullable column. A re-pointed \`leadId\` (Actor), \`programId\` (Program), or \`teamId\` (Team) is re-validated to live in the caller's org — 404 (\`Lead not found\` / \`Program not found\` / \`Team not found\`, existence-hiding) on a cross-tenant id; clearing (\`null\`) or omitting a reference skips the check. An empty patch body is a valid no-op: rather than issue an empty UPDATE the handler re-reads the row (still enforcing the org-scoped existence check) and returns it unchanged. Setting \`programId\` is how a project is filed under a Program; setting \`status\`/\`health\`/dates drives the project's roll-ups and its bar on the initiative timeline. Side effect: when \`status\` is included, emits a \`status_change\` observation carrying the new status (other field edits emit nothing). 404 (\`Project not found\`) when absent or cross-tenant. Requires \`contribute\`. Returns the updated {@link ProjectOut}.`,
    }),
    zParam(idParam),
    zJson(ProjectUpdate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      // Tenant isolation: a re-pointed lead/program/team must live in the caller's org.
      // The bare FK references each table's global PK, so without this a PATCH could
      // attach another tenant's actor/program/team to this project. Clearing (null) or
      // omitting a field is a no-op inside the helper.
      await assertRefInOrg(actor, orgId, body.leadId, 'Lead not found');
      await assertRefInOrg(program, orgId, body.programId, 'Program not found');
      await assertRefInOrg(team, orgId, body.teamId, 'Team not found');
      const labelIds = await validatedLabelIds(orgId, body.labelIds);

      const patch = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.leadId !== undefined ? { leadId: body.leadId } : {}),
        ...(body.programId !== undefined ? { programId: body.programId } : {}),
        ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.health !== undefined ? { health: body.health } : {}),
        ...(body.startDate !== undefined
          ? { startDate: body.startDate ? new Date(body.startDate) : null }
          : {}),
        ...(body.targetDate !== undefined
          ? { targetDate: body.targetDate ? new Date(body.targetDate) : null }
          : {}),
      };
      const where = and(eq(project.id, id), eq(project.organizationId, orgId));

      // An empty patch body is a valid no-op: Drizzle rejects an empty `.set({})`, so
      // re-read the row (still enforcing the org-scoped existence check) and return it.
      if (Object.keys(patch).length === 0 && body.labelIds === undefined) {
        const rows = await db.select().from(project).where(where).limit(1);
        const existing = rows[0];
        if (!existing) throw new NotFoundError('Project not found');
        return ok(c, ProjectOut, toOut(existing));
      }

      const row = await db.transaction(async (tx) => {
        const updated =
          Object.keys(patch).length > 0
            ? await tx.update(project).set(patch).where(where).returning()
            : await tx.select().from(project).where(where).limit(1);
        const changed = updated[0];
        if (!changed) return undefined;
        if (body.labelIds !== undefined) {
          await tx.delete(projectLabel).where(eq(projectLabel.projectId, id));
          if (labelIds.length > 0) {
            await tx
              .insert(projectLabel)
              .values(
                labelIds.map((labelId) => ({ projectId: id, labelId, organizationId: orgId })),
              );
          }
        }
        return changed;
      });
      if (!row) throw new NotFoundError('Project not found');

      if (body.status !== undefined) {
        await emitEvent({
          organizationId: orgId,
          kind: 'status_change',
          actorId,
          title: row.name,
          subject: { type: 'project', id: row.id, title: row.name },
          detail: { schema: 'docket.state_change', fromState: null, toState: row.status },
        });
      }
      await enqueueSearchUpsert(orgId, 'project', row.id);
      return ok(c, ProjectOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Projects',
      summary: 'Delete a project',
      capability: 'manage',
      response: ProjectOut,
      description: `Permanently delete a project, scoped to the caller's org (404 \`Project not found\` when absent or cross-tenant). Requires \`manage\` (not \`contribute\`, which gates ordinary edits) because deletion is irreversible teardown of a container that Tasks and Milestones hang off and that feeds Program/Initiative roll-ups. Dependent rows (Milestones, the project's Tasks' \`project_id\`, \`initiative_project\` edges) are resolved by the database's foreign-key rules rather than re-implemented here. To retire a project without losing it, PATCH its \`status\` to \`completed\` or \`canceled\` instead. Returns the deleted {@link ProjectOut} as a tombstone.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await db.transaction(async (tx) => {
        const candidates = await tx
          .select()
          .from(project)
          .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
          .limit(1);
        const candidate = candidates[0];
        if (!candidate) return undefined;
        await tx
          .delete(entityDisplay)
          .where(
            and(
              eq(entityDisplay.organizationId, orgId),
              eq(entityDisplay.subjectType, 'project'),
              eq(entityDisplay.subjectId, id),
            ),
          );
        const deleted = await tx.delete(project).where(eq(project.id, id)).returning();
        return deleted[0];
      });
      if (!row) throw new NotFoundError('Project not found');
      await enqueueSearchDelete(orgId, 'project', row.id);
      return ok(c, ProjectOut, toOut(row));
    },
  )
  .get(
    '/:id/progress',
    apiDoc({
      tag: 'Projects',
      summary: 'Get project progress',
      response: ProjectProgress,
      description: `Compute a project's weighted completion roll-up across its Tasks. A Task counts as completed when its \`completedAt\` timestamp is set. Weighting is estimate-based when ANY task in the project carries a positive \`estimate\` (bigger tasks count for more; a missing estimate is treated as 0); when no task is estimated it falls back to a plain count where each task weighs 1. \`percent\` is \`completedWeight / totalWeight\`, or exactly \`0\` for an empty project (never NaN). \`taskCount\`/\`completedCount\` are always the raw row counts regardless of which weighting mode applied, so a client can show both "N of M tasks" and the weighted bar. The project must exist in the caller's org (404 \`Project not found\`); tasks are read org-scoped as defense in depth. Read-only; org membership suffices. Returns {@link ProjectProgress}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');

      // Existence + tenant check: the project must live in the caller's org.
      const projectRows = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
        .limit(1);
      if (!projectRows[0]) throw new NotFoundError('Project not found');

      // Pull this project's tasks, scoped to the same org as a defense-in-depth check.
      const taskRows = await db
        .select({ estimate: task.estimate, completedAt: task.completedAt })
        .from(task)
        .where(and(eq(task.projectId, id), eq(task.organizationId, orgId)));

      return ok(c, ProjectProgress, computeProgress(taskRows));
    },
  )
  .route('/', projectDependencyRoutes);

export default projects;
