/**
 * `@docket/api` — per-workspace stream router (ORG-SCOPED, mounted at `/v1/orgs/:orgId/stream`).
 *
 * @remarks
 * The workspace firehose: every {@link event} in the org, newest-first, attribute-
 * filtered in SQL and keyset-paginated. Unlike the cross-org personal stream (in `hub.ts`,
 * relevance-curated via `event_recipient`), this surface shows all org activity, so
 * `relevance` is always `null`. Reads `orgId` from `orgContextMiddleware`.
 */
import { db, event } from '@docket/db';
import { StreamPageOut, StreamQuery } from '@docket/types';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import {
  buildFilterConditions,
  cursorCondition,
  decodeCursor,
  decodeFilter,
  encodeCursor,
} from '../lib/view-filter-sql';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zQuery } from '../lib/validate';

import { toStreamEventOut } from './stream-helpers';

/** Workspace stream router: the org's full event firehose, filtered + paginated. */
const stream = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    tag: 'Stream',
    summary: 'List the workspace event stream',
    response: StreamPageOut,
    description: `The workspace firehose: every {@link StreamEventOut} in the organization — a read-projection of each \`observation\` — newest-first, attribute-filtered in SQL and keyset-paginated as a {@link StreamPageOut}. Each event is source-tagged (a \`docket\`-internal event or an external webhook from Linear/GitHub) so heterogeneous origins render through one homogeneous row with a provider badge and source-agnostic rendering hints. Unlike the cross-org **personal** stream (relevance-curated per recipient, in the Hub surface), this org-wide firehose shows all activity, so every row's \`relevance\` is \`null\`.

Filtering & paging: \`?provider\` and \`?kind\` are convenience quick-filters; \`?filter\` is a base64-encoded JSON \`ViewFilter[]\` (the same stored shape saved views use) translated to SQL server-side, and \`?viewId\` loads a saved view's filters — all of which compose (AND). Paging is cursor-based (\`?cursor\`, \`?limit\`, \`?order\`): the response includes \`nextCursor\` only when more rows exist, and the cursor is a keyset over \`(occurredAt, id)\` for stable ordering. A read; org membership suffices. Related: \`GET /v1/orgs/:orgId/activity\` (the internal audit feed over Docket's own entities, a different concern from these external observations).`,
  }),
  zQuery(StreamQuery),
  async (c) => {
    const { orgId } = c.get('actorCtx');
    const q = c.req.valid('query');

    const conds: SQL[] = [
      eq(event.organizationId, orgId),
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
      items: page.map((r) => toStreamEventOut(r, null)),
      ...(hasMore && last ? { nextCursor: encodeCursor(last.occurredAt, last.id) } : {}),
    });
  },
);

export default stream;
