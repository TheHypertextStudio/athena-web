/**
 * `@docket/api` — permission-aware lookup helpers used outside the main ranked-search/browse
 * request path: the mention picker's recents list, entity hydration by id, and "used in" container
 * resolution for a page of results.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { SearchDocumentKind, SearchOut, SearchUsedIn } from '../contracts/search';
import { resolveUsedIn, type UsedInTarget } from './used-in';
import { filterVisibleRows, resolveCallerAccess } from './query-visibility';
import { rowSortTime } from './query-filters';
import { toSearchResult } from './query-results';
import type { ScoredRow, SearchCaller, SearchDocumentRow } from './query-types';

/** What {@link loadRecentDocuments} needs to answer a bare-`@` picker. */
export interface RecentDocumentsQuery {
  /** Whose permissions the results are filtered against. */
  readonly caller: SearchCaller;
  /** The workspace to look in. */
  readonly orgId: string;
  /** Which document kinds are worth offering. */
  readonly kinds: readonly SearchDocumentKind[];
  /** How many rows to return after filtering. */
  readonly limit: number;
}

/** What {@link loadVisibleDocuments} needs to resolve known ids. */
export interface VisibleDocumentsQuery {
  /** Whose permissions decide which of the ids resolve. */
  readonly caller: SearchCaller;
  /** The workspace the ids belong to. */
  readonly orgId: string;
  /** The entity ids to resolve. */
  readonly entityIds: readonly string[];
}

/**
 * Load the caller's most recently touched documents in one org, with no query.
 *
 * @remarks
 * Serves the bare-`@` state of the mention picker, where there is nothing to match on yet but a
 * useful list is still expected instantly.
 *
 * `searchWorkspace` can now answer this too — an absent `q` selects browse mode — so this is
 * a narrower, cheaper path rather than the only one: it takes an explicit kind list, skips facet
 * filtering, scoring, and container resolution, and returns in a single query. Prefer
 * `searchWorkspace` for anything that also needs filters or paging.
 *
 * It calls `resolveCallerAccess` and `filterVisibleRows` rather than reimplementing them — a
 * second implementation of the visibility filter is the single most dangerous thing that could be
 * written against this read model: it would be a cross-tenant leak that no type checks and that
 * looks correct in review.
 *
 * @param input - The caller, the org, the kinds worth offering, and how many to return.
 * @returns Visible documents, most recently updated first.
 */
export async function loadRecentDocuments(
  input: RecentDocumentsQuery,
): Promise<SearchOut['items']> {
  const schema = await import('@docket/db');
  const callerAccess = await resolveCallerAccess(input.caller);
  const callerAccessByOrg = new Map(callerAccess.map((access) => [access.organizationId, access]));
  if (!callerAccessByOrg.has(input.orgId)) return [];

  const ownerUserId = input.caller.kind === 'user' ? input.caller.userId : null;
  // Over-fetch, because visibility filtering happens in app code after the query and can remove
  // an arbitrary share of the page. Three times the ask is enough for realistic grant density.
  const rows = await schema.db
    .select({ document: schema.searchDocument })
    .from(schema.searchDocument)
    .where(
      and(
        eq(schema.searchDocument.organizationId, input.orgId),
        inArray(schema.searchDocument.kind, [...input.kinds]),
        isNull(schema.searchDocument.archivedAt),
      ),
    )
    .orderBy(desc(schema.searchDocument.sourceUpdatedAt), desc(schema.searchDocument.baseRank))
    .limit(Math.min(input.limit * 3, 150));

  const candidates = rows.map((row) => ({ ...row.document, textRank: 0 }));
  const visible = await filterVisibleRows(candidates, {
    ownerUserId,
    accessByOrg: callerAccessByOrg,
  });
  return visible.rows.slice(0, input.limit).map((row) =>
    toSearchResult({
      row,
      score: 0,
      sortTime: rowSortTime(row),
      matchedFields: [],
      snippetMatch: null,
    }),
  );
}

/**
 * Load specific documents by entity id, keeping only the ones this caller may see.
 *
 * @remarks
 * The read path behind mention hydration, where the ids are already known and there is nothing to
 * match on. Like {@link loadRecentDocuments} it *calls* `filterVisibleRows` rather than
 * reimplementing it — a mention card is exactly the kind of surface where a second, subtly
 * different permission check would leak a title to someone who cannot open the thing it names.
 *
 * Absence is indistinguishable from denial by design: a caller who may not see a row gets the same
 * empty result as one asking about an id that does not exist, so this cannot be used to probe for
 * the existence of ids.
 *
 * @param input - The caller, the org to look in, and the entity ids to resolve.
 * @returns The visible documents; ids that are missing or forbidden are simply absent.
 */
export async function loadVisibleDocuments(
  input: VisibleDocumentsQuery,
): Promise<SearchDocumentRow[]> {
  if (input.entityIds.length === 0) return [];
  const schema = await import('@docket/db');
  const callerAccess = await resolveCallerAccess(input.caller);
  const callerAccessByOrg = new Map(callerAccess.map((access) => [access.organizationId, access]));
  if (!callerAccessByOrg.has(input.orgId)) return [];

  const rows = await schema.db
    .select({ document: schema.searchDocument })
    .from(schema.searchDocument)
    .where(
      and(
        eq(schema.searchDocument.organizationId, input.orgId),
        inArray(schema.searchDocument.entityId, [...input.entityIds]),
      ),
    );

  const visible = await filterVisibleRows(
    rows.map((row) => ({ ...row.document, textRank: 0 })),
    {
      ownerUserId: input.caller.kind === 'user' ? input.caller.userId : null,
      accessByOrg: callerAccessByOrg,
    },
  );
  return visible.rows;
}

/**
 * The kinds whose "used in" containers anyone actually renders.
 *
 * @remarks
 * Only the Library reads `SearchResult.usedIn`, and it lists artifacts. Resolving containers
 * for a page of tasks and projects would spend up to nine round trips per request — on every
 * palette keystroke — to produce a field nothing displays.
 */
const USED_IN_KINDS = new Set<SearchDocumentKind>(['external_resource', 'attachment']);

/**
 * The visibility gate handed to {@link resolveUsedIn}.
 *
 * @remarks
 * Wraps {@link loadVisibleDocuments} so the "used in" resolver filters through the same permission
 * check every other read here uses, rather than a second copy of it. Ids with no search document
 * are absent from the result and therefore treated as not visible, which is the safe direction.
 */
function visibleEntityIds(caller: SearchCaller) {
  return async (
    organizationId: string,
    entityIds: readonly string[],
  ): Promise<ReadonlySet<string>> => {
    const documents = await loadVisibleDocuments({ caller, orgId: organizationId, entityIds });
    return new Set(documents.map((document) => document.entityId));
  };
}

/**
 * Resolve the work containers for one page of results, batched per workspace.
 *
 * @remarks
 * Grouped by organization because Hub search spans several and `mention` rows never cross one, and
 * the groups run concurrently because they share no state — a page touching three workspaces costs
 * one round of latency, not three.
 */
export async function usedInForPage(
  page: readonly ScoredRow[],
  caller: SearchCaller,
): Promise<ReadonlyMap<string, readonly SearchUsedIn[]>> {
  const byOrg = new Map<string, UsedInTarget[]>();
  for (const scored of page) {
    const organizationId = scored.row.organizationId;
    if (!organizationId) continue;
    if (!USED_IN_KINDS.has(scored.row.kind)) continue;
    const targets = byOrg.get(organizationId) ?? [];
    targets.push({
      documentId: scored.row.id,
      kind: scored.row.kind,
      entityId: scored.row.entityId,
    });
    byOrg.set(organizationId, targets);
  }
  if (byOrg.size === 0) return new Map();
  const perOrg = await Promise.all(
    [...byOrg].map(([organizationId, targets]) =>
      resolveUsedIn(organizationId, targets, visibleEntityIds(caller)),
    ),
  );
  const merged = new Map<string, readonly SearchUsedIn[]>();
  for (const resolved of perOrg) {
    for (const [documentId, containers] of resolved) merged.set(documentId, containers);
  }
  return merged;
}
