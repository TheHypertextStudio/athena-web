/**
 * `@docket/api` — the keyset-batched candidate scan behind ranked search.
 */
import { and, asc, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { searchDocument } from '@docket/db';

import type { SearchOut } from '../contracts/search';
import { addFacetCountRow, createFacetCounts, facetSummaries } from './query-facets';
import { filterRow } from './query-filters';
import { scoreRow } from './query-scoring';
import { compareCursor, compareScoredRows, type CursorShape } from './query-cursor';
import {
  documentVisibilityCondition,
  filterVisibleRows,
  type CallerOrgAccess,
} from './query-visibility';
import type { ScoredRow, SearchAbortSignal, SearchQueryParams } from './query-types';

/** Maximum rows held for one permission and scoring batch during ranked search. */
const SEARCH_CANDIDATE_BATCH_SIZE = 250;

interface RankedCandidateScanInput {
  ownerUserId: string | null;
  orgIds: readonly string[];
  query: string;
  includeArchived: boolean;
  params: SearchQueryParams;
  accessByOrg: ReadonlyMap<string, CallerOrgAccess>;
  activeOrgId: string | null;
  fromTime: number | null;
  toTime: number | null;
  cursor: CursorShape | null;
  rankedAt: number;
  limit: number;
  signal: SearchAbortSignal | undefined;
}

/**
 * Scan every matching candidate through bounded batches while retaining only rows this page can
 * return.
 *
 * @remarks
 * Exact relevance ordering requires considering the complete visible corpus because relationship
 * and recency boosts are application-owned. The scan therefore keyset-pages the database by id,
 * applies permissions per batch, and keeps at most `limit + 1` scored rows in memory. Palette
 * diversity keeps at most `limit` rows per family, which is sufficient to reproduce the existing
 * cap without retaining the corpus. One extra row per family preserves the continuation signal.
 * Facet counts accumulate as numbers rather than result rows.
 */
export async function scanRankedCandidates(
  input: RankedCandidateScanInput,
): Promise<{ scored: readonly ScoredRow[]; facets: SearchOut['facets'] }> {
  const diverse = input.params.surface === 'palette' && input.cursor === null;
  const best = new Map<string, ScoredRow[]>();
  const globalKey = '__global__';
  const facetCounts = createFacetCounts();
  let afterId: string | undefined;

  for (;;) {
    throwIfSearchAborted(input.signal);
    const candidates = await loadCandidateRows({
      ownerUserId: input.ownerUserId,
      orgIds: input.orgIds,
      query: input.query,
      includeArchived: input.includeArchived,
      kinds: input.params.kinds ?? [],
      families: input.params.families ?? [],
      sources: input.params.sources ?? [],
      ids: input.params.ids ?? [],
      afterId,
      limit: SEARCH_CANDIDATE_BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    afterId = candidates.at(-1)?.id;

    const visible = await filterVisibleRows(candidates, {
      ownerUserId: input.ownerUserId,
      accessByOrg: input.accessByOrg,
    });
    throwIfSearchAborted(input.signal);
    for (const row of visible.rows) {
      if (!filterRow(row, input.params, input.fromTime, input.toTime)) continue;
      const scored = scoreRow(row, input.query, {
        activeOrgId: input.activeOrgId,
        ownerUserId: input.ownerUserId,
        callerActorId: row.organizationId
          ? (input.accessByOrg.get(row.organizationId)?.actorId ?? null)
          : null,
        activityRecipient: visible.recipientEventIds.has(row.entityId),
        rankedAt: input.rankedAt,
      });
      if (!scored || (input.cursor && compareCursor(scored, input.cursor) <= 0)) continue;
      addFacetCountRow(facetCounts, scored.row);
      const key = diverse ? scored.row.family : globalKey;
      const rows = best.get(key) ?? [];
      keepBestScored(rows, scored, input.limit + 1);
      best.set(key, rows);
    }

    if (candidates.length < SEARCH_CANDIDATE_BATCH_SIZE) break;
  }

  const scored = [...best.values()].flat().sort(compareScoredRows);
  return { scored, facets: facetSummaries(facetCounts) };
}

/** Stop between bounded search batches after the HTTP request has been abandoned. */
function throwIfSearchAborted(signal: SearchAbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('Search request aborted.');
  error.name = 'AbortError';
  throw error;
}

/** Retain the best `max` rows in-place. */
function keepBestScored(rows: ScoredRow[], candidate: ScoredRow, max: number): void {
  rows.push(candidate);
  rows.sort(compareScoredRows);
  if (rows.length > max) rows.pop();
}

/** Escape PostgreSQL `LIKE` metacharacters so search input is always literal text. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

async function loadCandidateRows(input: {
  ownerUserId: string | null;
  orgIds: readonly string[];
  query: string;
  includeArchived: boolean;
  kinds: readonly string[];
  families: readonly string[];
  sources: readonly string[];
  ids: readonly string[];
  afterId: string | undefined;
  limit: number;
}) {
  const schema = await import('@docket/db');
  const pattern = `%${escapeLikePattern(input.query)}%`;
  const textVector = searchTextVector(schema.searchDocument);
  const tsQuery = sql`plainto_tsquery('simple', ${input.query})`;
  const fullTextMatch = sql`${textVector} @@ ${tsQuery}`;
  const conditions = [
    documentVisibilityCondition(schema.searchDocument, input.ownerUserId, input.orgIds),
    or(
      fullTextMatch,
      ilike(schema.searchDocument.title, pattern),
      ilike(schema.searchDocument.summary, pattern),
      ilike(schema.searchDocument.body, pattern),
    ),
  ];
  if (!input.includeArchived) conditions.push(isNull(schema.searchDocument.archivedAt));
  if (input.kinds.length > 0) {
    conditions.push(inArray(schema.searchDocument.kind, [...input.kinds] as 'task'[]));
  }
  if (input.families.length > 0) {
    conditions.push(inArray(schema.searchDocument.family, [...input.families] as 'work'[]));
  }
  if (input.sources.length > 0) {
    conditions.push(inArray(schema.searchDocument.sourceSystem, [...input.sources] as 'docket'[]));
  }
  if (input.ids.length > 0)
    conditions.push(inArray(schema.searchDocument.entityId, [...input.ids]));
  if (input.afterId) conditions.push(gt(schema.searchDocument.id, input.afterId));
  const rows = await schema.db
    .select({
      document: schema.searchDocument,
      textRank: sql<number>`ts_rank_cd(${textVector}, ${tsQuery})`,
    })
    .from(schema.searchDocument)
    .where(and(...conditions))
    .orderBy(asc(schema.searchDocument.id))
    .limit(input.limit);
  return rows.map((row) => ({ ...row.document, textRank: row.textRank || 0 }));
}

function searchTextVector(table: typeof searchDocument) {
  return sql`(
    setweight(to_tsvector('simple', coalesce(${table.title}, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(${table.summary}, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(${table.body}, '')), 'C')
  )`;
}
