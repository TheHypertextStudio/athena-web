/**
 * `@docket/api` — browse mode: the same permission-filtered corpus as ranked search, with no query
 * and no scoring, ordered by recency.
 */
import { and, desc, inArray, isNull } from 'drizzle-orm';

import { encodeListCursor, seekAfter } from '../lib/list-cursor';
import { collapseActivityRows } from './query-collapse';
import { buildFacetSummaries } from './query-facets';
import { filterRow, rowSortTime } from './query-filters';
import { toSearchResult, withSearchDisplays } from './query-results';
import { fallbackSnippetMatch } from './query-scoring';
import { usedInForPage } from './query-lookups';
import {
  documentVisibilityCondition,
  filterVisibleRows,
  type CallerOrgAccess,
} from './query-visibility';
import type { ScoredRow, SearchCaller, SearchDocumentRow, SearchQueryParams } from './query-types';
import type { SearchOut } from '../contracts/search';

/**
 * How many times {@link browseDocuments} refills before returning a short page.
 *
 * @remarks
 * Visibility filtering runs in application code after the query, so a whole chunk can come back
 * invisible to this caller. Refilling is what stops a page from looking empty while more rows
 * exist behind it. The bound keeps a workspace whose rows are nearly all private from turning one
 * request into an unbounded scan; hitting it returns a short page, never a wrong one.
 */
const BROWSE_REFILL_ROUNDS = 6;

/** What {@link browseDocuments} needs: the caller's resolved scope, page size, and active filters. */
export interface BrowseInput {
  params: SearchQueryParams;
  /** Whose permissions the "used in" resolution filters through. */
  caller: SearchCaller;
  limit: number;
  ownerUserId: string | null;
  orgIds: readonly string[];
  accessByOrg: ReadonlyMap<string, CallerOrgAccess>;
  fromTime: number | null;
  toTime: number | null;
}

/**
 * Browse the corpus with no query: the same permission-filtered rows, newest first.
 *
 * @remarks
 * Ordering is the database's `(updatedAt DESC, id DESC)`, reusing {@link seekAfter} so browse
 * shares the repository's one keyset mechanism instead of deriving a second seek predicate.
 *
 * Deliberately *not* re-ranked in application code. Scoring here would reorder rows within a page
 * without reordering them across pages, which is exactly how a keyset paginator starts dropping
 * and duplicating rows at its boundaries.
 *
 * @param input - The caller's resolved scope, page size, and the active facet filters.
 * @returns One page of visible rows, plus the cursor for the next one.
 */
export async function browseDocuments(input: BrowseInput): Promise<SearchOut> {
  const collected: ScoredRow[] = [];
  const seen = new Set<string>();
  let cursor = input.params.cursor;
  let exhausted = false;
  // Recomputed at the end of every round that adds rows, and read again as next round's break
  // check — so a round that finds nothing new never re-collapses the same `collected` twice.
  let deduped: readonly ScoredRow[] = [];

  // Over-fetch against the page size: both the visibility filter and the facet filters below run
  // in application code, so the database cannot know how many of these rows survive.
  const chunkSize = Math.min((input.limit + 1) * 4, 400);

  for (let round = 0; round < BROWSE_REFILL_ROUNDS && !exhausted; round += 1) {
    // Checked post-collapse, not against `collected.length` directly: activity-row duplicates
    // pass `seen`/`filterRow` freely (each has its own row id) and can inflate the raw count while
    // collapsing away to far fewer distinct rows, which would otherwise stop refilling before a
    // full page's worth of distinct results has actually been gathered.
    if (deduped.length > input.limit) break;
    const rows = await loadBrowseRows({
      ownerUserId: input.ownerUserId,
      orgIds: input.orgIds,
      includeArchived: input.params.includeArchived ?? false,
      cursor,
      limit: chunkSize,
      kinds: input.params.kinds ?? [],
      families: input.params.families ?? [],
      ids: input.params.ids ?? [],
    });
    if (rows.length < chunkSize) exhausted = true;
    const lastFetched = rows[rows.length - 1];
    if (!lastFetched) break;
    cursor = encodeListCursor(lastFetched.updatedAt, lastFetched.id);

    const visible = await filterVisibleRows(rows, {
      ownerUserId: input.ownerUserId,
      accessByOrg: input.accessByOrg,
    });
    for (const row of visible.rows) {
      if (seen.has(row.id)) continue;
      if (!filterRow(row, input.params, input.fromTime, input.toTime)) continue;
      seen.add(row.id);
      collected.push(browseRow(row));
    }
    deduped = collapseActivityRows(collected);
  }

  const page = deduped.slice(0, input.limit);
  const last = page[page.length - 1];
  const hasMore = deduped.length > input.limit;
  // When the bounded visibility refill stops before the database is exhausted, continue after the
  // final raw row scanned. Every row before that cursor was either collected or rejected, so this
  // advances without dropping an unseen candidate. If we already collected an extra visible row,
  // continue after the last row returned instead so that extra row leads the next page — though
  // `collapseActivityRows` has no memory across calls, so an activity row correctly collapsed on
  // this page (because its subject's own row was also in `collected`, ahead of the cursor) can
  // reappear at the top of the next page once that subject's row is no longer in the scan window.
  const nextCursor = hasMore
    ? last
      ? encodeListCursor(last.row.updatedAt, last.row.id)
      : undefined
    : !exhausted
      ? cursor
      : undefined;
  const usedIn = await usedInForPage(page, input.caller);
  const items = await withSearchDisplays(
    page.map((row) => toSearchResult(row, usedIn.get(row.row.id) ?? [])),
  );
  return {
    query: '',
    // These facets summarize the returned page, not the corpus. The Library's filter options come
    // from its field catalog, which reads members, teams, and labels directly, so no surface
    // depends on them being complete.
    facets: buildFacetSummaries(page),
    items,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

/**
 * Present one browsed row as a result.
 *
 * @remarks
 * `score` carries the row's static prior and takes no part in ordering — see
 * {@link browseDocuments} for why browse must not re-rank. `matchedFields` is empty because
 * nothing was matched against.
 */
function browseRow(row: SearchDocumentRow): ScoredRow {
  return {
    row,
    score: row.baseRank,
    sortTime: rowSortTime(row),
    matchedFields: [],
    snippetMatch: fallbackSnippetMatch(row),
  };
}

/**
 * Fetch one chunk of the browse ordering.
 *
 * @remarks
 * Orders by `search_document.updatedAt` rather than the source's own `sourceUpdatedAt` because
 * `updatedAt` is NOT NULL and is the trailing key of both composite indexes, which is what lets
 * {@link seekAfter} page over it without a nullable-ordering special case. The cost is that a full
 * reindex rewrites every row and therefore reshuffles browse order; display still reads
 * `sourceUpdatedAt` so the visible "updated" value survives a reindex.
 */
async function loadBrowseRows(input: {
  ownerUserId: string | null;
  orgIds: readonly string[];
  includeArchived: boolean;
  cursor: string | undefined;
  limit: number;
  kinds: readonly string[];
  families: readonly string[];
  ids: readonly string[];
}) {
  const schema = await import('@docket/db');
  const conditions = [
    documentVisibilityCondition(schema.searchDocument, input.ownerUserId, input.orgIds),
    seekAfter(schema.searchDocument.updatedAt, schema.searchDocument.id, input.cursor),
  ];
  if (!input.includeArchived) conditions.push(isNull(schema.searchDocument.archivedAt));
  // Push the kind/family narrowing into SQL rather than leaving it to `filterRow` downstream.
  // `search_document_org_kind_rank_idx` covers it, and without this a surface asking for two of
  // the eighteen kinds — the Library — pulls a full chunk of every kind, resolves grants for all
  // of them, discards nearly all, and refills. That was the whole cost of the page.
  if (input.kinds.length > 0) {
    conditions.push(inArray(schema.searchDocument.kind, [...input.kinds] as 'task'[]));
  }
  if (input.families.length > 0) {
    conditions.push(inArray(schema.searchDocument.family, [...input.families] as 'work'[]));
  }
  // A deep link names one row that may sit far past the first page; resolving it by id keeps that
  // link working without paging the whole corpus to find it.
  if (input.ids.length > 0) {
    conditions.push(inArray(schema.searchDocument.entityId, [...input.ids]));
  }

  const rows = await schema.db
    .select({ document: schema.searchDocument })
    .from(schema.searchDocument)
    .where(and(...conditions))
    .orderBy(desc(schema.searchDocument.updatedAt), desc(schema.searchDocument.id))
    .limit(input.limit);
  return rows.map((row) => ({ ...row.document, textRank: 0 }));
}
