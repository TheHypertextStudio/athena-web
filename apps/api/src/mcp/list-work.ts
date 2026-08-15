/**
 * `@docket/api` — the filtered work query behind the `list_work` tool.
 *
 * @remarks
 * Replaces `run_view`, which advertised "an ad-hoc, permission-filtered query" and accepted no
 * filters at all — it was a reverse-chronological dump, so an agent asking "what's blocked?" or
 * "what's assigned to Sarah in the migration project?" had no way to express either.
 *
 * The four work entities overlap far less than they look: only name/title, status/state, an
 * owner-ish id, and the audit columns are common. Rather than silently ignore a filter that does
 * not apply to the requested entity — the failure mode most likely to make an agent trust a wrong
 * answer — an inapplicable filter is rejected with the list of filters that entity does support.
 *
 * **Visibility:** task rows are additionally filtered through the canonical task-view predicate.
 * The MCP surface must never disclose a private task merely because its caller can open the org.
 */
import {
  db,
  initiative,
  initiativeLabel,
  initiativeProgram,
  initiativeProject,
  program,
  project,
  projectLabel,
  task,
  taskDependency,
  taskLabel,
  team,
} from '@docket/db';
import {
  and,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { WorkflowStateType } from '@docket/types';
import { Priority } from '@docket/work/task-contract';

import { ValidationError } from '../error';
import { buildTaskViewFilter, type ViewableTaskParts } from '../routes/task-helpers';
import { DESCRIPTOR_HINT, resolveDescriptor, resolveOptional } from './descriptors';
import type { WorkCursor } from './tools-shared-queries';
import { stateTypeOf, teamWorkflows } from './workflow-states';

/**
 * The keyset predicate that resumes a page, built per table.
 *
 * @remarks
 * `(createdAt DESC, id DESC)` with the id as tiebreak, so paging never skips or repeats a row even
 * as work is created underneath it.
 */
function seekAfter(
  createdAtColumn: AnyPgColumn,
  idColumn: AnyPgColumn,
  after: WorkCursor | undefined,
): SQL | undefined {
  if (!after) return undefined;
  return or(
    lt(createdAtColumn, after.createdAt),
    and(eq(createdAtColumn, after.createdAt), lt(idColumn, after.id)),
  );
}

/** The entities `list_work` can enumerate. */
export const WORK_ENTITIES = ['task', 'project', 'program', 'initiative'] as const;
/** One listable work entity. */
export type WorkEntity = (typeof WORK_ENTITIES)[number];

/**
 * Which filters each entity actually supports, used to reject the rest with a real explanation.
 *
 * @remarks
 * Keyed by {@link FilterName} rather than `string` so adding a filter to {@link listWorkFilters}
 * without deciding which entities honor it is a compile error, not a silently ignored argument.
 */
const SUPPORTED: Record<WorkEntity, readonly FilterName[]> = {
  task: [
    'team',
    'project',
    'program',
    'assignee',
    'delegate',
    'state',
    'priority',
    'label',
    'cycle',
    'parent',
    'unfiled',
    'blocked',
    'blocking',
    'dueBefore',
    'dueAfter',
    'updatedAfter',
    'archived',
  ],
  project: ['team', 'program', 'initiative', 'lead', 'status', 'label', 'updatedAfter', 'archived'],
  program: ['owner', 'status', 'initiative', 'updatedAfter', 'archived'],
  initiative: ['owner', 'status', 'label', 'updatedAfter', 'archived'],
};

/**
 * The filter surface, uniform across entities; applicability is checked per call.
 *
 * @remarks
 * Descriptions live here, on the module that implements the filters, so the tool can spread this
 * whole object into its input schema. Restating each field in the tool just to attach a
 * description meant a filter added here but forgotten there silently never reached the query.
 */
export const listWorkFilters = {
  team: z.string().optional().describe(`Only work on this team. ${DESCRIPTOR_HINT}`),
  project: z.string().optional().describe(`Only work in this project. ${DESCRIPTOR_HINT}`),
  program: z.string().optional().describe(`Only work under this program. ${DESCRIPTOR_HINT}`),
  initiative: z
    .string()
    .optional()
    .describe(`Only projects or programs rolling up to this initiative. ${DESCRIPTOR_HINT}`),
  assignee: z
    .string()
    .optional()
    .describe(`Only tasks this person or agent is accountable for. ${DESCRIPTOR_HINT}`),
  delegate: z
    .string()
    .optional()
    .describe(`Only tasks whose doing was handed to this agent. ${DESCRIPTOR_HINT}`),
  lead: z.string().optional().describe(`Only projects led by this person. ${DESCRIPTOR_HINT}`),
  owner: z
    .string()
    .optional()
    .describe(`Only programs or initiatives owned by this person. ${DESCRIPTOR_HINT}`),
  state: z
    .array(z.string())
    .optional()
    .describe(
      'Only tasks in any of these workflow states. Display names resolve when `team` is also set, since states are per-team.',
    ),
  status: z
    .array(z.string())
    .optional()
    .describe('Only projects/programs/initiatives in any of these statuses.'),
  priority: z.array(Priority).optional().describe('Only tasks at any of these priorities.'),
  label: z.string().optional().describe(`Only work carrying this label. ${DESCRIPTOR_HINT}`),
  cycle: z
    .string()
    .optional()
    .describe(`Only tasks committed to this cycle, by name or number. ${DESCRIPTOR_HINT}`),
  parent: z.string().optional().describe('Only subtasks of this task id.'),
  unfiled: z
    .boolean()
    .optional()
    .describe('Only tasks in no project and no program — the triage queue.'),
  blocked: z
    .boolean()
    .optional()
    .describe('Only tasks with at least one dependency that has not finished.'),
  blocking: z.boolean().optional().describe('Only tasks that something else is waiting on.'),
  dueBefore: z.iso.date().optional().describe('Only tasks due on or before this `YYYY-MM-DD`.'),
  dueAfter: z.iso.date().optional().describe('Only tasks due on or after this `YYYY-MM-DD`.'),
  updatedAfter: z.iso.datetime().optional().describe('Only work changed at or after this instant.'),
  archived: z
    .boolean()
    .optional()
    .describe('List archived work instead of active work. Defaults to false.'),
};

/**
 * One row of the result, uniform enough for a caller to render without switching on entity.
 *
 * @remarks
 * Declared as the schema and inferred into the type, rather than written twice — the tool's
 * `outputSchema` is this exact object, so a field added here reaches the wire contract
 * automatically instead of drifting until someone notices.
 *
 * Ids are plain strings rather than branded: these values come straight off a primary key, so
 * re-validating each one per row buys nothing a caller can act on.
 */
export const WorkRow = z.object({
  id: z.string().describe('The entity id.'),
  title: z.string().describe('Its name or title.'),
  state: z.string().optional().describe("A task's workflow state."),
  stateType: WorkflowStateType.optional().describe(
    'The canonical category `state` maps onto. Workflow states are per-team and renameable, so this — not `state` — is what compares across teams and what a status glyph is keyed off. Absent when the owning team no longer lists that state key.',
  ),
  status: z.string().optional().describe("A project, program, or initiative's status."),
  assigneeId: z.string().optional().describe('Who is accountable, when set.'),
  projectId: z.string().optional().describe('The project it belongs to, when set.'),
});
/** One listed row. */
export type WorkRow = z.infer<typeof WorkRow>;

/** One filter's name. */
type FilterName = keyof typeof listWorkFilters;

/**
 * The filters a caller supplied, before resolution.
 *
 * @remarks
 * Inferred from {@link listWorkFilters} rather than restated, so the query body reads the same
 * types the schema validates. An earlier draft typed every field `unknown` and paid for it with a
 * `typeof` guard on each of twenty branches.
 */
export type ListWorkInput = z.infer<z.ZodObject<typeof listWorkFilters>>;

/**
 * Check a raw task row before a bulk MCP helper serializes its id or title.
 *
 * @remarks
 * `update` and `archive` fetch polymorphic work rows after a direct-id scope. Their task branch
 * must apply the same predicate as `list_work` before building a report; otherwise a denied task
 * becomes an id/title oracle in `skipped`.
 *
 * @param row - A raw row selected from the task table.
 * @param canViewTask - The canonical task-view predicate for the authenticated caller.
 * @returns Whether this row is a well-formed, visible task.
 */
export function isTaskRowVisible(
  row: Record<string, unknown>,
  canViewTask: (task: ViewableTaskParts) => boolean,
): boolean {
  const id = row['id'];
  const teamId = row['teamId'];
  const projectId = row['projectId'];
  const programId = row['programId'];
  const visibility = row['visibility'];
  if (
    typeof id !== 'string' ||
    typeof teamId !== 'string' ||
    (projectId !== null && typeof projectId !== 'string') ||
    (programId !== null && typeof programId !== 'string') ||
    (visibility !== 'public' && visibility !== 'private')
  ) {
    return false;
  }
  return canViewTask({ id, teamId, projectId, programId, visibility });
}

/**
 * Reject a filter the requested entity has no column for.
 *
 * @param entity - What was being listed.
 * @param field - The offending filter.
 * @returns never; always throws.
 */
function unsupported(entity: WorkEntity, field: string): never {
  throw new ValidationError(
    new z.ZodError([
      {
        code: 'invalid_value',
        path: [field],
        message: `${entity} does not support the "${field}" filter.`,
        values: [...SUPPORTED[entity]],
        input: field,
      },
    ]),
  );
}

/** Reject every supplied filter the entity cannot honor, so nothing is silently dropped. */
function assertApplicable(entity: WorkEntity, input: ListWorkInput): void {
  const allowed = new Set<FilterName>(SUPPORTED[entity]);
  // Iterating the schema's keys rather than the payload's keeps `field` typed, and means an
  // unknown key the validator already rejected cannot reach here at all.
  for (const field of Object.keys(listWorkFilters) as FilterName[]) {
    if (input[field] === undefined) continue;
    if (!allowed.has(field)) unsupported(entity, field);
  }
}

/**
 * Map state display-names or keys onto storage keys, reading the team's workflow once.
 *
 * @param orgId - The organization the team belongs to.
 * @param teamId - The already-resolved team.
 * @param values - The state names or keys the caller supplied.
 * @returns the storage keys, unknown values passed through so the query simply matches nothing.
 */
async function resolveStateKeys(
  orgId: string,
  teamId: string,
  values: readonly string[],
): Promise<string[]> {
  const rows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const states = rows[0]?.workflowStates ?? [];
  return values.map((value) => {
    const needle = value.trim().toLowerCase();
    const match = states.find(
      (state) => state.key.toLowerCase() === needle || state.name.toLowerCase() === needle,
    );
    return match?.key ?? value;
  });
}

/**
 * A task is blocked when something that is not yet finished blocks it.
 *
 * @remarks
 * The blocking task is aliased because the subquery and the outer query both read `task`; without
 * it the correlation on `blocked_task_id` would bind to the wrong side and every task would look
 * blocked by itself.
 */
function blockedPredicate(): SQL {
  const blocker = alias(task, 'blocker');
  return exists(
    db
      .select({ one: sql`1` })
      .from(taskDependency)
      .innerJoin(blocker, eq(taskDependency.blockingTaskId, blocker.id))
      .where(and(eq(taskDependency.blockedTaskId, task.id), isNull(blocker.completedAt))),
  );
}

/**
 * Match an enum column against any of `values`, tolerating an empty list.
 *
 * @remarks
 * Cast to text so a value the enum does not contain is a zero-row match rather than a Postgres
 * cast error — an agent guessing "shipped" should get nothing back, not a 500.
 */
function anyValue(column: AnyPgColumn, values: readonly string[]): SQL | undefined {
  return values.length > 0 ? inArray(sql`${column}::text`, [...values]) : undefined;
}

/**
 * Build and run the task query.
 *
 * @param orgId - The organization to list within.
 * @param actorId - The authenticated actor whose task visibility applies.
 * @param input - The caller's filters, already checked for applicability.
 * @param limit - Page size.
 * @param after - The keyset position from the cursor, when paging.
 * @returns the matching rows, one over `limit` when more remain.
 */
async function listTasks(
  orgId: string,
  actorId: string,
  input: ListWorkInput,
  limit: number,
  after: WorkCursor | undefined,
): Promise<(WorkRow & { createdAt: Date })[]> {
  const where: (SQL | undefined)[] = [eq(task.organizationId, orgId)];
  where.push(input.archived === true ? isNotNull(task.archivedAt) : isNull(task.archivedAt));

  // Every descriptor here is independent of the others, so they resolve concurrently: a
  // fully-specified query used to pay six serialized round trips before the list query started.
  const [teamId, projectId, programId, assigneeId, delegateId, cycleId] = await Promise.all([
    resolveOptional(orgId, 'team', input.team, 'team'),
    resolveOptional(orgId, 'project', input.project, 'project'),
    resolveOptional(orgId, 'program', input.program, 'program'),
    resolveOptional(orgId, 'actor', input.assignee, 'assignee'),
    resolveOptional(orgId, 'actor', input.delegate, 'delegate'),
    resolveOptional(orgId, 'cycle', input.cycle, 'cycle'),
  ]);
  if (teamId !== undefined) where.push(eq(task.teamId, teamId));
  if (projectId !== undefined) where.push(eq(task.projectId, projectId));
  if (programId !== undefined) where.push(eq(task.programId, programId));
  if (assigneeId !== undefined) where.push(eq(task.assigneeId, assigneeId));
  if (delegateId !== undefined) where.push(eq(task.delegateId, delegateId));
  if (cycleId !== undefined) where.push(eq(task.cycleId, cycleId));
  if (input.parent !== undefined) where.push(eq(task.parentTaskId, input.parent));

  if (input.state !== undefined && input.state.length > 0) {
    // States are per-team, so a display name is only resolvable when the query is scoped to one
    // team; otherwise the value is taken as a key. The team is the one already resolved above —
    // an earlier version re-resolved it once per state value, paying seven lookups to filter on one.
    const keys = teamId ? await resolveStateKeys(orgId, teamId, input.state) : input.state;
    where.push(anyValue(task.state, keys));
  }
  if (Array.isArray(input.priority) && input.priority.length > 0) {
    where.push(anyValue(task.priority, input.priority));
  }
  if (input.label !== undefined) {
    const labelId = await resolveDescriptor(orgId, 'label', input.label, 'label');
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(taskLabel)
          .where(and(eq(taskLabel.taskId, task.id), eq(taskLabel.labelId, labelId))),
      ),
    );
  }
  if (input.unfiled === true) {
    where.push(and(isNull(task.projectId), isNull(task.programId)));
  }
  if (input.blocked === true) where.push(blockedPredicate());
  if (input.blocking === true) {
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(taskDependency)
          .where(eq(taskDependency.blockingTaskId, task.id)),
      ),
    );
  }
  if (input.dueBefore !== undefined) where.push(lte(task.dueDate, new Date(input.dueBefore)));
  if (input.dueAfter !== undefined) where.push(gte(task.dueDate, new Date(input.dueAfter)));
  if (input.updatedAfter !== undefined) {
    where.push(gte(task.updatedAt, new Date(input.updatedAfter)));
  }

  const canView = await buildTaskViewFilter(orgId, actorId);
  const visibleRows: {
    id: string;
    title: string;
    state: string;
    teamId: string;
    assigneeId: string | null;
    projectId: string | null;
    programId: string | null;
    visibility: 'public' | 'private';
    createdAt: Date;
  }[] = [];
  let pageAfter = after;

  // The shared task predicate is intentionally data-backed rather than restated as SQL here.
  // Continue keyset-scanning until we have one visible row beyond the requested page, so a run of
  // hidden rows cannot make a later visible row disappear from pagination.
  while (visibleRows.length <= limit) {
    const rows = await db
      .select({
        id: task.id,
        title: task.title,
        state: task.state,
        teamId: task.teamId,
        assigneeId: task.assigneeId,
        projectId: task.projectId,
        programId: task.programId,
        visibility: task.visibility,
        createdAt: task.createdAt,
      })
      .from(task)
      .where(and(...where, seekAfter(task.createdAt, task.id, pageAfter)))
      .orderBy(desc(task.createdAt), desc(task.id))
      .limit(limit + 1);

    for (const row of rows) {
      if (!canView(row)) continue;
      visibleRows.push(row);
      if (visibleRows.length > limit) break;
    }

    if (visibleRows.length > limit || rows.length <= limit) break;
    const last = rows[rows.length - 1];
    if (!last) break;
    pageAfter = { createdAt: last.createdAt, id: last.id };
  }

  // One lookup for the whole page, not one per row: a page can span every team in the org, and
  // resolving each row separately would make a 50-row read cost 51 queries.
  const workflows = await teamWorkflows(
    orgId,
    visibleRows.map((row) => row.teamId),
  );

  // `teamId` is read to resolve the state type and then dropped. It is not part of the row
  // contract, and adding it here would widen the wire on the way past rather than on purpose.
  return visibleRows.map((row) => {
    const stateType = stateTypeOf(workflows, row.teamId, row.state);
    return {
      id: row.id,
      title: row.title,
      state: row.state,
      ...(stateType ? { stateType } : {}),
      ...(row.assigneeId ? { assigneeId: row.assigneeId } : {}),
      ...(row.projectId ? { projectId: row.projectId } : {}),
      createdAt: row.createdAt,
    };
  });
}

/** Build and run the project/program/initiative query, which share a much smaller filter set. */
async function listContainers(
  orgId: string,
  entity: Exclude<WorkEntity, 'task'>,
  input: ListWorkInput,
  limit: number,
  after: WorkCursor | undefined,
): Promise<(WorkRow & { createdAt: Date })[]> {
  const table = { project, program, initiative }[entity];
  const where: (SQL | undefined)[] = [
    eq(table.organizationId, orgId),
    seekAfter(table.createdAt, table.id, after),
  ];
  where.push(input.archived === true ? isNotNull(table.archivedAt) : isNull(table.archivedAt));

  if (Array.isArray(input.status) && input.status.length > 0) {
    where.push(anyValue(table.status, input.status));
  }
  if (input.updatedAfter !== undefined) {
    where.push(gte(table.updatedAt, new Date(input.updatedAfter)));
  }
  if (entity === 'project') {
    if (input.team !== undefined) {
      where.push(eq(project.teamId, await resolveDescriptor(orgId, 'team', input.team, 'team')));
    }
    if (input.program !== undefined) {
      where.push(
        eq(project.programId, await resolveDescriptor(orgId, 'program', input.program, 'program')),
      );
    }
    if (input.lead !== undefined) {
      where.push(eq(project.leadId, await resolveDescriptor(orgId, 'actor', input.lead, 'lead')));
    }
  }
  // Both projects and programs roll up to initiatives, through their own join table. This lived
  // inside the project branch and was therefore declared-but-unapplied for programs — a filter
  // silently doing nothing is the one failure this module exists to prevent, since it hands the
  // caller a confidently wrong answer rather than an error.
  if (input.initiative !== undefined && entity !== 'initiative') {
    const initiativeId = await resolveDescriptor(
      orgId,
      'initiative',
      input.initiative,
      'initiative',
    );
    const link =
      entity === 'project'
        ? { table: initiativeProject, member: initiativeProject.projectId, own: project.id }
        : { table: initiativeProgram, member: initiativeProgram.programId, own: program.id };
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(link.table)
          .where(
            and(
              eq(link.member, link.own),
              eq(
                entity === 'project'
                  ? initiativeProject.initiativeId
                  : initiativeProgram.initiativeId,
                initiativeId,
              ),
            ),
          ),
      ),
    );
  }
  if (entity !== 'project' && input.owner !== undefined) {
    const ownerId = await resolveDescriptor(orgId, 'actor', input.owner, 'owner');
    where.push(eq(entity === 'program' ? program.ownerId : initiative.ownerId, ownerId));
  }
  // Projects and initiatives carry labels through their own join tables; programs do not, which is
  // why `label` is absent from their entry in SUPPORTED rather than accepted and ignored here.
  if (input.label !== undefined && entity !== 'program') {
    const labelId = await resolveDescriptor(orgId, 'label', input.label, 'label');
    const link =
      entity === 'project'
        ? {
            table: projectLabel,
            member: projectLabel.projectId,
            own: project.id,
            label: projectLabel.labelId,
          }
        : {
            table: initiativeLabel,
            member: initiativeLabel.initiativeId,
            own: initiative.id,
            label: initiativeLabel.labelId,
          };
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(link.table)
          .where(and(eq(link.member, link.own), eq(link.label, labelId))),
      ),
    );
  }

  const rows = await db
    .select({
      id: table.id,
      title: table.name,
      status: table.status,
      createdAt: table.createdAt,
    })
    .from(table)
    .where(and(...where))
    .orderBy(desc(table.createdAt), desc(table.id))
    .limit(limit + 1);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt,
  }));
}

/**
 * List work matching a filter set.
 *
 * @param orgId - The organization to list within.
 * @param actorId - The authenticated actor whose task visibility applies.
 * @param entity - What to enumerate.
 * @param input - The caller's filters.
 * @param limit - Page size.
 * @param after - The keyset position from the cursor, when paging.
 * @returns the matching rows, one over `limit` when more remain.
 * @throws {ValidationError} When a filter does not apply to `entity`.
 */
export async function listWork(
  orgId: string,
  actorId: string,
  entity: WorkEntity,
  input: ListWorkInput,
  limit: number,
  after: WorkCursor | undefined,
): Promise<(WorkRow & { createdAt: Date })[]> {
  assertApplicable(entity, input);
  return entity === 'task'
    ? listTasks(orgId, actorId, input, limit, after)
    : listContainers(orgId, entity, input, limit, after);
}
