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
 * **Visibility:** rows are scoped to the organization and gated by the caller's `view` on the org
 * root, matching `GET /v1/orgs/:orgId/tasks`. Per-row `task.visibility` is deliberately NOT
 * applied here, because no list endpoint in the product applies it; only search does. That
 * inconsistency is real and product-wide, and narrowing it in the MCP surface alone would make an
 * agent see less than the web app shows the same user.
 */
import {
  db,
  initiative,
  initiativeProject,
  program,
  project,
  task,
  taskDependency,
  taskLabel,
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

import { ValidationError } from '../error';
import { resolveDescriptor, resolveWorkflowState } from './descriptors';
import type { WorkCursor } from './tools-shared-queries';

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

/** Which filters each entity actually supports, used to reject the rest with a real explanation. */
const SUPPORTED: Record<WorkEntity, readonly string[]> = {
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

/** The filter surface, uniform across entities; applicability is checked per call. */
export const listWorkFilters = {
  team: z.string().optional(),
  project: z.string().optional(),
  program: z.string().optional(),
  initiative: z.string().optional(),
  assignee: z.string().optional(),
  delegate: z.string().optional(),
  lead: z.string().optional(),
  owner: z.string().optional(),
  state: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  priority: z.array(z.string()).optional(),
  label: z.string().optional(),
  cycle: z.string().optional(),
  parent: z.string().optional(),
  unfiled: z.boolean().optional(),
  blocked: z.boolean().optional(),
  blocking: z.boolean().optional(),
  dueBefore: z.iso.date().optional(),
  dueAfter: z.iso.date().optional(),
  updatedAfter: z.iso.datetime().optional(),
  archived: z.boolean().optional(),
};

/** One row of the result, uniform enough for a caller to render without switching on entity. */
export interface WorkRow {
  readonly id: string;
  readonly title: string;
  readonly state?: string;
  readonly status?: string;
  readonly assigneeId?: string;
  readonly projectId?: string;
}

/** The filters a caller supplied, before resolution. */
export type ListWorkInput = { readonly [K in keyof typeof listWorkFilters]?: unknown };

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
  const allowed = new Set(SUPPORTED[entity]);
  for (const [field, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (!allowed.has(field)) unsupported(entity, field);
  }
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
  const clauses = values.map((value) => eq(sql`${column}::text`, value));
  return clauses.length > 0 ? or(...clauses) : undefined;
}

/**
 * Build and run the task query.
 *
 * @param orgId - The organization to list within.
 * @param input - The caller's filters, already checked for applicability.
 * @param limit - Page size.
 * @param after - The keyset position from the cursor, when paging.
 * @returns the matching rows, one over `limit` when more remain.
 */
async function listTasks(
  orgId: string,
  input: ListWorkInput,
  limit: number,
  after: WorkCursor | undefined,
): Promise<(WorkRow & { createdAt: Date })[]> {
  const where: (SQL | undefined)[] = [
    eq(task.organizationId, orgId),
    seekAfter(task.createdAt, task.id, after),
  ];
  where.push(input.archived === true ? isNotNull(task.archivedAt) : isNull(task.archivedAt));

  if (typeof input.team === 'string') {
    where.push(eq(task.teamId, await resolveDescriptor(orgId, 'team', input.team, 'team')));
  }
  if (typeof input.project === 'string') {
    where.push(
      eq(task.projectId, await resolveDescriptor(orgId, 'project', input.project, 'project')),
    );
  }
  if (typeof input.program === 'string') {
    where.push(
      eq(task.programId, await resolveDescriptor(orgId, 'program', input.program, 'program')),
    );
  }
  if (typeof input.assignee === 'string') {
    where.push(
      eq(task.assigneeId, await resolveDescriptor(orgId, 'actor', input.assignee, 'assignee')),
    );
  }
  if (typeof input.delegate === 'string') {
    where.push(
      eq(task.delegateId, await resolveDescriptor(orgId, 'actor', input.delegate, 'delegate')),
    );
  }
  if (typeof input.cycle === 'string') {
    where.push(eq(task.cycleId, await resolveDescriptor(orgId, 'cycle', input.cycle, 'cycle')));
  }
  if (typeof input.parent === 'string') {
    where.push(eq(task.parentTaskId, input.parent));
  }
  if (Array.isArray(input.state) && input.state.length > 0) {
    // States are per-team, so a name is only resolvable when the query is scoped to one team;
    // otherwise the key is taken as given.
    const teamId = typeof input.team === 'string' ? input.team : null;
    const keys = await Promise.all(
      input.state.map(async (value) =>
        teamId
          ? resolveWorkflowState(
              orgId,
              await resolveDescriptor(orgId, 'team', teamId, 'team'),
              String(value),
              'state',
            )
          : String(value),
      ),
    );
    where.push(inArray(task.state, keys));
  }
  if (Array.isArray(input.priority) && input.priority.length > 0) {
    where.push(anyValue(task.priority, input.priority.map(String)));
  }
  if (typeof input.label === 'string') {
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
  if (typeof input.dueBefore === 'string') where.push(lte(task.dueDate, new Date(input.dueBefore)));
  if (typeof input.dueAfter === 'string') where.push(gte(task.dueDate, new Date(input.dueAfter)));
  if (typeof input.updatedAfter === 'string') {
    where.push(gte(task.updatedAt, new Date(input.updatedAfter)));
  }

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      state: task.state,
      assigneeId: task.assigneeId,
      projectId: task.projectId,
      createdAt: task.createdAt,
    })
    .from(task)
    .where(and(...where))
    .orderBy(desc(task.createdAt), desc(task.id))
    .limit(limit + 1);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    state: row.state,
    ...(row.assigneeId ? { assigneeId: row.assigneeId } : {}),
    ...(row.projectId ? { projectId: row.projectId } : {}),
    createdAt: row.createdAt,
  }));
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
    where.push(anyValue(table.status, input.status.map(String)));
  }
  if (typeof input.updatedAfter === 'string') {
    where.push(gte(table.updatedAt, new Date(input.updatedAfter)));
  }
  if (entity === 'project') {
    if (typeof input.team === 'string') {
      where.push(eq(project.teamId, await resolveDescriptor(orgId, 'team', input.team, 'team')));
    }
    if (typeof input.program === 'string') {
      where.push(
        eq(project.programId, await resolveDescriptor(orgId, 'program', input.program, 'program')),
      );
    }
    if (typeof input.lead === 'string') {
      where.push(eq(project.leadId, await resolveDescriptor(orgId, 'actor', input.lead, 'lead')));
    }
    if (typeof input.initiative === 'string') {
      const initiativeId = await resolveDescriptor(
        orgId,
        'initiative',
        input.initiative,
        'initiative',
      );
      where.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(initiativeProject)
            .where(
              and(
                eq(initiativeProject.projectId, project.id),
                eq(initiativeProject.initiativeId, initiativeId),
              ),
            ),
        ),
      );
    }
  }
  if (entity !== 'project' && typeof input.owner === 'string') {
    const ownerId = await resolveDescriptor(orgId, 'actor', input.owner, 'owner');
    where.push(eq(entity === 'program' ? program.ownerId : initiative.ownerId, ownerId));
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
 * @param entity - What to enumerate.
 * @param input - The caller's filters.
 * @param limit - Page size.
 * @param after - The keyset position from the cursor, when paging.
 * @returns the matching rows, one over `limit` when more remain.
 * @throws {ValidationError} When a filter does not apply to `entity`.
 */
export async function listWork(
  orgId: string,
  entity: WorkEntity,
  input: ListWorkInput,
  limit: number,
  after: WorkCursor | undefined,
): Promise<(WorkRow & { createdAt: Date })[]> {
  assertApplicable(entity, input);
  return entity === 'task'
    ? listTasks(orgId, input, limit, after)
    : listContainers(orgId, entity, input, limit, after);
}
