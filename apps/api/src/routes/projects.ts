/**
 * `@docket/api` — projects router (mounted at `/v1/orgs/:orgId/projects`).
 */
import {
  actor,
  db,
  entityDisplay,
  initiative,
  initiativeProject,
  milestone,
  organization,
  program,
  project,
  projectDependency,
  task,
  team,
} from '@docket/db';
import {
  CursorQuery,
  defaultEntityDisplay,
  pageOf,
  ProjectCreate,
  ProjectDetailAggregate,
  ProjectId,
  ProjectLabelLink,
  ProjectLabelLinked,
  ProjectOut,
  ProjectOverviewOut,
  ProjectProgress,
  ProjectUpdate,
} from '@docket/types';
import type { ProgramOut, TeamOut } from '@docket/types';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { deferAfterResponse } from '../lib/after-response';
import { clearableTextPatch } from '../lib/clearable-text';
import { detailCapabilities } from '../lib/detail-capabilities';
import { guardsInOrder } from '../lib/guards-in-order';
import { assertPlanningDateRange, planningDatePatch } from '../lib/planning-timeframe';
import {
  attachLabels,
  labelsForSubject,
  replaceLabels,
  resolveAttachedLabels,
  resolveLabelSet,
} from '../lib/labels';
import { created, ok } from '../lib/ok';
import { resolveContainerStatus } from '../lib/work-status';
import { pageResult, seekAfter } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { capabilityGuard } from '../permissions/capability-guard';
import { zJson, zParam, zQuery } from '../lib/validate';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import { emitEvent } from './event-emit';
import { projectDependencyRoutes } from './project-dependency-routes';
import { buildTaskViewFilter } from './task-helpers';

type ProjectRow = typeof project.$inferSelect;

function toOut(p: ProjectRow): z.input<typeof ProjectOut> {
  return {
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    summary: p.summary,
    description: p.description,
    status: p.status,
    priority: p.priority,
    health: p.health,
    leadId: p.leadId,
    teamId: p.teamId,
    programId: p.programId,
    startDate: p.startDate?.toISOString() ?? null,
    startDateResolution: p.startDateResolution,
    startDateFiscalYearStartMonth: p.startDateFiscalYearStartMonth,
    targetDate: p.targetDate?.toISOString() ?? null,
    targetDateResolution: p.targetDateResolution,
    targetDateFiscalYearStartMonth: p.targetDateFiscalYearStartMonth,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Project one Team row into the bounded detail reference contract. */
function teamToOut(row: typeof team.$inferSelect): z.input<typeof TeamOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    key: row.key,
    description: row.description,
    summary: row.summary,
    workflowStates: row.workflowStates,
    triageEnabled: row.triageEnabled,
    agentGuidance: row.agentGuidance,
    approvalRouting: row.approvalRouting,
  };
}

/** Project one Program row into the bounded Project detail reference contract. */
function programToOut(row: typeof program.$inferSelect): z.input<typeof ProgramOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    summary: row.summary,
    ownerId: row.ownerId,
    status: row.status,
    health: row.health,
    visibility: row.visibility,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Project one named actor without loading an organization member roster. */
function actorReference(row: typeof actor.$inferSelect) {
  return { actorId: row.id, displayName: row.displayName, avatar: row.avatar };
}

/** Path-param schema for the single-project routes. */
const idParam = z.object({ id: z.string() });
/** The aggregate route refuses malformed Project ids before it can start a data read. */
const aggregateIdParam = z.object({ id: ProjectId });

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
      status: 201,
      tag: 'Projects',
      summary: 'Create a project',
      capability: 'contribute',
      response: ProjectOut,
      description: `Create a bounded, dated effort (a Project moves \`planned → active → completed\`, or is \`canceled\`). The \`organizationId\` comes from the path. \`startDate\`/\`targetDate\` are optional ISO dates parsed to timestamps; \`leadId\`, \`teamId\`, and \`programId\` are optional references, \`status\`/\`health\` optionally set the initial lifecycle state (status defaults to \`planned\`), and \`initiativeIds\` is an optional set of themes to associate at creation. Tenant isolation: a supplied \`leadId\` (Actor), \`teamId\` (Team), and \`programId\` (Program) are each re-read scoped to the caller's org and rejected with 404 (\`Lead not found\` / \`Team not found\` / \`Program not found\`, existence-hiding) when they belong to another tenant — the bare FKs target global PKs without a tenant constraint, so this guard is what prevents cross-org attachment. Every \`initiativeIds\` entry is validated to live in the org BEFORE the write (404 \`Initiative not found\` on any miss) and de-duplicated so the \`initiative_project\` join's composite PK never collides. The project row and its initiative links are written in a single transaction, so a partial create (project saved but links lost) is impossible. Side effect: emits a \`created\` observation. Requires \`contribute\`. Returns the created {@link ProjectOut}. Track completion via \`GET /:id/progress\`.`,
    }),
    zJson(ProjectCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');

      // Tenant isolation: a body-provided lead/team/program must live in the caller's org.
      // The bare FK references each table's global PK, so without this a CREATE could attach
      // another tenant's actor/team/program to this project — exactly the gap PATCH already
      // closes. Omitted fields are no-ops inside the helper.
      //
      // Independent reads, so they run together rather than as three serial round trips;
      // `guardsInOrder` keeps the reported failure the earliest-listed one either way.
      await guardsInOrder([
        assertRefInOrg(actor, orgId, body.leadId, 'Lead not found'),
        assertRefInOrg(team, orgId, body.teamId, 'Team not found'),
        assertRefInOrg(program, orgId, body.programId, 'Program not found'),
      ]);

      // `initiativeIds` writes `initiative_project` association rows; validate each lives in
      // the caller's org BEFORE the transaction so a bad id rejects the whole create.
      // A Project's status is a key into the workspace's own Project statuses, resolved here so
      // an unknown key is a 422 naming the keys that would work.
      const status = await resolveContainerStatus(orgId, 'project', body.status ?? 'planned');
      const [initiativeIds, labels] = await Promise.all([
        validatedInitiativeIds(orgId, body.initiativeIds),
        // Through the shared resolver, so a project obeys label-group exclusivity exactly as a
        // task does. Resolved against the project's own team, so a team-limited label applies.
        resolveLabelSet(orgId, body.labelIds, { teamId: body.teamId }),
      ]);

      const row = await db.transaction(async (tx) => {
        const [settings] = await tx
          .select({ fiscalYearStartMonth: organization.fiscalYearStartMonth })
          .from(organization)
          .where(eq(organization.id, orgId))
          .limit(1);
        /* v8 ignore next -- @preserve actor context proves the workspace exists */
        if (!settings) throw new NotFoundError('Organization not found');
        const start = planningDatePatch(
          { date: body.startDate, resolution: body.startDateResolution },
          settings.fiscalYearStartMonth,
          'start',
          'startDate',
          'startDateResolution',
        );
        const target = planningDatePatch(
          { date: body.targetDate, resolution: body.targetDateResolution },
          settings.fiscalYearStartMonth,
          'target',
          'targetDate',
          'targetDateResolution',
        );
        assertPlanningDateRange(start?.date ?? null, target?.date ?? null);
        const inserted = await tx
          .insert(project)
          .values({
            organizationId: orgId,
            name: body.name,
            summary: body.summary,
            description: body.description,
            leadId: body.leadId,
            teamId: body.teamId,
            programId: body.programId,
            status: status.status,
            statusId: status.statusId,
            health: body.health,
            ...(start === undefined
              ? {}
              : {
                  startDate: start.date,
                  startDateResolution: start.resolution,
                  startDateFiscalYearStartMonth: start.fiscalYearStartMonth,
                }),
            ...(target === undefined
              ? {}
              : {
                  targetDate: target.date,
                  targetDateResolution: target.resolution,
                  targetDateFiscalYearStartMonth: target.fiscalYearStartMonth,
                }),
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
        if (labels.length > 0) {
          await replaceLabels(tx, 'project', created.id, orgId, labels);
        }
        return created;
      });

      // Both effects run after the row is committed and neither contributes to the response, so
      // the caller does not wait for them. That matters here more than anywhere: emitting an
      // event opens its own transaction and fans out to recipients, automations and indexing
      // jobs, which is most of what a create used to cost. A brand-new project also has no
      // inbound mentions to reconcile and no search row anyone is about to read, so there is
      // nothing for deferring to race — unlike an edit to existing prose, which stays awaited.
      // Stamped here rather than inside the deferred callback: `emitEvent` defaults `occurredAt`
      // to the moment it runs, which is now after the response, so under concurrent creates the
      // feed could order two entities against the order their rows were actually written. It is
      // also part of the dedupe key, so it needs to name the domain event, not the drain.
      const occurredAt = new Date();
      deferAfterResponse('project-created-event', () =>
        emitEvent({
          organizationId: orgId,
          kind: 'created',
          actorId,
          occurredAt,
          title: row.name,
          subject: { type: 'project', id: row.id, title: row.name },
        }),
      );
      deferAfterResponse('project-created-search-upsert', () =>
        enqueueSearchUpsert(orgId, 'project', row.id),
      );
      return created(c, ProjectOut, toOut(row));
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
        'Returns every visible Project with its decoupled display metadata, task completion counts drawn only from Tasks the caller can view, and Project dependency edges in one bounded read. The same caller-visible aggregate powers list, dependency, and timeline lenses so switching views never changes the underlying portfolio scope.',
    }),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const [projectRows, taskRows, dependencyRows, displayRows, milestoneRows] = await Promise.all(
        [
          db
            .select()
            .from(project)
            .where(eq(project.organizationId, orgId))
            .orderBy(desc(project.createdAt), desc(project.id)),
          db
            .select({
              id: task.id,
              teamId: task.teamId,
              projectId: task.projectId,
              programId: task.programId,
              visibility: task.visibility,
              completedAt: task.completedAt,
            })
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
              and(
                eq(entityDisplay.organizationId, orgId),
                eq(entityDisplay.subjectType, 'project'),
              ),
            ),
          db
            .select({
              id: milestone.id,
              projectId: milestone.projectId,
              name: milestone.name,
              targetDate: milestone.targetDate,
            })
            .from(milestone)
            .where(eq(milestone.organizationId, orgId))
            .orderBy(milestone.sort, milestone.id),
        ],
      );

      const canView = await buildTaskViewFilter(orgId, actorId);
      const taskCounts = new Map<string, { total: number; completed: number }>();
      for (const row of taskRows.filter(canView)) {
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
      // Milestones grouped per Project so each overview row carries its own checkpoint markers
      // without an N+1 read. Undated milestones are kept: the timeline decides how to treat them.
      const milestonesByProject = new Map<
        string,
        { id: string; name: string; targetDate: string | null }[]
      >();
      for (const row of milestoneRows) {
        const bucket = milestonesByProject.get(row.projectId) ?? [];
        bucket.push({
          id: row.id,
          name: row.name,
          targetDate: row.targetDate ? row.targetDate.toISOString() : null,
        });
        milestonesByProject.set(row.projectId, bucket);
      }

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
                  customColor: display.customColor,
                  coverImage: display.coverImage,
                  customized: true,
                }
              : defaultEntityDisplay('project', row.id),
            milestones: milestonesByProject.get(row.id) ?? [],
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
    '/:id/aggregate-detail',
    apiDoc({
      tag: 'Projects',
      summary: 'Get the bounded Project detail aggregate',
      response: ProjectDetailAggregate,
      description:
        'Returns the Project snapshot, visible-control capabilities, its named references, and the default document content in one request. It excludes organization-wide pickers and inactive sections.',
    }),
    zParam(aggregateIdParam),
    async (c) => {
      const { orgId, actorId, capabilities } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(project)
        .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Project not found');

      const [taskRows, programRows, teamRows, leadRows] = await Promise.all([
        db
          .select({
            id: task.id,
            teamId: task.teamId,
            projectId: task.projectId,
            programId: task.programId,
            visibility: task.visibility,
            estimate: task.estimate,
            completedAt: task.completedAt,
          })
          .from(task)
          .where(and(eq(task.organizationId, orgId), eq(task.projectId, row.id))),
        row.programId === null
          ? Promise.resolve([])
          : db
              .select()
              .from(program)
              .where(and(eq(program.id, row.programId), eq(program.organizationId, orgId)))
              .limit(1),
        row.teamId === null
          ? Promise.resolve([])
          : db
              .select()
              .from(team)
              .where(and(eq(team.id, row.teamId), eq(team.organizationId, orgId)))
              .limit(1),
        row.leadId === null
          ? Promise.resolve([])
          : db
              .select()
              .from(actor)
              .where(and(eq(actor.id, row.leadId), eq(actor.organizationId, orgId)))
              .limit(1),
      ]);
      const canView = await buildTaskViewFilter(orgId, actorId);
      const visibleTaskRows = taskRows.filter(canView);

      return ok(c, ProjectDetailAggregate, {
        target: 'project',
        snapshot: {
          target: 'project',
          organizationId: row.organizationId,
          id: row.id,
          name: row.name,
          status: row.status,
          priority: row.priority,
          health: row.health,
          updatedAt: row.updatedAt.toISOString(),
        },
        viewer: { actorId },
        capabilities: detailCapabilities(capabilities),
        references: {
          lead: leadRows[0] ? actorReference(leadRows[0]) : null,
          program: programRows[0] ? programToOut(programRows[0]) : null,
          team: teamRows[0] ? teamToOut(teamRows[0]) : null,
        },
        defaultView: { project: toOut(row), progress: computeProgress(visibleTaskRows) },
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
      // The project's team can move in the same request; resolve against whichever it ends up on.
      const existingTeam = (
        await db
          .select({ teamId: project.teamId })
          .from(project)
          .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
          .limit(1)
      )[0]?.teamId;
      const labels = await resolveLabelSet(orgId, body.labelIds, {
        teamId: body.teamId ?? existingTeam ?? null,
      });

      const nextStatus =
        body.status === undefined
          ? undefined
          : await resolveContainerStatus(orgId, 'project', body.status);
      const where = and(eq(project.id, id), eq(project.organizationId, orgId));

      const row = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(project).where(where).limit(1).for('update');
        if (!current) return undefined;
        const [settings] = await tx
          .select({ fiscalYearStartMonth: organization.fiscalYearStartMonth })
          .from(organization)
          .where(eq(organization.id, orgId))
          .limit(1);
        /* v8 ignore next -- @preserve the Project's organization FK proves this row exists */
        if (!settings) throw new NotFoundError('Organization not found');
        const start = planningDatePatch(
          { date: body.startDate, resolution: body.startDateResolution },
          settings.fiscalYearStartMonth,
          'start',
          'startDate',
          'startDateResolution',
        );
        const target = planningDatePatch(
          { date: body.targetDate, resolution: body.targetDateResolution },
          settings.fiscalYearStartMonth,
          'target',
          'targetDate',
          'targetDateResolution',
        );
        assertPlanningDateRange(
          start === undefined ? current.startDate : start.date,
          target === undefined ? current.targetDate : target.date,
        );
        const patch: Partial<typeof project.$inferInsert> = {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...clearableTextPatch('summary', body.summary),
          ...clearableTextPatch('description', body.description),
          ...(body.leadId !== undefined ? { leadId: body.leadId } : {}),
          ...(body.programId !== undefined ? { programId: body.programId } : {}),
          ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
          ...(nextStatus === undefined
            ? {}
            : { status: nextStatus.status, statusId: nextStatus.statusId }),
          ...(body.health !== undefined ? { health: body.health } : {}),
          ...(start === undefined
            ? {}
            : {
                startDate: start.date,
                startDateResolution: start.resolution,
                startDateFiscalYearStartMonth: start.fiscalYearStartMonth,
              }),
          ...(target === undefined
            ? {}
            : {
                targetDate: target.date,
                targetDateResolution: target.resolution,
                targetDateFiscalYearStartMonth: target.fiscalYearStartMonth,
              }),
        };
        const updated =
          Object.keys(patch).length > 0
            ? await tx.update(project).set(patch).where(where).returning()
            : [current];
        const changed = updated[0];
        if (!changed) return undefined;
        if (body.labelIds !== undefined) {
          await replaceLabels(tx, 'project', id, orgId, labels);
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
  .post(
    '/:id/labels',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Projects',
      summary: 'Add a label to a project',
      capability: 'contribute',
      response: ProjectLabelLinked,
      description:
        'Add one eligible Label to a Project without replacing existing Labels. Repeating an existing link succeeds without another write.',
    }),
    zParam(idParam),
    zJson(ProjectLabelLink),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { labelId } = c.req.valid('json');
      const [row] = await db
        .select({ teamId: project.teamId })
        .from(project)
        .where(and(eq(project.organizationId, orgId), eq(project.id, id)))
        .limit(1);
      if (!row) throw new NotFoundError('Project not found');
      await db.transaction(async (tx) => {
        const refs = await labelsForSubject('project', orgId, id, tx);
        if (refs.some((label) => label.id === labelId)) return;
        const [existing, incoming] = await Promise.all([
          resolveAttachedLabels(
            orgId,
            refs.map((label) => label.id),
            tx,
          ),
          resolveLabelSet(orgId, [labelId], { teamId: row.teamId, dbh: tx }),
        ]);
        await attachLabels(tx, 'project', id, orgId, existing, incoming);
      });
      await enqueueSearchUpsert(orgId, 'project', id);
      return ok(c, ProjectLabelLinked, { projectId: id, labelId, linked: true });
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
      description: `Compute a project's weighted completion roll-up across the Tasks the caller can view. A Task counts as completed when its \`completedAt\` timestamp is set. Weighting is estimate-based when ANY visible task in the project carries a positive \`estimate\` (bigger tasks count for more; a missing estimate is treated as 0); when no visible task is estimated it falls back to a plain count where each task weighs 1. \`percent\` is \`completedWeight / totalWeight\`, or exactly \`0\` for an empty visible set (never NaN). \`taskCount\`/\`completedCount\` are always the raw visible-row counts regardless of which weighting mode applied, so a client can show both "N of M tasks" and the weighted bar. The project must exist in the caller's org (404 \`Project not found\`); tasks are read org-scoped as defense in depth. Read-only; organization membership accesses the Project while roll-up data uses canonical task visibility. Returns {@link ProjectProgress}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
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
        .select({
          id: task.id,
          teamId: task.teamId,
          projectId: task.projectId,
          programId: task.programId,
          visibility: task.visibility,
          estimate: task.estimate,
          completedAt: task.completedAt,
        })
        .from(task)
        .where(and(eq(task.projectId, id), eq(task.organizationId, orgId)));

      const canView = await buildTaskViewFilter(orgId, actorId);
      return ok(c, ProjectProgress, computeProgress(taskRows.filter(canView)));
    },
  )
  .route('/', projectDependencyRoutes);

export default projects;
