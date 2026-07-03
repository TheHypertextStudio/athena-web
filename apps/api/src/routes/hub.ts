/**
 * `@docket/api` — hub aggregation router (TOP-LEVEL, mounted at `/v1/hub`).
 *
 * @remarks
 * The caller's cross-org command center. Every route resolves the orgs the session user is
 * an active human Actor in and aggregates across them. Read-only projections only — never
 * merges tenant data (fan-out queries per membership, each item carries its own org id).
 */
import { auditEvent, db, event, eventRecipient, notification } from '@docket/db';
import {
  HubActivityOut,
  HubInboxOut,
  HubPortfolioOut,
  HubSearchOut,
  HubTodayOut,
  ListQuery,
  StreamPageOut,
  StreamQuery,
} from '@docket/types';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import {
  buildFilterConditions,
  cursorCondition,
  decodeCursor,
  decodeFilter,
  encodeCursor,
} from '../lib/view-filter-sql';
import { zQuery } from '../lib/validate';
import { SearchHttpQuery } from '../search/http';
import { searchWorkspace } from '../search/query';

import { callerOrgIds, toAuditEventOut, toNotificationOut } from './hub-helpers';
import { toStreamEventOut } from './stream-helpers';
import { buildHubTodayPayload } from './hub-today';
import { buildHubPortfolioPayload } from './hub-portfolio';

const todayQuery = z.object({ date: z.iso.date() });
const portfolioQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  initiativeId: z.string().optional(),
});
/** Hub router: cross-org `today`, `inbox`, `activity`, `portfolio`, and `search` surfaces. */
const hubRouter = new Hono<AppEnv>()
  .get(
    '/today',
    apiDoc({
      tag: 'Hub',
      summary: 'Get the cross-org today view',
      response: HubTodayOut,
      description: `Aggregate the signed-in person's "what should I look at right now" across **every organization they belong to**, for a single \`date\` (required query param). Returns a three-pane cockpit: \`plan\` (Tasks the caller pulled into their daily plan plus Tasks due that date), \`calendar\` (daily-plan items that carry a timebox window), and \`needsAttention\` (the trio of pending approvals, blocked Tasks, and Tasks due today, plus the unread \`inbox\` count).

Implemented as a **server-side fan-out** — one scoped query per membership where the caller has an active human Actor, merged in application code (never a cross-tenant SQL join). Each returned item carries its own \`organizationId\` (its org chip) and is individually run through that org's permission predicate, so the view is the **union of per-org decisions**, not a privileged bypass. Requires only an authenticated session (the per-resource gate already ran per row); no capability. 401 when unauthenticated; a caller with no memberships gets empty panes. Related: \`/daily-plan\` (the source of \`plan\`/\`calendar\`), \`/notifications/count\` (the \`inbox\` number), \`/hub/inbox\`, \`/hub/portfolio\`.`,
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
      description: `Return the caller's personalized **"concerns me" event stream** across every org they belong to — the feed of external observations (provider activity) that name the caller as a recipient. This is distinct from \`/hub/activity\`'s raw org audit log: it reads the \`observationRecipient\` index (the per-user denormalization of who each observation concerns) joined to its \`observation\`, scoped to the caller (\`observationRecipient.userId = session.user.id\`) and to the caller's org set, so it is the union of "things that pertain to me" rather than everything that happened.

**Filtering & pagination:** supports attribute filters (an encoded \`filter\` expression compiled to SQL), plus \`provider\` and \`kind\` narrowing. It is keyset-paginated on the recipient's denormalized \`(occurredAt, observationId)\` — the exact index this table exists to serve — fetching \`limit + 1\` to detect more and returning an opaque \`nextCursor\` (encoded \`occurredAt\`+id) when another page exists; \`order=asc|desc\` flips the sort. Each event carries the \`reason\` it reached the caller. A caller with no memberships gets an empty page. Mounted outside the typed RPC contract (a raw event-stream surface). Session-only, no capability; 401 when unauthenticated.`,
    }),
    zQuery(StreamQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const q = c.req.valid('query');
      const orgIds = await callerOrgIds(session.user.id);
      if (orgIds.length === 0) return ok(c, StreamPageOut, { items: [] });

      // Personal "concerns me" feed: the recipient index joined to its event, scoped to
      // the caller's orgs, attribute-filtered in SQL, keyset-paginated on the recipient's
      // denormalized (occurredAt, eventId) — the index this table is built for.
      const conds: SQL[] = [
        eq(eventRecipient.userId, session.user.id),
        inArray(event.organizationId, orgIds),
        ...buildFilterConditions(decodeFilter(q.filter)),
      ];
      if (q.system) conds.push(eq(event.sourceSystem, q.system));
      if (q.kind) conds.push(eq(event.kind, q.kind));
      if (q.entityKind) conds.push(eq(event.entityKind, q.entityKind));
      const cursor = decodeCursor(q.cursor);
      if (cursor) {
        conds.push(
          cursorCondition(cursor, q.order, eventRecipient.occurredAt, eventRecipient.eventId),
        );
      }

      const orderBy =
        q.order === 'asc'
          ? [asc(eventRecipient.occurredAt), asc(eventRecipient.eventId)]
          : [desc(eventRecipient.occurredAt), desc(eventRecipient.eventId)];

      const rows = await db
        .select({ ev: event, reason: eventRecipient.reason })
        .from(eventRecipient)
        .innerJoin(event, eq(event.id, eventRecipient.eventId))
        .where(and(...conds))
        .orderBy(...orderBy)
        .limit(q.limit + 1);

      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      const last = page[page.length - 1];
      return ok(c, StreamPageOut, {
        items: page.map((r) => toStreamEventOut(r.ev, r.reason)),
        ...(hasMore && last ? { nextCursor: encodeCursor(last.ev.occurredAt, last.ev.id) } : {}),
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
      return ok(
        c,
        HubSearchOut,
        await searchWorkspace({
          scope: 'hub',
          userId: session.user.id,
          params: c.req.valid('query'),
        }),
      );
    },
  );

export default hubRouter;
