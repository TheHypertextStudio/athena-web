/**
 * `@docket/api` — per-workspace stream router (ORG-SCOPED, mounted at `/v1/orgs/:orgId/stream`).
 *
 * @remarks
 * The workspace firehose: every {@link observation} in the org, newest-first, attribute-
 * filtered in SQL and keyset-paginated. Unlike the cross-org personal stream (in `hub.ts`,
 * relevance-curated via `observation_recipient`), this surface shows all org activity, so
 * `relevance` is always `null`. Reads `orgId` from `orgContextMiddleware`.
 */
import { db, observation } from '@docket/db';
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

/** Workspace stream router: the org's full observation firehose, filtered + paginated. */
const stream = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    tag: 'Stream',
    summary: 'List the workspace observation stream',
    response: StreamPageOut,
  }),
  zQuery(StreamQuery),
  async (c) => {
    const { orgId } = c.get('actorCtx');
    const q = c.req.valid('query');

    const conds: SQL[] = [
      eq(observation.organizationId, orgId),
      ...buildFilterConditions(decodeFilter(q.filter)),
    ];
    if (q.provider) conds.push(eq(observation.provider, q.provider));
    if (q.kind) conds.push(eq(observation.kind, q.kind));
    const cursor = decodeCursor(q.cursor);
    if (cursor) conds.push(cursorCondition(cursor, q.order));

    const orderBy =
      q.order === 'asc'
        ? [asc(observation.occurredAt), asc(observation.id)]
        : [desc(observation.occurredAt), desc(observation.id)];

    const rows = await db
      .select()
      .from(observation)
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
