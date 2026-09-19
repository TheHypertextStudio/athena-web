/**
 * `@docket/api` — the `archive` tool.
 *
 * @remarks
 * "Clear out everything we cancelled last quarter" is a scope, not a list of ids, so archive takes
 * the same shape as {@link import('./update-tool')} rather than a single target. It is the one
 * write on this surface that removes work from view, which is why it declares `destructiveHint` and
 * why it refuses an unscoped call outright.
 *
 * Archiving is soft: rows keep their ids and their references, so `restore: true` is the same call
 * with the flag flipped rather than a resurrection path with its own semantics.
 */
import { db, initiative, program, project, task } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { ApiError, ValidationError } from '../error';
import { buildTaskViewFilter } from '../routes/task-helpers';
import {
  applySubtaskCompletionPolicyForParents,
  finishTaskStateTransition,
} from '../lib/task-state';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { recordChangeSet, trackedFields, type ChangeRecord } from './change-set';
import {
  isTaskRowVisible,
  listWork,
  listWorkFilters,
  WORK_ENTITIES,
  type WorkEntity,
} from './list-work';
import { WIDGET, widgetMeta } from './apps';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';
import { entityHref, entityListHref } from './entity-href';

/** The table each archivable entity lives in. */
const TABLES = { task, project, program, initiative } as const;

/** The most rows one call will archive, matching `update`'s ceiling for the same reason. */
const MAX_TARGETS = 100;

/** The filters that actually narrow a scope. */
const NARROWING = (Object.keys(listWorkFilters) as (keyof typeof listWorkFilters)[]).filter(
  (name) => name !== 'archived',
);

/** Raise a field error carrying the legal alternatives. */
function reject(field: string, message: string, options: readonly string[]): never {
  throw new ValidationError(
    new z.ZodError([
      { code: 'invalid_value', path: [field], message, values: [...options], input: '' },
    ]),
  );
}

/** Register `archive` on `server`. */
export function registerArchiveTool(
  server: McpRegistrar,
  ctx: McpContext,
  sessionId: string | null,
): void {
  server.registerTool(
    'archive',
    {
      title: 'Archive work',
      description:
        'Take work out of view without deleting it — ids and references survive, so this is always reversible. The scope takes the same filters as list_work. Pass `restore: true` to bring archived work back, in which case the scope reads the archived pool. Anything you may not write is reported rather than skipped quietly.',
      inputSchema: {
        orgId: orgIdParam,
        entity: z.enum(WORK_ENTITIES).describe('What kind of work to archive.'),
        scope: z
          .object({
            ids: z.array(z.string()).optional().describe('Specific items by id.'),
            ...listWorkFilters,
          })
          .describe(
            'Which work to archive. At least one narrowing filter (or `ids`) is required — an unscoped archive is refused.',
          ),
        restore: z
          .boolean()
          .optional()
          .describe('Bring archived work back instead of archiving. Defaults to false.'),
      },
      outputSchema: {
        matched: z.number().int().describe('How many items the scope selected.'),
        listHref: z
          .string()
          .describe('The page listing this kind of work, for what the card cannot fit.'),
        changed: z.number().int().describe('How many moved.'),
        entity: z
          .enum(WORK_ENTITIES)
          .describe('The kind every row in `items`/`skipped` is — the call scope, echoed back.'),
        items: z
          .array(
            z.object({
              id: z.string(),
              title: z.string(),
              href: z.string().describe('Where it lives in the product app.'),
            }),
          )
          .describe('What moved, so the caller can see it was the right set.'),
        skipped: z
          .array(z.object({ id: z.string(), title: z.string(), reason: z.string() }))
          .describe('Items left alone, and why.'),
        changeSetId: z.string().nullable().describe('Pass to `undo`. Null when nothing moved.'),
      },
      _meta: widgetMeta(WIDGET.changeReport),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => runTool(() => archiveWork(ctx, sessionId, input)),
  );
}

/** The `archive` tool's validated input. */
interface ArchiveInput {
  readonly orgId: string;
  readonly entity: WorkEntity;
  readonly scope: Record<string, unknown> & { readonly ids?: readonly string[] | undefined };
  readonly restore?: boolean | undefined;
}

/** The archive table for one entity kind, narrowed to the columns this tool writes. */
type ArchivableTable = PgTable & {
  id: typeof task.id;
  organizationId: typeof task.organizationId;
  archivedAt: typeof task.archivedAt;
};

/**
 * Resolve which rows an archive call targets, refusing a scope that is too wide.
 *
 * @remarks
 * Restoring reads the archived pool: "un-archive the cancelled ones" must select rows that are, by
 * definition, invisible to the default query. An unscoped call is refused outright rather than
 * defaulted, because the default would take every item of that kind out of view.
 *
 * @param orgId - The workspace being archived in.
 * @param actorId - The acting actor, for visibility.
 * @param input - The validated tool input.
 * @param restore - Whether this call restores rather than archives.
 * @returns The ids to act on.
 * @throws {ValidationError} When the scope names nothing, or matches too much.
 */
async function resolveArchiveTargets(
  orgId: string,
  actorId: string,
  input: ArchiveInput,
  restore: boolean,
): Promise<string[]> {
  const { ids, ...filters } = input.scope;
  const hasNarrowing = NARROWING.some((name) => filters[name] !== undefined);
  if ((ids === undefined || ids.length === 0) && !hasNarrowing) {
    reject(
      'scope',
      `An unscoped archive would take every ${input.entity} in the workspace out of view. Name at least one filter, or pass scope.ids.`,
      NARROWING,
    );
  }
  const selected =
    ids !== undefined && ids.length > 0
      ? [...ids]
      : (
          await listWork({
            orgId,
            actorId,
            entity: input.entity,
            input: { ...filters, archived: restore },
            limit: MAX_TARGETS,
            after: undefined,
          })
        ).map((row) => row.id);
  if (selected.length > MAX_TARGETS) {
    reject(
      'scope',
      `That scope matches more than ${MAX_TARGETS} ${input.entity}s. Narrow it.`,
      NARROWING,
    );
  }
  return selected;
}

/**
 * Read the targeted rows, dropping any the caller cannot see.
 *
 * @param orgId - The workspace being archived in.
 * @param actorId - The acting actor, for task visibility.
 * @param entity - The kind being archived.
 * @param selected - The ids the scope resolved to.
 * @returns The visible rows.
 */
async function loadArchivableRows(
  orgId: string,
  actorId: string,
  entity: WorkEntity,
  selected: readonly string[],
): Promise<Record<string, unknown>[]> {
  if (selected.length === 0) return [];
  const table = TABLES[entity] as ArchivableTable;
  const rows: Record<string, unknown>[] = await db
    .select()
    .from(table)
    .where(and(inArray(table.id, [...selected]), eq(table.organizationId, orgId)));
  if (entity !== 'task') return rows;
  const canViewTask = await buildTaskViewFilter(orgId, actorId);
  return rows.filter((row) => isTaskRowVisible(row, canViewTask));
}

/** What one archive pass did to the rows it touched. */
interface ArchiveOutcome {
  readonly items: { id: string; title: string; href: string }[];
  readonly skipped: { id: string; title: string; reason: string }[];
  readonly changes: ChangeRecord[];
}

/**
 * Archive or restore one row, recording what changed.
 *
 * @param actorCtx - The authenticated MCP actor.
 * @param input - The validated tool input.
 * @param restore - Whether this call restores rather than archives.
 * @param row - The row to act on.
 * @param outcome - The running outcome, appended to in place.
 */
async function archiveOneRow(
  actorCtx: Awaited<ReturnType<typeof scopedActor>>,
  input: ArchiveInput,
  restore: boolean,
  row: Record<string, unknown>,
  outcome: ArchiveOutcome,
): Promise<void> {
  const orgId = input.orgId;
  const entity = input.entity;
  const id = String(row['id']);
  const named = row['title'] ?? row['name'];
  const title = typeof named === 'string' && named.length > 0 ? named : id;
  if ((row['archivedAt'] === null) === restore) {
    outcome.skipped.push({ id, title, reason: restore ? 'not_archived' : 'already_archived' });
    return;
  }
  try {
    await authorize(actorCtx, 'contribute', { kind: entity, id, orgId });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    outcome.skipped.push({ id, title, reason: 'not_permitted' });
    return;
  }

  const table = TABLES[entity] as ArchivableTable;
  const before = trackedFields(entity, row);
  const updated = await db
    .update(table)
    .set({ archivedAt: restore ? null : new Date() })
    .where(and(eq(table.id, id), eq(table.organizationId, orgId)))
    .returning();
  const next = updated[0];
  /* v8 ignore next -- @preserve defensive: the row was just read in this call */
  if (!next) return;

  outcome.items.push({ id, title, href: entityHref(orgId, entity, id) });
  // Recorded as `update` rather than `archive`, because reversing either direction means
  // restoring the previous `archivedAt` — and the `archive` op only knows one of them.
  outcome.changes.push({
    kind: entity,
    id,
    op: 'update',
    before,
    after: trackedFields(entity, next),
  });
  await enqueueSearchUpsert(orgId, entity, id);
  await cascadeToParent(orgId, entity, row);
}

/**
 * Re-run the subtask completion policy for an archived subtask's parent.
 *
 * @param orgId - The workspace the task belongs to.
 * @param entity - The kind that was archived.
 * @param row - The row that was archived.
 */
async function cascadeToParent(
  orgId: string,
  entity: WorkEntity,
  row: Record<string, unknown>,
): Promise<void> {
  const parentTaskId =
    entity === 'task' && typeof row['parentTaskId'] === 'string' ? row['parentTaskId'] : null;
  if (parentTaskId === null) return;
  const cascades = await db.transaction((tx) =>
    applySubtaskCompletionPolicyForParents(tx, orgId, [parentTaskId]),
  );
  for (const cascade of cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }
}

/**
 * Take a scoped set of work out of view, or bring it back.
 *
 * @param ctx - The authenticated MCP caller.
 * @param sessionId - The agent session this ran inside, when there is one.
 * @param input - The validated tool input.
 * @returns What moved, what did not, and the change set to undo it with.
 */
async function archiveWork(ctx: McpContext, sessionId: string | null, input: ArchiveInput) {
  const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
  await authorize(actorCtx, 'view', {
    kind: 'organization',
    id: input.orgId,
    orgId: input.orgId,
  });

  const restore = input.restore === true;
  const selected = await resolveArchiveTargets(input.orgId, actorCtx.actorId, input, restore);
  const visibleRows = await loadArchivableRows(
    input.orgId,
    actorCtx.actorId,
    input.entity,
    selected,
  );

  const outcome: ArchiveOutcome = { items: [], skipped: [], changes: [] };
  for (const row of visibleRows) {
    await archiveOneRow(actorCtx, input, restore, row, outcome);
  }

  const changeSetId = await recordChangeSet({
    orgId: input.orgId,
    actorId: actorCtx.actorId,
    origin: {
      tool: 'archive',
      ...(sessionId ? { sessionId } : {}),
      ...(ctx.principal.kind === 'agent' ? { client: ctx.principal.displayName } : {}),
    },
    summary: `${restore ? 'Restored' : 'Archived'} ${outcome.items.length} ${input.entity}s`,
    changes: outcome.changes,
  });

  return jsonResult({
    matched: visibleRows.length,
    listHref: entityListHref(input.orgId, input.entity),
    changed: outcome.items.length,
    entity: input.entity,
    items: outcome.items,
    skipped: outcome.skipped,
    changeSetId,
  });
}
