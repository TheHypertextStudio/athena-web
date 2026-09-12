/**
 * `@docket/api` — the search query service's single entry point: `searchWorkspace`.
 *
 * @remarks
 * This module owns only top-level request orchestration: resolve the caller's access, route to
 * ranked search or browse, and assemble the `SearchOut` response. Everything else — the ranked
 * candidate scan, browse mode, visibility, scoring, collapsing duplicates, facets, cursors, result
 * assembly, and the read-only lookup helpers — lives in its own `query-*.ts` module; see each for
 * its own responsibility.
 */
import type { SearchOut } from '../contracts/search';
import { collapseActivityRows, applyPaletteDiversityCap } from './query-collapse';
import { decodeCursor, encodeCursor } from './query-cursor';
import { browseDocuments, type BrowseInput } from './query-browse';
import { scanRankedCandidates } from './query-ranked-scan';
import { toSearchResult, withSearchDisplays } from './query-results';
import { usedInForPage } from './query-lookups';
import { resolveCallerAccess } from './query-visibility';
import type { SearchAbortSignal, SearchCaller, SearchQueryParams } from './query-types';

export type { SearchCaller } from './query-types';
export {
  loadRecentDocuments,
  loadVisibleDocuments,
  type RecentDocumentsQuery,
  type VisibleDocumentsQuery,
} from './query-lookups';

interface SearchWorkspaceInput {
  scope: 'hub' | 'org';
  caller: SearchCaller;
  orgId?: string;
  activeOrgId?: string | null;
  /** Stops a full-corpus ranked scan when the HTTP caller abandons the request. */
  signal?: SearchAbortSignal | undefined;
  /** Fixed request clock for deterministic internal callers; cursors always take precedence. */
  rankedAt?: number | undefined;
  params: SearchQueryParams;
}

/**
 * Run permission-filtered semantic workspace search, or browse when no query is given.
 *
 * @remarks
 * Both modes share this one function on purpose. `filterVisibleRows` is the single most
 * dangerous thing in this module to duplicate — a second copy would be a cross-tenant leak that
 * nothing type-checks and that reads as correct in review — so browse reuses it as a call rather
 * than getting its own endpoint.
 */
export async function searchWorkspace(input: SearchWorkspaceInput): Promise<SearchOut> {
  const query = input.params.q?.trim() ?? '';
  const maxLimit = input.params.surface === 'palette' ? 50 : 100;
  const limit = Math.min(Math.max(input.params.limit ?? 20, 1), maxLimit);

  // An agent owns no documents, so it has no personal scope to widen the search with.
  const ownerUserId = input.caller.kind === 'user' ? input.caller.userId : null;
  const callerAccess = await resolveCallerAccess(input.caller);
  const callerAccessByOrg = new Map(callerAccess.map((access) => [access.organizationId, access]));
  const callerOrgIds = callerAccess.map((access) => access.organizationId);
  const requestedOrgIds = new Set(input.params.orgIds ?? []);
  const accessibleOrgIds =
    input.scope === 'org'
      ? input.orgId && callerOrgIds.includes(input.orgId)
        ? [input.orgId]
        : []
      : callerOrgIds.filter((orgId) => requestedOrgIds.size === 0 || requestedOrgIds.has(orgId));

  const fromTime = input.params.from ? new Date(input.params.from).getTime() : null;
  const toTime = input.params.to ? new Date(input.params.to).getTime() : null;

  if (query.length === 0) {
    return browseDocuments({
      params: input.params,
      caller: input.caller,
      limit,
      ownerUserId,
      orgIds: accessibleOrgIds,
      accessByOrg: callerAccessByOrg,
      fromTime,
      toTime,
    } satisfies BrowseInput);
  }

  const cursor = decodeCursor(input.params.cursor);
  const rankedAt = cursor?.rankedAt ?? input.rankedAt ?? Date.now();
  const { scored: candidates, facets } = await scanRankedCandidates({
    ownerUserId,
    orgIds: accessibleOrgIds,
    query,
    includeArchived: input.params.includeArchived ?? false,
    params: input.params,
    accessByOrg: callerAccessByOrg,
    activeOrgId: input.activeOrgId ?? null,
    fromTime,
    toTime,
    cursor,
    rankedAt,
    limit,
    signal: input.signal,
  });
  const scored = collapseActivityRows(candidates);

  const surfaced =
    input.params.surface === 'palette' && !cursor
      ? applyPaletteDiversityCap(scored, limit)
      : scored;
  const page = surfaced.slice(0, limit);
  // The cursor names the final row already returned. The next request keeps rows strictly after
  // it. Naming the first unreturned row would skip that row at every page boundary.
  const next = surfaced.length > limit ? page.at(-1) : undefined;
  const usedIn = await usedInForPage(page, input.caller);
  const items = await withSearchDisplays(
    page.map((row) => toSearchResult(row, usedIn.get(row.row.id) ?? [])),
  );
  return {
    query,
    items,
    facets,
    ...(next ? { nextCursor: encodeCursor(next, rankedAt) } : {}),
  };
}
