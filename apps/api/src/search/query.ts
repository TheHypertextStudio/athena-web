import {
  OrganizationId,
  type SearchDocumentKind,
  type SearchOut,
  type SearchUsedIn,
} from '@docket/types';
import type { searchDocument } from '@docket/db';
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import { markdownToPlainText } from '../content/markdown-links';
import { encodeListCursor, seekAfter } from '../lib/list-cursor';
import { resolveUsedIn, type UsedInTarget } from './used-in';
import {
  resourceAccessKey,
  resolveResourceAccess,
  type ResourceAccessRef,
  type ResourceAccessResult,
} from '../permissions/resource-access';

/**
 * Who is searching.
 *
 * @remarks
 * A human searches as a `user`, which reaches their own private documents and the activity they
 * are a recipient of, across every org they belong to. An `agent` searches as a single org-scoped
 * Actor: it has grants, but no personal document scope at all, so `user_private` rows and
 * recipient-only activity are invisible to it rather than matched against a stand-in id.
 */
export type SearchCaller =
  | { kind: 'user'; userId: string }
  | { kind: 'agent'; actorId: string; organizationId: string };

interface SearchWorkspaceInput {
  scope: 'hub' | 'org';
  caller: SearchCaller;
  orgId?: string;
  activeOrgId?: string | null;
  params: {
    /** Absent or blank selects browse mode: the same corpus, ordered by recency. */
    q?: string;
    limit?: number;
    cursor?: string;
    families?: readonly string[];
    kinds?: readonly string[];
    sources?: readonly string[];
    orgIds?: readonly string[];
    ownerIds?: readonly string[];
    assigneeIds?: readonly string[];
    labelIds?: readonly string[];
    ids?: readonly string[];
    statuses?: readonly string[];
    healths?: readonly string[];
    activeOrgId?: string;
    surface?: 'page' | 'palette';
    from?: string;
    to?: string;
    includeArchived?: boolean;
  };
}

interface ScoredRow {
  row: SearchDocumentRow;
  score: number;
  sortTime: number;
  matchedFields: SearchOut['items'][number]['matchedFields'];
  snippetMatch: SnippetMatch | null;
}

/**
 * Which raw field a snippet should be drawn from, and the exact substring that made it match.
 *
 * @remarks
 * Picking the field is a cheap `.includes()` check and runs for every scored candidate. Turning it
 * into reader-facing text (`snippetText`) is the expensive part — it strips Markdown — so it stays
 * deferred until a row has actually survived pagination; see {@link pickSnippetMatch}.
 */
interface SnippetMatch {
  readonly value: string;
  /** The matched substring, kept visible when `value` gets excerpted; `''` when nothing specific
   * matched and `value` is just a fallback to show something. */
  readonly term: string;
}

type SearchDocumentRow = Awaited<ReturnType<typeof loadCandidateRows>>[number];

interface CallerOrgAccess {
  organizationId: string;
  actorId: string;
  roleId: string | null;
  isGuest: boolean;
}

type SearchVisibility =
  | { mode: 'org_members' }
  | { mode: 'user_private' }
  | { mode: 'grantable'; subjectKind?: unknown; subjectId?: unknown }
  | { mode: 'event'; subjectKind?: unknown; subjectId?: unknown };

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
    });
  }

  const candidateRows = await loadCandidateRows({
    ownerUserId,
    orgIds: accessibleOrgIds,
    query,
    includeArchived: input.params.includeArchived ?? false,
  });
  const visible = await filterVisibleRows(candidateRows, {
    ownerUserId,
    accessByOrg: callerAccessByOrg,
  });

  const cursor = decodeCursor(input.params.cursor);
  const scored = visible.rows
    .filter((row) => filterRow(row, input.params, fromTime, toTime))
    .map((row) =>
      scoreRow(row, query, {
        activeOrgId: input.activeOrgId ?? null,
        ownerUserId,
        callerActorId: row.organizationId
          ? (callerAccessByOrg.get(row.organizationId)?.actorId ?? null)
          : null,
        activityRecipient: visible.recipientEventIds.has(row.entityId),
      }),
    )
    .filter((row): row is ScoredRow => row !== null)
    .sort(compareScoredRows)
    .filter((row) => (cursor ? compareCursor(row, cursor) > 0 : true));

  const surfaced =
    input.params.surface === 'palette' && !cursor
      ? applyPaletteDiversityCap(scored, limit)
      : scored;
  const page = surfaced.slice(0, limit);
  const next = surfaced[limit];
  const usedIn = await usedInForPage(page, input.caller);
  return {
    query,
    items: page.map((row) => toSearchResult(row, usedIn.get(row.row.id) ?? [])),
    facets: buildFacetSummaries(scored),
    ...(next ? { nextCursor: encodeCursor(next) } : {}),
  };
}

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

interface BrowseInput {
  params: SearchWorkspaceInput['params'];
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
async function browseDocuments(input: BrowseInput): Promise<SearchOut> {
  const collected: ScoredRow[] = [];
  const seen = new Set<string>();
  let cursor = input.params.cursor;
  let exhausted = false;

  // Over-fetch against the page size: both the visibility filter and the facet filters below run
  // in application code, so the database cannot know how many of these rows survive.
  const chunkSize = Math.min((input.limit + 1) * 4, 400);

  for (let round = 0; round < BROWSE_REFILL_ROUNDS && !exhausted; round += 1) {
    if (collected.length > input.limit) break;
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
  }

  const page = collected.slice(0, input.limit);
  const last = page[page.length - 1];
  const hasMore = collected.length > input.limit;
  const usedIn = await usedInForPage(page, input.caller);
  return {
    query: '',
    // These facets summarize the returned page, not the corpus. The Library's filter options come
    // from its field catalog, which reads members, teams, and labels directly, so no surface
    // depends on them being complete.
    facets: buildFacetSummaries(page),
    items: page.map((row) => toSearchResult(row, usedIn.get(row.row.id) ?? [])),
    ...(hasMore && last ? { nextCursor: encodeListCursor(last.row.updatedAt, last.row.id) } : {}),
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
  const fallback = row.summary ?? row.body;
  return {
    row,
    score: row.baseRank,
    sortTime: rowSortTime(row),
    matchedFields: [],
    snippetMatch: fallback === null || fallback === '' ? null : { value: fallback, term: '' },
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
  // A caller with no owning user (an agent) reaches org documents only. An empty candidate set is
  // the correct answer for an agent with no accessible orgs, not a reason to widen.
  const ownedByCaller = input.ownerUserId
    ? eq(schema.searchDocument.userId, input.ownerUserId)
    : undefined;
  const visibility =
    input.orgIds.length > 0
      ? or(inArray(schema.searchDocument.organizationId, [...input.orgIds]), ownedByCaller)
      : (ownedByCaller ?? sql`false`);
  const conditions = [
    visibility,
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
 * {@link searchWorkspace} can now answer this too — an absent `q` selects browse mode — so this is
 * a narrower, cheaper path rather than the only one: it takes an explicit kind list, skips facet
 * filtering, scoring, and container resolution, and returns in a single query. Prefer
 * `searchWorkspace` for anything that also needs filters or paging.
 *
 * It lives in this module, next to the query it complements, specifically so it reuses
 * `resolveCallerAccess` and `filterVisibleRows` as calls rather than as copies. A second
 * implementation of the visibility filter is the single most dangerous thing that could be written
 * against this read model: it would be a cross-tenant leak that no type checks and that looks
 * correct in review.
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
 * match on. Like {@link loadRecentDocuments} it lives here so it *calls* `filterVisibleRows` rather
 * than reimplementing it — a mention card is exactly the kind of surface where a second, subtly
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
 * Resolve the caller's per-org Actor rows, which carry the role every grant check reads from.
 *
 * @remarks
 * A user resolves to one active human Actor per org they belong to. An agent resolves to exactly
 * one Actor — its own — in exactly one org, so an agent's search can never reach beyond the
 * workspace it was created in.
 *
 * @param caller - The searching principal.
 * @returns one access record per org the caller can act in.
 */
async function resolveCallerAccess(caller: SearchCaller): Promise<CallerOrgAccess[]> {
  const schema = await import('@docket/db');
  const identity =
    caller.kind === 'user'
      ? and(eq(schema.actor.userId, caller.userId), eq(schema.actor.kind, 'human'))
      : and(
          eq(schema.actor.id, caller.actorId),
          eq(schema.actor.organizationId, caller.organizationId),
        );
  const rows = await schema.db
    .select({
      organizationId: schema.actor.organizationId,
      actorId: schema.actor.id,
      roleId: schema.actor.roleId,
      roleKey: schema.role.key,
      roleDefaultVisibility: schema.role.defaultVisibility,
    })
    .from(schema.actor)
    .leftJoin(
      schema.role,
      and(
        eq(schema.actor.roleId, schema.role.id),
        eq(schema.actor.organizationId, schema.role.organizationId),
      ),
    )
    .where(and(identity, eq(schema.actor.status, 'active')));
  return rows.map((row) => ({
    organizationId: row.organizationId,
    actorId: row.actorId,
    roleId: row.roleId,
    isGuest: row.roleKey === 'guest' || row.roleDefaultVisibility === 'private',
  }));
}

async function loadCandidateRows(input: {
  ownerUserId: string | null;
  orgIds: readonly string[];
  query: string;
  includeArchived: boolean;
}) {
  const schema = await import('@docket/db');
  const pattern = `%${input.query}%`;
  const textVector = searchTextVector(schema.searchDocument);
  const tsQuery = sql`plainto_tsquery('simple', ${input.query})`;
  const fullTextMatch = sql`${textVector} @@ ${tsQuery}`;
  // A caller with no owning user (an agent) reaches org documents only. Note an empty candidate
  // set is the correct answer for an agent with no accessible orgs, not a reason to widen.
  const ownedByCaller = input.ownerUserId
    ? eq(schema.searchDocument.userId, input.ownerUserId)
    : undefined;
  const visibility =
    input.orgIds.length > 0
      ? or(inArray(schema.searchDocument.organizationId, input.orgIds), ownedByCaller)
      : (ownedByCaller ?? sql`false`);
  const conditions = [
    visibility,
    or(
      fullTextMatch,
      ilike(schema.searchDocument.title, pattern),
      ilike(schema.searchDocument.summary, pattern),
      ilike(schema.searchDocument.body, pattern),
    ),
  ];
  if (!input.includeArchived) conditions.push(isNull(schema.searchDocument.archivedAt));
  const rows = await schema.db
    .select({
      document: schema.searchDocument,
      textRank: sql<number>`ts_rank_cd(${textVector}, ${tsQuery})`,
    })
    .from(schema.searchDocument)
    .where(and(...conditions))
    .orderBy(
      desc(sql`ts_rank_cd(${textVector}, ${tsQuery})`),
      desc(schema.searchDocument.baseRank),
      desc(schema.searchDocument.updatedAt),
    )
    .limit(500);
  return rows.map((row) => ({ ...row.document, textRank: row.textRank || 0 }));
}

function searchTextVector(table: typeof searchDocument) {
  return sql`(
    setweight(to_tsvector('simple', coalesce(${table.title}, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(${table.summary}, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(${table.body}, '')), 'C')
  )`;
}

async function filterVisibleRows(
  rows: readonly SearchDocumentRow[],
  caller: { ownerUserId: string | null; accessByOrg: ReadonlyMap<string, CallerOrgAccess> },
): Promise<{ rows: SearchDocumentRow[]; recipientEventIds: ReadonlySet<string> }> {
  const subjectRefs = new Map<string, ResourceAccessRef>();
  const eventIds: string[] = [];

  for (const row of rows) {
    const visibility = readVisibility(row.visibility);
    if (visibility.mode === 'event') eventIds.push(row.entityId);
    const subject = visibilitySubject(row, visibility);
    if (subject) subjectRefs.set(resourceAccessKey(subject), subject);
  }

  // Grant resolution needs a human user identity; an agent caller has no personal grants to
  // resolve here (it reaches grantable resources through `org_members` and its own actor scope).
  const subjectAccess: ReadonlyMap<string, ResourceAccessResult> = caller.ownerUserId
    ? await resolveResourceAccess(caller.ownerUserId, [...subjectRefs.values()])
    : new Map();
  // Recipient fan-out is per user; a caller with no owning user is a recipient of nothing.
  const recipientEventIds = caller.ownerUserId
    ? await loadRecipientEventIds(caller.ownerUserId, eventIds)
    : new Set<string>();

  const visibleRows = rows.filter((row) => {
    const visibility = readVisibility(row.visibility);
    switch (visibility.mode) {
      // Guard the null caller explicitly: a row with no owner must not match an ownerless
      // caller by both sides being nullish.
      case 'user_private':
        return caller.ownerUserId !== null && row.userId === caller.ownerUserId;
      case 'org_members':
        return Boolean(row.organizationId && caller.accessByOrg.has(row.organizationId));
      case 'grantable': {
        const subject = visibilitySubject(row, visibility);
        return subject ? (subjectAccess.get(resourceAccessKey(subject))?.canView ?? false) : false;
      }
      case 'event': {
        if (recipientEventIds.has(row.entityId)) return true;
        const subject = visibilitySubject(row, visibility);
        if (subject) return subjectAccess.get(resourceAccessKey(subject))?.canView ?? false;
        if (row.userId) return row.userId === caller.ownerUserId;
        return Boolean(row.organizationId && caller.accessByOrg.has(row.organizationId));
      }
    }
  });
  return { rows: visibleRows, recipientEventIds };
}

function readVisibility(value: unknown): SearchVisibility {
  if (typeof value === 'object' && value !== null && 'mode' in value) {
    const mode = (value as { mode?: unknown }).mode;
    if (
      mode === 'org_members' ||
      mode === 'user_private' ||
      mode === 'grantable' ||
      mode === 'event'
    ) {
      return value as SearchVisibility;
    }
  }
  return { mode: 'org_members' };
}

function visibilitySubject(
  row: SearchDocumentRow,
  visibility: SearchVisibility,
): ResourceAccessRef | null {
  if (!row.organizationId) return null;
  const subjectKind =
    visibility.mode === 'grantable' || visibility.mode === 'event'
      ? visibility.subjectKind
      : undefined;
  const subjectId =
    visibility.mode === 'grantable' || visibility.mode === 'event'
      ? visibility.subjectId
      : undefined;
  const kind = typeof subjectKind === 'string' ? subjectKind : row.subjectKind;
  const id = typeof subjectId === 'string' ? subjectId : row.subjectId;
  return kind && id ? { organizationId: row.organizationId, kind, id } : null;
}

async function loadRecipientEventIds(
  userId: string,
  eventIds: readonly string[],
): Promise<Set<string>> {
  const uniqueEventIds = [...new Set(eventIds)];
  if (uniqueEventIds.length === 0) return new Set();
  const schema = await import('@docket/db');
  const rows = await schema.db
    .select({ eventId: schema.eventRecipient.eventId })
    .from(schema.eventRecipient)
    .where(
      and(
        eq(schema.eventRecipient.userId, userId),
        inArray(schema.eventRecipient.eventId, uniqueEventIds),
      ),
    );
  return new Set(rows.map((row) => row.eventId));
}

function filterRow(
  row: SearchDocumentRow,
  params: SearchWorkspaceInput['params'],
  fromTime: number | null,
  toTime: number | null,
): boolean {
  if (params.families?.length && !params.families.includes(row.family)) return false;
  if (params.kinds?.length && !params.kinds.includes(row.kind)) return false;
  if (params.sources?.length && (!row.sourceSystem || !params.sources.includes(row.sourceSystem))) {
    return false;
  }
  const facet = facetRecord(row.facet);
  if (
    params.ownerIds?.length &&
    !facetMatchesAny(
      facet,
      ['ownerId', 'leadId', 'ownerActorId', 'accountableOwnerId'],
      params.ownerIds,
    )
  ) {
    return false;
  }
  if (
    params.assigneeIds?.length &&
    !facetMatchesAny(facet, ['assigneeId', 'delegateId'], params.assigneeIds)
  ) {
    return false;
  }
  if (
    params.labelIds?.length &&
    !facetMatchesAny(facet, ['labelId', 'labelIds'], params.labelIds)
  ) {
    return false;
  }
  if (params.statuses?.length && !facetMatchesAny(facet, ['status', 'state'], params.statuses)) {
    return false;
  }
  if (params.healths?.length && !facetMatchesAny(facet, ['health'], params.healths)) return false;
  const rowTime = rowSortTime(row);
  if (fromTime !== null && rowTime < fromTime) return false;
  if (toTime !== null && rowTime > toTime) return false;
  return true;
}

function scoreRow(
  row: SearchDocumentRow,
  query: string,
  context: {
    activeOrgId: string | null;
    ownerUserId: string | null;
    callerActorId: string | null;
    activityRecipient: boolean;
  },
): ScoredRow | null {
  const queryLower = query.toLowerCase();
  const terms = queryTerms(queryLower);
  const title = row.title.toLowerCase();
  const summary = row.summary?.toLowerCase() ?? '';
  const body = row.body?.toLowerCase() ?? '';
  const matchedFields: ScoredRow['matchedFields'] = [];
  let score = row.baseRank + row.textRank * 100;

  if (title === queryLower) {
    score += 90;
    matchedFields.push('title');
  } else if (title.startsWith(queryLower)) {
    score += 60;
    matchedFields.push('title');
  } else if (title.includes(queryLower)) {
    score += 40;
    matchedFields.push('title');
  }
  if (summary.includes(queryLower)) {
    score += 20;
    matchedFields.push('summary');
  }
  if (body.includes(queryLower)) {
    score += 10;
    matchedFields.push('body');
  }
  if (matchedFields.length === 0 && terms.length > 0) {
    if (containsAnyTerm(title, terms)) {
      score += 30;
      matchedFields.push('title');
    }
    if (containsAnyTerm(summary, terms)) {
      score += 15;
      matchedFields.push('summary');
    }
    if (containsAnyTerm(body, terms)) {
      score += 8;
      matchedFields.push('body');
    }
  }
  if (row.organizationId && row.organizationId === context.activeOrgId) score += 5;
  score += relationshipBoost(row, context);
  if (matchedFields.length === 0) return null;

  const sortTime = rowSortTime(row);
  score += recencyBoost(sortTime);
  return {
    row,
    score,
    sortTime,
    matchedFields: [...new Set(matchedFields)],
    snippetMatch: pickSnippetMatch(row, queryLower, terms),
  };
}

function relationshipBoost(
  row: SearchDocumentRow,
  context: { ownerUserId: string | null; callerActorId: string | null; activityRecipient: boolean },
): number {
  let boost = context.ownerUserId !== null && row.userId === context.ownerUserId ? 8 : 0;
  if (context.activityRecipient) boost += 10;
  if (!context.callerActorId) return boost;
  const facet = facetRecord(row.facet);
  if (
    facetMatchesAny(
      facet,
      ['ownerId', 'leadId', 'ownerActorId', 'accountableOwnerId', 'assigneeId', 'delegateId'],
      [context.callerActorId],
    )
  ) {
    boost += 12;
  }
  return boost;
}

function applyPaletteDiversityCap(rows: readonly ScoredRow[], limit: number): ScoredRow[] {
  const maxPerFamily = Math.max(3, Math.ceil(limit * 0.45));
  const familyCounts = new Map<string, number>();
  const selected: ScoredRow[] = [];
  const overflow: ScoredRow[] = [];

  for (const row of rows) {
    const count = familyCounts.get(row.row.family) ?? 0;
    if (selected.length < limit && count < maxPerFamily) {
      selected.push(row);
      familyCounts.set(row.row.family, count + 1);
    } else {
      overflow.push(row);
    }
  }

  const selectedIds = new Set(selected.map((row) => row.row.id));
  const filled = [...selected, ...overflow.filter((row) => !selectedIds.has(row.row.id))];
  return filled;
}

function queryTerms(queryLower: string): string[] {
  return queryLower
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function containsAnyTerm(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function recencyBoost(sortTime: number): number {
  const daysAgo = Math.max(0, (Date.now() - sortTime) / 86_400_000);
  return Math.max(0, 20 - Math.min(20, daysAgo));
}

function rowSortTime(row: SearchDocumentRow): number {
  return row.occurredAt?.getTime() ?? row.sourceUpdatedAt?.getTime() ?? row.updatedAt.getTime();
}

/**
 * Pick which raw field a snippet should be drawn from, and the exact substring that matched.
 *
 * @remarks
 * Cheap on purpose — only string `.includes()` checks, mirroring `scoreRow`'s own matching logic
 * exactly so the two never disagree about which field matched. This runs for every scored
 * candidate (up to hundreds, pre-pagination); the expensive part, flattening Markdown, is
 * {@link snippetText} and only runs for the page of rows actually returned — see
 * `toSearchResult`.
 */
function pickSnippetMatch(
  row: SearchDocumentRow,
  queryLower: string,
  terms: readonly string[],
): SnippetMatch | null {
  for (const value of [row.title, row.summary, row.body]) {
    if (value?.toLowerCase().includes(queryLower)) return { value, term: queryLower };
  }
  for (const term of terms) {
    for (const value of [row.title, row.summary, row.body]) {
      if (value?.toLowerCase().includes(term)) return { value, term };
    }
  }
  const fallback = row.summary ?? row.body;
  return fallback === null || fallback === '' ? null : { value: fallback, term: '' };
}

/** Raw-text context kept on each side of a match, wide enough that flattening it still reads as a sentence. */
const SNIPPET_CONTEXT_CHARS = 140;

/** Escape a string for literal use inside a `RegExp` pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A window of `value` centered on the match at `matchIndex`, wide enough for readable context. */
function windowAroundMatch(value: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT_CHARS);
  const end = Math.min(value.length, matchIndex + matchLength + SNIPPET_CONTEXT_CHARS);
  return value.slice(start, end);
}

/**
 * Render a matched field as reader-facing text: the title/summary verbatim, everything else
 * stripped of Markdown and windowed around the term that matched.
 *
 * @remarks
 * `title` and `summary` are already plain text by the time they reach here (`work.ts`'s projectors
 * flatten `summary` at write time), so returning them as-is both skips needless work and avoids
 * re-running the flattener on already-flat text — a second pass can strip a character a user
 * escaped on purpose (`\#` flattens to a literal `#` once; flattening that again reads it as a
 * real heading marker and strips it).
 *
 * `body` still carries the full raw Markdown, and a query can match deep inside it — windowing
 * around the actual match position (rather than always flattening from the start of the document)
 * is what keeps the returned snippet containing the term `matchedFields` says it matched on. When
 * the term only existed inside Markdown syntax the flattener removes (a link href, a fenced code
 * block), this falls back to the raw window itself so the snippet still shows what matched, rather
 * than silently showing unrelated text.
 */
function snippetText(row: SearchDocumentRow, match: SnippetMatch): string {
  const { value, term } = match;
  if (value === row.title || value === row.summary) return value;
  if (term === '') {
    const plain = markdownToPlainText(value);
    return plain === '' ? value : plain;
  }
  // A case-insensitive regex search runs against `value` itself, unlike
  // `value.toLowerCase().indexOf(term)` — some characters (e.g. Turkish "İ") lowercase to more
  // UTF-16 units than they started with, which offsets an index found in a lowercased copy from
  // its true position in the original string.
  const matchIndex = value.search(new RegExp(escapeRegExp(term), 'i'));
  const windowed = matchIndex === -1 ? value : windowAroundMatch(value, matchIndex, term.length);
  const plain = markdownToPlainText(windowed);
  if (plain.toLowerCase().includes(term)) return plain === '' ? value : plain;
  const raw = windowed.replace(/\s+/g, ' ').trim();
  return raw === '' ? value : raw;
}

/**
 * The kinds whose "used in" containers anyone actually renders.
 *
 * @remarks
 * Only the Library reads {@link SearchResult.usedIn}, and it lists artifacts. Resolving containers
 * for a page of tasks and projects would spend up to nine round trips per request — on every
 * palette keystroke — to produce a field nothing displays.
 */
const USED_IN_KINDS = new Set<SearchDocumentKind>(['external_resource', 'attachment']);

/**
 * Resolve the work containers for one page of results, batched per workspace.
 *
 * @remarks
 * Grouped by organization because Hub search spans several and `mention` rows never cross one, and
 * the groups run concurrently because they share no state — a page touching three workspaces costs
 * one round of latency, not three.
 */
async function usedInForPage(
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

function toSearchResult(
  scored: ScoredRow,
  usedIn: readonly SearchUsedIn[] = [],
): SearchOut['items'][number] {
  const row = scored.row;
  const organizationId = row.organizationId ? OrganizationId.parse(row.organizationId) : null;
  return {
    id: row.id,
    organizationId,
    userId: row.userId,
    kind: row.kind,
    family: row.family,
    title: row.title,
    summary: row.summary,
    snippet: scored.snippetMatch ? snippetText(row, scored.snippetMatch) : null,
    matchedFields: scored.matchedFields,
    route: row.route as SearchOut['items'][number]['route'],
    subject:
      row.subjectKind && row.subjectId
        ? {
            kind: normalizeSearchKind(row.subjectKind),
            id: row.subjectId,
            title: null,
            organizationId,
          }
        : null,
    source: row.sourceSystem
      ? {
          system: row.sourceSystem,
          externalUrl: row.externalUrl,
          eventId: row.kind === 'activity' ? row.entityId : null,
        }
      : null,
    facets: row.facet,
    actions: actionFor(row),
    score: scored.score,
    entityId: row.entityId,
    externalUrl: row.externalUrl,
    // Copied because the DTO's inferred array type is mutable; the resolver hands back a readonly.
    usedIn: [...usedIn],
    updatedAt: (row.sourceUpdatedAt ?? row.updatedAt).toISOString(),
  };
}

function normalizeSearchKind(kind: string): SearchDocumentKind {
  const allowed = new Set([
    'organization',
    'team',
    'member',
    'agent',
    'agent_session',
    'task',
    'project',
    'program',
    'initiative',
    'milestone',
    'cycle',
    'label',
    'saved_view',
    'comment',
    'update',
    'attachment',
    'calendar_event',
    'activity',
    'external_resource',
  ]);
  return (allowed.has(kind) ? kind : 'activity') as SearchDocumentKind;
}

function actionFor(row: SearchDocumentRow): SearchOut['items'][number]['actions'] {
  const href = typeof row.route['href'] === 'string' ? row.route['href'] : undefined;
  const actions = href ? [{ kind: 'open', label: 'Open', href }] : [];
  if (row.externalUrl) {
    actions.push({ kind: 'open_external', label: 'Open source', href: row.externalUrl });
  }
  return actions;
}

function buildFacetSummaries(rows: readonly ScoredRow[]): SearchOut['facets'] {
  const familyCounts = new Map<string, number>();
  const kindCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const ownerCounts = new Map<string, number>();
  const assigneeCounts = new Map<string, number>();
  const labelCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  const healthCounts = new Map<string, number>();
  for (const { row } of rows) {
    familyCounts.set(row.family, (familyCounts.get(row.family) ?? 0) + 1);
    kindCounts.set(row.kind, (kindCounts.get(row.kind) ?? 0) + 1);
    if (row.sourceSystem)
      sourceCounts.set(row.sourceSystem, (sourceCounts.get(row.sourceSystem) ?? 0) + 1);
    const facet = facetRecord(row.facet);
    addFacetValues(ownerCounts, facet, ['ownerId', 'leadId', 'ownerActorId', 'accountableOwnerId']);
    addFacetValues(assigneeCounts, facet, ['assigneeId', 'delegateId']);
    addFacetValues(labelCounts, facet, ['labelId', 'labelIds']);
    addFacetValues(statusCounts, facet, ['status', 'state']);
    addFacetValues(healthCounts, facet, ['health']);
  }
  return [
    facetSummary('family', 'Family', familyCounts),
    facetSummary('kind', 'Kind', kindCounts),
    facetSummary('source', 'Source', sourceCounts),
    facetSummary('owner', 'Owner', ownerCounts),
    facetSummary('assignee', 'Assignee', assigneeCounts),
    facetSummary('label', 'Label', labelCounts),
    facetSummary('status', 'Status', statusCounts),
    facetSummary('health', 'Health', healthCounts),
  ].filter((facet) => facet.values.length > 0);
}

function facetRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function facetMatchesAny(
  facet: Record<string, unknown>,
  keys: readonly string[],
  expected: readonly string[],
): boolean {
  return keys.some((key) => valueMatchesAny(facet[key], expected));
}

function valueMatchesAny(value: unknown, expected: readonly string[]): boolean {
  if (typeof value === 'string') return expected.includes(value);
  if (Array.isArray(value))
    return value.some((item) => typeof item === 'string' && expected.includes(item));
  return false;
}

function addFacetValues(
  counts: Map<string, number>,
  facet: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const value = facet[key];
    if (typeof value === 'string') counts.set(value, (counts.get(value) ?? 0) + 1);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') counts.set(item, (counts.get(item) ?? 0) + 1);
      }
    }
  }
}

function facetSummary(
  field: string,
  label: string,
  counts: Map<string, number>,
): SearchOut['facets'][number] {
  return {
    field,
    label,
    values: [...counts.entries()].map(([value, count]) => ({ value, label: value, count })),
  };
}

interface CursorShape {
  score: number;
  sortTime: number;
  id: string;
}

function compareScoredRows(a: ScoredRow, b: ScoredRow): number {
  return b.score - a.score || b.sortTime - a.sortTime || a.row.id.localeCompare(b.row.id);
}

function compareCursor(row: ScoredRow, cursor: CursorShape): number {
  if (row.score !== cursor.score) return cursor.score - row.score;
  if (row.sortTime !== cursor.sortTime) return cursor.sortTime - row.sortTime;
  return row.row.id.localeCompare(cursor.id);
}

function encodeCursor(row: ScoredRow): string {
  return Buffer.from(
    JSON.stringify({
      score: row.score,
      sortTime: row.sortTime,
      id: row.row.id,
    } satisfies CursorShape),
  ).toString('base64url');
}

function decodeCursor(value: string | undefined): CursorShape | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorShape;
    if (
      typeof parsed.score === 'number' &&
      typeof parsed.sortTime === 'number' &&
      typeof parsed.id === 'string'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}
