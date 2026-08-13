/**
 * `@docket/api` — per-workspace stream router (ORG-SCOPED, mounted at `/v1/orgs/:orgId/stream`).
 *
 * @remarks
 * The workspace timeline: every {@link event} in the org, newest-first, attribute-filtered in
 * SQL and keyset-paginated. Reads the workspace and viewer actor from `orgContextMiddleware`.
 */
import { db, event, savedView, task as taskTable } from '@docket/db';
import {
  PERSONAL_ACTIVITY_SOURCES,
  StreamEventLinkBody,
  StreamEventOut,
  StreamPageOut,
  StreamQuery,
} from '@docket/types';
import { and, asc, desc, eq, isNull, notInArray, or, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import {
  buildFilterConditions,
  cursorCondition,
  decodeCursor,
  decodeFilter,
  encodeCursor,
} from '../lib/view-filter-sql';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zQuery } from '../lib/validate';

import { routeAndWriteRecipients } from '../consumers/routing';
import { enqueueSearchIndexJobs } from '../search/enqueue';
import { eventSearchReindexTarget } from '../search/event-log';
import { toStreamEventOut } from './stream-helpers';

/**
 * Load a saved view's stored filters.
 *
 * @remarks
 * Org-scoped, so a view id from another workspace reads as absent rather than leaking that it
 * exists — the same existence-hiding rule the rest of the surface follows.
 *
 * @param orgId - The organization the request is scoped to.
 * @param viewId - The saved view named by `?viewId`.
 * @returns its stored filters, which compose (AND) with any inline `?filter`.
 * @throws {NotFoundError} When the view is not this organization's.
 */
async function loadViewFilters(orgId: string, viewId: string) {
  const rows = await db
    .select({ filters: savedView.filters })
    .from(savedView)
    .where(and(eq(savedView.id, viewId), eq(savedView.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Saved view not found');
  return row.filters;
}

/**
 * Restrict a query to events this caller may see, on top of the org scope.
 *
 * @remarks
 * The org firehose is "everything that happened in this workspace", and for work items that is
 * exactly right. It is wrong for a mailbox or a personal calendar: those reach Docket through an
 * org-scoped integration but belong to one person, so their subjects, snippets and attendee
 * addresses must not be readable by colleagues. An event from a personal source is therefore visible
 * only to the person it belongs to; everything else keeps the workspace-wide behaviour.
 *
 * Expressed as a predicate rather than by omitting the rows at write time, because the event still
 * has to exist in the org for tenancy, purge and the owner's own reads.
 *
 * @param callerUserId - The signed-in person, or `null` when there is no session user.
 * @returns a condition to AND into the query.
 */
function visibleToCaller(callerUserId: string | null): SQL {
  const notPersonal = notInArray(event.sourceSystem, [...PERSONAL_ACTIVITY_SOURCES]);
  const own = callerUserId === null ? isNull(event.userId) : eq(event.userId, callerUserId);
  /* v8 ignore next -- `or` with two defined operands always yields a condition */
  return or(notPersonal, own) ?? notPersonal;
}

/** Workspace stream router: the org's full event firehose, plus manual subject resolution. */
const stream = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Stream',
      summary: 'List the workspace event stream',
      response: StreamPageOut,
      description: `The workspace firehose: every {@link StreamEventOut} in the organization — a read-projection of each \`observation\` — newest-first, attribute-filtered in SQL and keyset-paginated as a {@link StreamPageOut}. Each event is source-tagged (a \`docket\`-internal event or an external webhook from Linear/GitHub) so heterogeneous origins render through one homogeneous row with a provider badge and source-agnostic rendering hints. Unlike the cross-org **personal** stream (relevance-curated per recipient, in the Hub surface), this org-wide firehose shows all activity, so every row's \`relevance\` is \`null\`.

Filtering & paging: \`?system\` and \`?kind\` are convenience quick-filters; \`?filter\` is a base64-encoded JSON \`ViewFilter[]\` (the same stored shape saved views use) translated to SQL server-side, and \`?viewId\` loads a saved view's filters — all of which compose (AND). Paging is cursor-based (\`?cursor\`, \`?limit\`, \`?order\`): the response includes \`nextCursor\` only when more rows exist, and the cursor is a keyset over \`(occurredAt, id)\` for stable ordering. A read; org membership suffices. Related: \`GET /v1/orgs/:orgId/activity\` (the internal audit feed over Docket's own entities, a different concern from these external observations).`,
    }),
    zQuery(StreamQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const q = c.req.valid('query');

      // `?viewId` was declared on the query schema and validated, then never read — so a client
      // passing one got a 200 and an unfiltered feed, which is the worst way for a filter to fail.
      // A view id that names nothing in this org is a not-found rather than a silent no-op, for the
      // same reason.
      const savedFilters = q.viewId ? await loadViewFilters(orgId, q.viewId) : [];

      const conds: SQL[] = [
        eq(event.organizationId, orgId),
        visibleToCaller(c.get('session')?.user.id ?? null),
        ...buildFilterConditions(decodeFilter(q.filter)),
        ...buildFilterConditions(savedFilters),
      ];
      if (q.system) conds.push(eq(event.sourceSystem, q.system));
      if (q.kind) conds.push(eq(event.kind, q.kind));
      if (q.entityKind) conds.push(eq(event.entityKind, q.entityKind));
      const cursor = decodeCursor(q.cursor);
      if (cursor) conds.push(cursorCondition(cursor, q.order));

      const orderBy =
        q.order === 'asc'
          ? [asc(event.occurredAt), asc(event.id)]
          : [desc(event.occurredAt), desc(event.id)];

      const rows = await db
        .select()
        .from(event)
        .where(and(...conds))
        .orderBy(...orderBy)
        .limit(q.limit + 1);

      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      const last = page[page.length - 1];
      return ok(c, StreamPageOut, {
        items: page.map((r) => toStreamEventOut(r, null, new Set([actorId]))),
        ...(hasMore && last ? { nextCursor: encodeCursor(last.occurredAt, last.id) } : {}),
      });
    },
  )
  .post(
    '/:eventId/link',
    apiDoc({
      tag: 'Stream',
      summary: 'Attach an activity event to a task',
      response: StreamEventOut,
      description: `Resolve which piece of Docket work an activity event is about, when Docket could not work it out on its own. A meeting or a mail thread has no Docket mirror to match against, so it arrives with an unresolved subject; a pull request or an issue may simply not have been imported yet. Either way, naming the task by hand is what connects the activity to the work.

Resolving a subject widens who hears about the event: the task's assignee and lead become reachable by the ownership rules that could not run while the subject was unknown, and the task's search document is refreshed. Both are additive — nobody loses a notification they already had.

The event's own content is never altered. Any event already resolved answers 404, as does an event or task belonging to another workspace. Org membership suffices.`,
    }),
    zJson(StreamEventLinkBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const eventId = c.req.param('eventId');
      const { taskId } = c.req.valid('json');

      const linked = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(event)
          .where(and(eq(event.id, eventId), eq(event.organizationId, orgId)))
          .limit(1);
        // Existence-hiding: an event in another workspace and an event that does not exist answer the
        // same way, so the route reveals nothing about either.
        if (!row) throw new NotFoundError('Event not found');
        // Re-attributing somebody else's mailbox or calendar activity would silently rewrite what
        // their narrated day says and what their digest delivers, so a personal event is the owner's
        // to resolve. Reported as missing rather than forbidden, like every other scope check here.
        // An unowned event is workspace activity and org membership is enough; an owned one from a
        // personal source is that person's to resolve.
        const callerUserId = c.get('session')?.user.id ?? null;
        const personal = (PERSONAL_ACTIVITY_SOURCES as readonly string[]).includes(
          row.sourceSystem,
        );
        if (personal && row.userId !== null && row.userId !== callerUserId) {
          throw new NotFoundError('Event not found');
        }
        // Gated on `matched`, not on `pending`. `MIRROR_LOOKUP` maps both `calendar_event` and `thread`
        // to null, so every meeting and mail thread lands `unmatched` — gating on `pending` would make
        // exactly the sources that most need this unlinkable. `unmatched` only ever meant "Docket
        // cannot do this automatically", which is precisely when a manual answer is the point.
        if (row.entityAssociation === 'matched') throw new NotFoundError('Event not found');

        const [task] = await tx
          .select({ id: taskTable.id })
          .from(taskTable)
          .where(and(eq(taskTable.id, taskId), eq(taskTable.organizationId, orgId)))
          .limit(1);
        if (!task) throw new NotFoundError('Task not found');

        // Both columns together, which is what satisfies the `event_association_id_check` CHECK: the
        // state and the id are one fact and the constraint refuses to let them disagree.
        const [updated] = await tx
          .update(event)
          .set({ entityAssociation: 'matched', docketEntityId: task.id })
          .where(eq(event.id, eventId))
          .returning();
        /* v8 ignore next -- the row was just read inside this transaction */
        if (!updated) throw new NotFoundError('Event not found');

        // The point of resolving: the ownership rules query a Docket row by id, so until now they had
        // nothing to run against. Purely additive — the write ends in `onConflictDoNothing` and
        // `event_recipient` is keyed on `(eventId, userId)`.
        await routeAndWriteRecipients(
          tx,
          updated.id,
          {
            organizationId: orgId,
            kind: updated.kind,
            entity: updated.entity
              ? {
                  kind: updated.entity.kind,
                  source: updated.entity.source,
                  externalId: updated.entity.externalId,
                  docketEntityId: task.id,
                }
              : null,
            ownerUserId: updated.userId,
            externalRecipients: new Map(),
          },
          updated.occurredAt,
        );
        return updated;
      });

      // The task now has activity it did not visibly have, so its search document is stale.
      const target = eventSearchReindexTarget(linked.entityKind, linked.docketEntityId);
      if (target) {
        await enqueueSearchIndexJobs([
          {
            organizationId: orgId,
            sourceTable: target.sourceTable,
            entityId: target.entityId,
            operation: 'upsert',
            reason: 'event_log',
            sourceEventId: linked.id,
          },
        ]);
      }

      return ok(c, StreamEventOut, toStreamEventOut(linked, null, new Set([actorId])));
    },
  );

export default stream;
