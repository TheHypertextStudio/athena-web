/**
 * `@docket/api` — hub aggregation router (TOP-LEVEL, mounted at `/v1/hub`).
 *
 * @remarks
 * The caller's cross-org command center. Every route resolves the orgs the session user is
 * an active human Actor in and aggregates across them. Read-only projections only — never
 * merges tenant data (fan-out queries per membership, each item carries its own org id).
 */
import { auditEvent, db, event, hub as hubTable, notification } from '@docket/db';
import {
  HighlightOut,
  HighlightPatch,
  HighlightsDayOut,
  HubActivityOut,
  HubInboxOut,
  HubPortfolioOut,
  HubPreferences,
  HubSearchOut,
  HubTodayCompleteOut,
  HubTodayOut,
  ListQuery,
  StreamPageOut,
  StreamQuery,
} from '@docket/types';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import {
  buildFilterConditions,
  cursorCondition,
  decodeCursor,
  decodeFilter,
  encodeCursor,
} from '../lib/view-filter-sql';
import { zJson, zParam, zQuery } from '../lib/validate';
import { SearchHttpQuery } from '../search/http';
import { searchWorkspace } from '../search/query';

import { curateHighlight } from '../services/highlights/curate';
import { buildHighlightsDayPayload } from '../services/highlights/read';

import { callerActorIds, callerOrgIds, toAuditEventOut, toNotificationOut } from './hub-helpers';
import { toStreamEventOut } from './stream-helpers';
import { buildHubTodayPayload } from './hub-today';
import { completeTodayItem } from './hub-today-actions';
import { buildHubPortfolioPayload } from './hub-portfolio';

const todayQuery = z.object({ date: z.iso.date() });
/** The day to read; omitted means the caller's current local day. */
const highlightsQuery = z.object({ date: z.iso.date().optional() });
const todayItemParam = z.object({ planItemId: z.string() });
const portfolioQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  initiativeId: z.string().optional(),
});

/** Read the caller-owned Hub row or existence-hide the missing personal root. */
async function readHubPreferences(userId: string): Promise<z.infer<typeof HubPreferences>> {
  const rows = await db
    .select({ preferences: hubTable.preferences })
    .from(hubTable)
    .where(eq(hubTable.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Hub not found');
  return HubPreferences.parse(row.preferences);
}

/** Deep-merge nested preference groups so a focused patch cannot erase sibling settings. */
export function mergeHubPreferences(
  current: z.infer<typeof HubPreferences>,
  patch: z.infer<typeof HubPreferences>,
): z.infer<typeof HubPreferences> {
  return {
    ...current,
    ...patch,
    ...(patch.digest ? { digest: { ...current.digest, ...patch.digest } } : {}),
    ...(patch.proactive ? { proactive: { ...current.proactive, ...patch.proactive } } : {}),
    ...(patch.calendar ? { calendar: { ...current.calendar, ...patch.calendar } } : {}),
    ...(patch.athena ? { athena: { ...current.athena, ...patch.athena } } : {}),
  };
}
/** Hub router: cross-org `today`, `inbox`, `activity`, `portfolio`, and `search` surfaces. */
const hubRouter = new Hono<AppEnv>()
  .get(
    '/preferences',
    apiDoc({
      tag: 'Hub',
      summary: 'Get Hub preferences',
      response: HubPreferences,
      description:
        'Return the signed-in user personal Hub preferences, including unified-calendar layout and creation defaults. Preferences are resolved only from the caller-owned Hub row.',
    }),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      return ok(c, HubPreferences, await readHubPreferences(session.user.id));
    },
  )
  .post(
    '/today/items/:planItemId/complete',
    apiDoc({
      tag: 'Hub',
      summary: 'Complete one accepted Today item',
      response: HubTodayCompleteOut,
      description:
        "Resolve a caller-owned personal plan row, require the caller's active membership to hold `contribute` in the Task's organization, advance the Task through the owning Team's completed workflow state, and mark the plan row done in one transaction. The client supplies no organization, Task, user, or state id.",
    }),
    zParam(todayItemParam),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { planItemId } = c.req.valid('param');
      return ok(c, HubTodayCompleteOut, await completeTodayItem(session.user.id, planItemId));
    },
  )
  .patch(
    '/preferences',
    apiDoc({
      tag: 'Hub',
      summary: 'Update Hub preferences',
      response: HubPreferences,
      description:
        'Patch the signed-in user personal Hub preferences. Nested groups are deep-merged, so focused updates preserve sibling calendar, digest, Athena, and proactive settings.',
    }),
    zJson(HubPreferences),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const patch = c.req.valid('json');
      const preferences = await db.transaction(async (tx) => {
        const currentRows = await tx
          .select({ preferences: hubTable.preferences })
          .from(hubTable)
          .where(eq(hubTable.userId, session.user.id))
          .limit(1)
          .for('update');
        const current = currentRows[0];
        if (!current) throw new NotFoundError('Hub not found');
        const merged = mergeHubPreferences(HubPreferences.parse(current.preferences), patch);
        const rows = await tx
          .update(hubTable)
          .set({ preferences: merged })
          .where(eq(hubTable.userId, session.user.id))
          .returning({ preferences: hubTable.preferences });
        const updated = rows[0];
        /* v8 ignore next -- @preserve the locked caller-owned Hub row exists */
        if (!updated) throw new NotFoundError('Hub not found');
        return HubPreferences.parse(updated.preferences);
      });
      return ok(c, HubPreferences, preferences);
    },
  )
  .get(
    '/today',
    apiDoc({
      tag: 'Hub',
      summary: 'Get the cross-org today view',
      response: HubTodayOut,
      description: `Aggregate the signed-in person's "what should I do now" across **every organization they belong to**, for a single \`date\` (required query param). Returns the caller's accepted personal plan, its derived \`unplanned\`/\`active\`/\`cleared\` state, a finite Now/After focus sequence, up to four grounded Project or Initiative status stories, and up to three feasible momentum suggestions. Due work remains in \`needsAttention\`; sharing a date never silently accepts a Task into the personal plan.

Candidate queries are tenant-bounded and every Task, Project, and Initiative is filtered through the shared batched resource-access resolver before selection. Ranking is deterministic; Athena supplies the interaction surface, not invented project facts. Requires only an authenticated session because the per-resource gate already ran per row. 401 when unauthenticated. Related: \`/daily-plan\`, \`/schedule/week/day/start\`, \`/notifications/count\`, \`/hub/inbox\`, and the detailed Project/Initiative surfaces.`,
    }),
    zQuery(todayQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      return ok(c, HubTodayOut, await buildHubTodayPayload(session.user.id, date));
    },
  )
  .get(
    '/inbox',
    apiDoc({
      tag: 'Hub',
      summary: 'Get the cross-org inbox',
      response: HubInboxOut,
      description: `Return the caller's notification feed across every organization they belong to, newest first, as the Hub's inbox pane. This is the same underlying cross-org notification set as \`GET /notifications\`, scoped by the mandatory \`userId = session.user.id\` predicate and rendered for the Hub cockpit (each item carries its originating \`organizationId\` org chip). Unlike \`/notifications\` it takes no narrowing filters — it is the full unread-first feed.

Read-only; session-only, no capability. 401 when unauthenticated. To mutate read state use the \`/notifications/*\` read/act endpoints. Related: \`/hub/today\` surfaces the unread *count* in \`needsAttention.inbox\`.`,
    }),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const rows = await db
        .select()
        .from(notification)
        .where(eq(notification.userId, session.user.id))
        .orderBy(desc(notification.createdAt));
      return ok(c, HubInboxOut, { items: rows.map(toNotificationOut) });
    },
  )
  .get(
    '/activity',
    apiDoc({
      tag: 'Hub',
      summary: 'List cross-org activity',
      response: HubActivityOut,
      description: `Return the caller's passive-awareness **audit feed** across every org they belong to — the "what's been happening" timeline. The route first resolves the caller's org ids (the orgs where they are an active human Actor), then selects audit events scoped to that org set with \`organizationId IN (...)\`, ordered by \`createdAt\` (\`order=asc|desc\`) and keyset-paginated by \`limit\`. A caller with no memberships gets an empty list immediately (no query).

**Pagination:** the handler fetches \`limit + 1\` rows to detect more; when there is a next page it returns \`nextCursor\` set to the last event's id (an opaque forward cursor). Read-only; session-only, no capability. 401 when unauthenticated. Distinct from \`/hub/stream\`, which is the personalized "concerns me" observation feed rather than the raw org audit log.`,
    }),
    zQuery(ListQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { limit, order } = c.req.valid('query');
      const orgIds = await callerOrgIds(session.user.id);
      if (orgIds.length === 0) return ok(c, HubActivityOut, { items: [] });

      const orderBy = order === 'asc' ? auditEvent.createdAt : desc(auditEvent.createdAt);
      const rows = await db
        .select()
        .from(auditEvent)
        .where(inArray(auditEvent.organizationId, orgIds))
        .orderBy(orderBy)
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      return ok(c, HubActivityOut, {
        items: page.map(toAuditEventOut),
        ...(hasMore && last ? { nextCursor: last.id } : {}),
      });
    },
  )
  .get(
    '/stream',
    apiDoc({
      tag: 'Hub',
      summary: 'Get the cross-org activity stream',
      response: StreamPageOut,
      description: `Return the complete event timeline across every workspace the caller belongs to. This is a context-wide history rather than a personalized attention queue: every event in the caller's active workspace set is eligible, whether or not it names the caller as a recipient. Each event retains its organization id so workspace boundaries remain explicit, and \`actorIsViewer\` identifies actions performed by the caller without name matching.

**Filtering & pagination:** supports attribute filters (an encoded \`filter\` expression compiled to SQL), plus \`system\`, \`kind\`, and \`entityKind\` narrowing. It is keyset-paginated on \`(occurredAt, eventId)\`, fetching \`limit + 1\` to detect more and returning an opaque \`nextCursor\` when another page exists; \`order=asc|desc\` flips the sort. A caller with no memberships gets an empty page. Session-only, no capability; 401 when unauthenticated.`,
    }),
    zQuery(StreamQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const q = c.req.valid('query');
      const orgIds = await callerOrgIds(session.user.id);
      if (orgIds.length === 0) return ok(c, StreamPageOut, { items: [] });
      const viewerActorIds = new Set(await callerActorIds(session.user.id));

      const conds: SQL[] = [
        inArray(event.organizationId, orgIds),
        ...buildFilterConditions(decodeFilter(q.filter)),
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
        items: page.map((row) => toStreamEventOut(row, null, viewerActorIds)),
        ...(hasMore && last ? { nextCursor: encodeCursor(last.occurredAt, last.id) } : {}),
      });
    },
  )
  .get(
    '/portfolio',
    apiDoc({
      tag: 'Hub',
      summary: 'Get the cross-org portfolio',
      response: HubPortfolioOut,
      description: `Return the caller's cross-org **portfolio timeline** — org swimlanes, each containing Program lanes and the Project bars (with milestone diamonds) beneath them, laid out on one shared timeline. Projects with no program hang directly off the org swimlane as \`unassigned\` bars. Optional \`from\`/\`to\` (ISO dates) bound the timeline window and \`initiativeId\` narrows to a single initiative's projects.

Built as a per-membership fan-out merged in application code: **tenant bands stay separate** — each swimlane carries its own \`OrgChip\` and bars carry their own \`organizationId\`, so this is a union of per-org rollups, never a cross-tenant join. Read-only; session-only, no capability. 401 when unauthenticated. Related: \`/hub/today\` (the day-level cockpit) vs this strategic, multi-week timeline view.`,
    }),
    zQuery(portfolioQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { from, to, initiativeId } = c.req.valid('query');
      return ok(
        c,
        HubPortfolioOut,
        await buildHubPortfolioPayload(session.user.id, from, to, initiativeId),
      );
    },
  )
  .get(
    '/search',
    apiDoc({
      tag: 'Hub',
      summary: 'Search across orgs',
      response: HubSearchOut,
      description: `Cross-org semantic search for the Hub command palette and search page. Results are read from the durable \`search_document\` projection, scoped to the caller's active memberships and user-private documents, and returned as typed \`SearchResult\` rows with route, family, kind, snippet, source, subject, and facet metadata.`,
    }),
    zQuery(SearchHttpQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const params = c.req.valid('query');
      return ok(
        c,
        HubSearchOut,
        await searchWorkspace({
          scope: 'hub',
          caller: { kind: 'user', userId: session.user.id },
          activeOrgId: params.activeOrgId ?? null,
          params,
        }),
      );
    },
  )
  .get(
    '/highlights',
    apiDoc({
      tag: 'Hub',
      summary: 'Get a narrated day',
      response: HighlightsDayOut,
      description: `Return one local day of the caller's own activity, grouped into episodes and narrated a sentence at a time. An episode is everything that happened to one subject on one day, so a run of commits on one pull request or a thread answered several times is a single entry rather than one per event.

Each entry carries the sentence, whether a person has rewritten it, whether it is currently kept, and the underlying events. \`sources\` reports how each connected source fared for this day, as a state rather than a message: a day where a source could not be read is distinguishable from a day where nothing happened.

Read-only. Building the day is a separate operation, so a response can legitimately be \`pending\` (never built), \`empty\` (built, no activity) or carry entries whose narration is still \`generating\`. Session-only, no capability; 401 when unauthenticated. \`date\` defaults to the caller's current local day and may not be in the future.`,
    }),
    zQuery(highlightsQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      // A future day is refused by the builder rather than here, so the agent tool that reads the
      // same payload cannot answer a question the route would have declined.
      return ok(
        c,
        HighlightsDayOut,
        await buildHighlightsDayPayload(session.user.id, date, new Date()),
      );
    },
  )
  .patch(
    '/highlights/:highlightId',
    apiDoc({
      tag: 'Hub',
      summary: 'Change what a highlight says',
      response: HighlightOut,
      description: `Drop a highlight from the day, restore it, or replace its sentence with the caller's own. One route covers all three because they are one act from the caller's side: deciding what their day says.

The activity log itself is append-only and is never touched here — only the narration and the keep decision move. Dropping keeps the entry as a record rather than deleting it, so the choice stays reversible. Sending \`narration: null\` reverts to the generated sentence; an empty string is rejected, since removing a line is what dropping is for.

Session-only, no capability. A highlight belonging to another caller answers 404 rather than 403, so the route reveals nothing about days that are not the caller's.`,
    }),
    zJson(HighlightPatch),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const patch = c.req.valid('json');
      if (patch.narration?.trim() === '') {
        throw new ConflictError(
          'A highlight needs something to say. Drop it instead.',
          'validation_error',
        );
      }
      return ok(
        c,
        HighlightOut,
        await curateHighlight(session.user.id, c.req.param('highlightId'), patch, new Date()),
      );
    },
  );

export default hubRouter;
