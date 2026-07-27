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
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { recordChangeSet, trackedFields, type ChangeRecord } from './change-set';
import { listWork, listWorkFilters, WORK_ENTITIES, type WorkEntity } from './list-work';
import { WIDGET, widgetMeta } from './apps';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';

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
        changed: z.number().int().describe('How many moved.'),
        items: z
          .array(z.object({ id: z.string(), title: z.string() }))
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
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'view', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        const restore = input.restore === true;
        const entity: WorkEntity = input.entity;
        const { ids, ...filters } = input.scope;
        const hasNarrowing = NARROWING.some((name) => filters[name] !== undefined);
        if ((ids === undefined || ids.length === 0) && !hasNarrowing) {
          reject(
            'scope',
            `An unscoped archive would take every ${entity} in the workspace out of view. Name at least one filter, or pass scope.ids.`,
            NARROWING,
          );
        }

        // Restoring reads the archived pool: "un-archive the cancelled ones" must select rows
        // that are, by definition, invisible to the default query.
        const selected =
          ids !== undefined && ids.length > 0
            ? ids
            : (
                await listWork(
                  input.orgId,
                  entity,
                  { ...filters, archived: restore },
                  MAX_TARGETS,
                  undefined,
                )
              ).map((row) => row.id);
        if (selected.length > MAX_TARGETS) {
          reject(
            'scope',
            `That scope matches more than ${MAX_TARGETS} ${entity}s. Narrow it.`,
            NARROWING,
          );
        }

        const table = TABLES[entity] as PgTable & {
          id: typeof task.id;
          organizationId: typeof task.organizationId;
          archivedAt: typeof task.archivedAt;
        };
        const rows: Record<string, unknown>[] =
          selected.length === 0
            ? []
            : await db
                .select()
                .from(table)
                .where(and(inArray(table.id, selected), eq(table.organizationId, input.orgId)));

        const changes: ChangeRecord[] = [];
        const items: { id: string; title: string }[] = [];
        const skipped: { id: string; title: string; reason: string }[] = [];

        for (const row of rows) {
          const id = String(row['id']);
          const named = row['title'] ?? row['name'];
          const title = typeof named === 'string' && named.length > 0 ? named : id;
          const alreadyThere = (row['archivedAt'] === null) === restore;
          if (alreadyThere) {
            skipped.push({ id, title, reason: restore ? 'not_archived' : 'already_archived' });
            continue;
          }
          try {
            await authorize(actorCtx, 'contribute', { kind: entity, id, orgId: input.orgId });
          } catch (err) {
            if (!(err instanceof ApiError)) throw err;
            skipped.push({ id, title, reason: 'not_permitted' });
            continue;
          }

          const before = trackedFields(entity, row);
          const updated = await db
            .update(table)
            .set({ archivedAt: restore ? null : new Date() })
            .where(and(eq(table.id, id), eq(table.organizationId, input.orgId)))
            .returning();
          const next = updated[0];
          /* v8 ignore next -- @preserve defensive: the row was just read in this call */
          if (!next) continue;

          items.push({ id, title });
          // Recorded as `update` rather than `archive`, because reversing either direction means
          // restoring the previous `archivedAt` — and the `archive` op only knows one of them.
          changes.push({
            kind: entity,
            id,
            op: 'update',
            before,
            after: trackedFields(entity, next),
          });
          await enqueueSearchUpsert(input.orgId, entity, id);
        }

        const changeSetId = await recordChangeSet({
          orgId: input.orgId,
          actorId: actorCtx.actorId,
          origin: {
            tool: 'archive',
            ...(sessionId ? { sessionId } : {}),
            ...(ctx.principal.kind === 'agent' ? { client: ctx.principal.displayName } : {}),
          },
          summary: `${restore ? 'Restored' : 'Archived'} ${items.length} ${entity}s`,
          changes,
        });

        return jsonResult({
          matched: rows.length,
          changed: items.length,
          items,
          skipped,
          changeSetId,
        });
      }),
  );
}
