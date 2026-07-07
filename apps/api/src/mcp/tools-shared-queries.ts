import type { actor } from '@docket/db';
import { db, initiative, program, project, task, team } from '@docket/db';
import { and, desc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';
import { rawResultRowCount } from '../lib/raw-result';
import { createCursorCodec } from './cursors';

/** The subject table whose `health` an update of each subject type also writes to. */
export const subjectTable = { project, program, initiative } as const;

/**
 * Validate a workflow-state transition for a task against its team's `workflow_states`.
 *
 * @throws {NotFoundError} When the team is missing.
 * @throws {ValidationError} When `state` is not one of the team's workflow states.
 */
export async function resolveStateTransition(
  orgId: string,
  teamId: string,
  state: string,
): Promise<{ state: string; completedAt: Date | null; canceledAt: Date | null }> {
  const teamRows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const teamRow = teamRows[0];
  /* v8 ignore next -- @preserve defensive: a task always references an in-org team (FK + cascade) */
  if (!teamRow) throw new NotFoundError('Team not found');

  const target = teamRow.workflowStates.find((s) => s.key === state);
  if (!target) {
    throw new ValidationError(
      new z.ZodError([
        {
          code: 'custom',
          path: ['state'],
          message: `Unknown workflow state '${state}'`,
          input: state,
        },
      ]),
    );
  }
  return {
    state,
    completedAt: target.type === 'completed' ? new Date() : null,
    canceledAt: target.type === 'canceled' ? new Date() : null,
  };
}

/** Load an active, org-scoped task row, or throw {@link NotFoundError}. */
export async function loadTask(orgId: string, id: string): Promise<typeof task.$inferSelect> {
  const rows = await db
    .select()
    .from(task)
    .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Task not found');
  return row;
}

/**
 * Assert a directly org-scoped referenced row belongs to the caller's org, or 404.
 *
 * @remarks
 * Tenant isolation for FKs that target global PKs with no `organization_id` constraint.
 * A `null`/`undefined` id is a no-op.
 */
export async function assertRefInOrg(
  table: typeof actor | typeof project | typeof program,
  orgId: string,
  refId: string | null | undefined,
  message: string,
): Promise<void> {
  if (refId === null || refId === undefined) return;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, refId), eq(table.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError(message);
}

/**
 * Whether adding `blocking → blocked` would create a dependency cycle.
 *
 * @remarks
 * The edge closes a cycle when `blocked` can already reach `blocking` along existing
 * `blocks` edges. Org-scoped.
 */
export async function wouldCreateCycle(
  orgId: string,
  blockingTaskId: string,
  blockedTaskId: string,
): Promise<boolean> {
  const reach = await db.execute(sql`
    WITH RECURSIVE reach AS (
      SELECT blocked_task_id AS n FROM task_dependency
        WHERE blocking_task_id = ${blockedTaskId} AND organization_id = ${orgId}
      UNION
      SELECT d.blocked_task_id FROM task_dependency d
        JOIN reach r ON d.blocking_task_id = r.n WHERE d.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM reach WHERE n = ${blockingTaskId} LIMIT 1
  `);
  return rawResultRowCount(reach) > 0;
}

/** A lightweight projection for `run_view` rows. */
export interface ViewItem {
  readonly id: string;
  readonly title: string;
  readonly state?: string;
  readonly status?: string;
}

interface PagedViewItems {
  readonly items: readonly ViewItem[];
  readonly nextCursor?: string;
}

interface ToolCursorPayload {
  readonly v: 1;
  readonly surface: 'run_view' | 'search';
  readonly key: string;
}

const ToolCursorPayloadSchema: z.ZodType<ToolCursorPayload> = z.object({
  v: z.literal(1),
  surface: z.enum(['run_view', 'search']),
  key: z.string(),
});

function invalidCursor(): ValidationError {
  return new ValidationError(
    new z.ZodError([
      { code: 'custom', path: ['cursor'], message: 'Invalid cursor', input: undefined },
    ]),
  );
}

const toolCursorCodec = createCursorCodec({
  payloadSchema: ToolCursorPayloadSchema,
  invalidCursorError: invalidCursor,
  secretMissingError: () => new Error('MCP signing secret is not configured'),
});

function decodeToolCursor(
  cursor: string | undefined,
  surface: ToolCursorPayload['surface'],
): string | undefined {
  if (!cursor) return undefined;
  const payload = toolCursorCodec.decode(cursor);
  if (payload.surface !== surface) throw invalidCursor();
  return payload.key;
}

function pageRows<T extends { readonly id: string; readonly createdAt: Date }>(
  rows: readonly T[],
  limit: number,
  map: (row: T) => ViewItem,
): PagedViewItems {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(map),
    ...(hasMore && last
      ? {
          nextCursor: toolCursorCodec.encode({
            v: 1,
            surface: 'run_view',
            key: `${last.createdAt.toISOString()}|${last.id}`,
          }),
        }
      : {}),
  };
}

/** Run an org-scoped, ad-hoc entity query for `run_view`. */
export async function runEntityQuery(
  orgId: string,
  entity: 'task' | 'project' | 'program' | 'initiative',
  limit: number,
  cursor?: string,
): Promise<PagedViewItems> {
  const rawCursor = decodeToolCursor(cursor, 'run_view');
  const [cursorIso, cursorId] = rawCursor?.split('|') ?? [];
  if (rawCursor && (!cursorIso || !cursorId || Number.isNaN(Date.parse(cursorIso)))) {
    throw invalidCursor();
  }
  const cursorDate = cursorIso ? new Date(cursorIso) : undefined;

  if (entity === 'task') {
    const seek =
      cursorDate && cursorId
        ? or(
            lt(task.createdAt, cursorDate),
            and(eq(task.createdAt, cursorDate), lt(task.id, cursorId)),
          )
        : undefined;
    const rows = await db
      .select({ id: task.id, title: task.title, state: task.state, createdAt: task.createdAt })
      .from(task)
      .where(and(eq(task.organizationId, orgId), isNull(task.archivedAt), seek))
      .orderBy(desc(task.createdAt), desc(task.id))
      .limit(limit + 1);
    return pageRows(rows, limit, (r) => ({ id: r.id, title: r.title, state: r.state }));
  }

  if (entity === 'project') {
    const seek =
      cursorDate && cursorId
        ? or(
            lt(project.createdAt, cursorDate),
            and(eq(project.createdAt, cursorDate), lt(project.id, cursorId)),
          )
        : undefined;
    const rows = await db
      .select({
        id: project.id,
        name: project.name,
        status: project.status,
        createdAt: project.createdAt,
      })
      .from(project)
      .where(and(eq(project.organizationId, orgId), seek))
      .orderBy(desc(project.createdAt), desc(project.id))
      .limit(limit + 1);
    return pageRows(rows, limit, (r) => ({ id: r.id, title: r.name, status: r.status }));
  }

  if (entity === 'program') {
    const seek =
      cursorDate && cursorId
        ? or(
            lt(program.createdAt, cursorDate),
            and(eq(program.createdAt, cursorDate), lt(program.id, cursorId)),
          )
        : undefined;
    const rows = await db
      .select({
        id: program.id,
        name: program.name,
        status: program.status,
        createdAt: program.createdAt,
      })
      .from(program)
      .where(and(eq(program.organizationId, orgId), seek))
      .orderBy(desc(program.createdAt), desc(program.id))
      .limit(limit + 1);
    return pageRows(rows, limit, (r) => ({ id: r.id, title: r.name, status: r.status }));
  }

  const seek =
    cursorDate && cursorId
      ? or(
          lt(initiative.createdAt, cursorDate),
          and(eq(initiative.createdAt, cursorDate), lt(initiative.id, cursorId)),
        )
      : undefined;
  const rows = await db
    .select({
      id: initiative.id,
      name: initiative.name,
      status: initiative.status,
      createdAt: initiative.createdAt,
    })
    .from(initiative)
    .where(and(eq(initiative.organizationId, orgId), seek))
    .orderBy(desc(initiative.createdAt), desc(initiative.id))
    .limit(limit + 1);
  return pageRows(rows, limit, (r) => ({ id: r.id, title: r.name, status: r.status }));
}

interface SearchResult {
  readonly type: 'task' | 'project' | 'program';
  readonly id: string;
  readonly title: string;
}

/**
 * Search an org's tasks, projects, and programs by title and return a page of
 * matches sorted by stable key.
 *
 * @param orgId - The organization to scope the search to.
 * @param query - The substring to match against entity titles/names.
 * @param limit - The maximum number of results to return.
 * @param cursor - An opaque cursor from a prior page, or undefined for the first.
 * @returns The matching results and an optional `nextCursor` when more remain.
 * @throws {McpError} When the cursor is invalid or no longer resolves to a result.
 */
export async function searchEntities(
  orgId: string,
  query: string,
  limit: number,
  cursor?: string,
): Promise<{ readonly results: readonly SearchResult[]; readonly nextCursor?: string }> {
  const after = decodeToolCursor(cursor, 'search');
  const pattern = `%${query}%`;
  const [taskRows, projectRows, programRows] = await Promise.all([
    db
      .select({ id: task.id, title: task.title })
      .from(task)
      .where(
        and(eq(task.organizationId, orgId), isNull(task.archivedAt), ilike(task.title, pattern)),
      ),
    db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(and(eq(project.organizationId, orgId), ilike(project.name, pattern))),
    db
      .select({ id: program.id, name: program.name })
      .from(program)
      .where(and(eq(program.organizationId, orgId), ilike(program.name, pattern))),
  ]);
  const all = [
    ...taskRows.map((t) => ({
      key: `task:${t.id}`,
      result: { type: 'task' as const, id: t.id, title: t.title },
    })),
    ...projectRows.map((p) => ({
      key: `project:${p.id}`,
      result: { type: 'project' as const, id: p.id, title: p.name },
    })),
    ...programRows.map((p) => ({
      key: `program:${p.id}`,
      result: { type: 'program' as const, id: p.id, title: p.name },
    })),
  ].sort((a, b) => a.key.localeCompare(b.key));
  const start = after ? all.findIndex((row) => row.key === after) + 1 : 0;
  if (after && start === 0) throw invalidCursor();
  const page = all.slice(start, start + limit);
  const next = all[start + limit];
  const last = page[page.length - 1];
  return {
    results: page.map((row) => row.result),
    ...(next && last
      ? {
          nextCursor: toolCursorCodec.encode({
            v: 1,
            surface: 'search',
            key: last.key,
          }),
        }
      : {}),
  };
}
