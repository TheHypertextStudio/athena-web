import type { actor } from '@docket/db';
import { db, initiative, program, project, task, team } from '@docket/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { OrganizationId } from '@docket/types';

import { NotFoundError, ValidationError } from '../error';
import { rawResultRowCount } from '../lib/raw-result';
import { createCursorCodec } from './cursors';

/** The subject table whose `health` an update of each subject type also writes to. */
export const subjectTable = { project, program, initiative } as const;

/**
 * The `orgId` parameter every org-scoped MCP tool takes.
 *
 * @remarks
 * A caller with no prior context (a fresh conversation, a first tool call) has no way to know
 * an org id ahead of time - the description points function-calling models directly at the
 * `docket://orgs` resource instead of leaving them to guess a slug or name as the id.
 */
export const orgIdParam = OrganizationId.describe(
  "The organization id. If you don't already have it, read the docket://orgs resource first — it lists the organizations the caller belongs to.",
);

/**
 * Resolve a workflow-state descriptor against a team and derive its terminal timestamps.
 *
 * @remarks
 * Matches the storage key OR the display name, so a caller saying "in review" lands on
 * `in_review`. Both live here rather than in a separate resolver because this function already
 * holds the team's `workflowStates` in hand — splitting them meant every state write ran the same
 * team query twice and could fail with either of two differently-shaped errors.
 *
 * The terminal derivation is not optional bookkeeping: a `done`/`canceled` state with a null
 * `completedAt`/`canceledAt` corrupts project progress.
 *
 * @param orgId - The organization the team belongs to.
 * @param teamId - The team whose workflow applies.
 * @param state - The target state, by key or display name.
 * @param field - The tool parameter the value came from, used in the error path.
 * @returns the resolved key plus the terminal timestamps it implies.
 * @throws {NotFoundError} When the team is missing.
 * @throws {ValidationError} When `state` names no state on that team; lists the legal keys.
 */
export async function resolveStateTransition(
  orgId: string,
  teamId: string,
  state: string,
  field = 'state',
): Promise<{ state: string; completedAt: Date | null; canceledAt: Date | null }> {
  const teamRows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const teamRow = teamRows[0];
  /* v8 ignore next -- @preserve defensive: a task always references an in-org team (FK + cascade) */
  if (!teamRow) throw new NotFoundError('Team not found');

  const needle = state.trim().toLowerCase();
  const target = teamRow.workflowStates.find(
    (candidate) =>
      candidate.key.toLowerCase() === needle || candidate.name.toLowerCase() === needle,
  );
  if (!target) {
    throw new ValidationError(
      new z.ZodError([
        {
          code: 'invalid_value',
          path: [field],
          message: `"${state}" is not a workflow state on this team.`,
          values: teamRow.workflowStates.map((candidate) => candidate.key),
          input: state,
        },
      ]),
    );
  }
  return {
    state: target.key,
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

/** A position in the `(createdAt DESC, id DESC)` keyset `list_work` pages on. */
export interface WorkCursor {
  readonly createdAt: Date;
  readonly id: string;
}

interface ToolCursorPayload {
  readonly v: 1;
  readonly surface: 'list_work';
  readonly key: string;
}

const ToolCursorPayloadSchema: z.ZodType<ToolCursorPayload> = z.object({
  v: z.literal(1),
  surface: z.literal('list_work'),
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

/**
 * Decode a page cursor into the keyset position it names.
 *
 * @remarks
 * The seek predicate itself is built by the caller, because the columns differ per entity — a
 * cursor is a position, not a query fragment.
 *
 * @param cursor - The opaque cursor from a previous page, if any.
 * @returns the position to resume after, or undefined for the first page.
 * @throws {ValidationError} When the cursor is unreadable or was minted for another surface.
 */
export function decodeWorkCursor(cursor: string | undefined): WorkCursor | undefined {
  if (!cursor) return undefined;
  const [iso, id] = toolCursorCodec.decode(cursor).key.split('|');
  if (!iso || !id || Number.isNaN(Date.parse(iso))) throw invalidCursor();
  return { createdAt: new Date(iso), id };
}

/**
 * Trim an over-fetched result to a page and mint the cursor for the next one.
 *
 * @param rows - `limit + 1` rows, so the extra one reveals whether more remain.
 * @param limit - The page size the caller asked for.
 * @returns the page and, when more remain, the cursor to continue from.
 */
export function pageWorkRows<T extends { readonly id: string; readonly createdAt: Date }>(
  rows: readonly T[],
  limit: number,
): { items: Omit<T, 'createdAt'>[]; nextCursor?: string } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const items = page.map(({ createdAt: _createdAt, ...rest }) => rest);
  return {
    items,
    ...(hasMore && last
      ? {
          nextCursor: toolCursorCodec.encode({
            v: 1,
            surface: 'list_work',
            key: `${last.createdAt.toISOString()}|${last.id}`,
          }),
        }
      : {}),
  };
}
