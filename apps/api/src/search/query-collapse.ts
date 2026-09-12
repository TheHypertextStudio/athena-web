/**
 * `@docket/api` — duplicate-suppression and family diversity for one page of search results.
 */
import type { SearchDocumentKind } from '../contracts/search';
import type { ScoredRow } from './query-types';

/**
 * Search document kinds indexed without an `organizationId` — a private, user-scoped document (a
 * personal calendar event) rather than a workspace's own record.
 *
 * @remarks
 * An `activity` row about one of these still carries a real `organizationId` (the event itself
 * happened in an org, even though the calendar entry it names didn't), so {@link
 * collapseActivityRows} needs to know which subject kinds to match without one rather than
 * inferring it from whether any single candidate row happens to carry a null org — that would
 * either miss the match (nothing in the current page has a null-org row for that subject to infer
 * from) or, in principle, match the wrong row (an unrelated org-less document that happens to share
 * a kind and id with the real subject). A `Record`, not a `Set`, so adding a new
 * {@link SearchDocumentKind} forces this to be revisited — the same enforcement `rank.ts`'s
 * `BASE_RANK` already uses for a per-kind fact of the same shape.
 */
const ORG_LESS_SEARCH_KINDS: Record<SearchDocumentKind, boolean> = {
  organization: false,
  team: false,
  member: false,
  agent: false,
  agent_session: false,
  task: false,
  project: false,
  program: false,
  initiative: false,
  milestone: false,
  cycle: false,
  label: false,
  saved_view: false,
  comment: false,
  update: false,
  attachment: false,
  calendar_event: true,
  activity: false,
  external_resource: false,
};

/**
 * Whether `kind` is one of {@link ORG_LESS_SEARCH_KINDS}.
 *
 * @remarks
 * Takes a raw `string` rather than `SearchDocumentKind` on purpose: `subjectKind` is an
 * unconstrained `text` column, not a DB enum, so an unrecognized value must fall through to
 * `false` (org-qualified — the safe default) rather than be coerced into a real kind first. Coercing
 * it (e.g. via `normalizeSearchKind`, which defaults anything unrecognized to `'activity'`) would
 * fold a malformed `subjectKind` into the same key namespace real `activity` rows use for their own
 * identity, creating a false-collapse collision that a merely-unrecognized opaque string cannot
 * produce on its own.
 */
function isOrgLessSearchKind(kind: string): boolean {
  return (
    Object.hasOwn(ORG_LESS_SEARCH_KINDS, kind) && ORG_LESS_SEARCH_KINDS[kind as SearchDocumentKind]
  );
}

/** The identity key {@link collapseActivityRows} groups rows by, org-qualified unless `kind` is
 * one of {@link ORG_LESS_SEARCH_KINDS}. */
function activityCollapseKey(organizationId: string | null, kind: string, id: string): string {
  return isOrgLessSearchKind(kind) ? `${kind}:${id}` : `${organizationId}:${kind}:${id}`;
}

/**
 * Collapse per-event `activity` rows into their subject when that subject is already a result.
 *
 * @remarks
 * Every domain event (a project renamed, a status changed) is indexed as its own `activity`
 * search document, and many event producers set the event's own title to the subject's own title
 * as a matter of course, not only as a fallback (see the task/project creation, assignment, and
 * field-change producers in `event-emit.ts`). A project that already matches a query therefore
 * often also surfaces every activity row about it, several of them showing the exact same title as
 * the project — the same entity, several times over, with nothing to tell the rows apart. `rows`
 * is already sorted by {@link compareScoredRows} for the ranked-search caller, so keeping the
 * first activity row seen per subject keeps the best-scored one there; `browseDocuments`'s
 * caller instead orders `rows` by recency, so there "first seen" means most-recently-touched
 * rather than best-scored — either way, `.filter()` must visit `rows` in that order for the
 * per-subject dedup below to hold.
 *
 * Known limitation: `rows` is whatever the caller already retained under its own page/candidate
 * cap, so collapsing duplicates here cannot backfill with other distinct candidates that cap
 * evicted earlier — a page can come back short, and (for the ranked-search caller) `facets`
 * (computed from the uncapped, uncollapsed scan) can overcount relative to `items`. A subject
 * already shown on an earlier page is also invisible to a later page's collapse, since this
 * function has no memory across calls. Fixing any of that needs a refill loop that reruns the
 * collapse as it scans, not a change to this function.
 *
 * @param rows - Scored candidates for one search response, in the order described above.
 * @returns `rows` with redundant activity rows removed.
 */
export function collapseActivityRows(rows: readonly ScoredRow[]): ScoredRow[] {
  const hasOwnRow = new Set<string>();
  for (const { row } of rows) {
    hasOwnRow.add(activityCollapseKey(row.organizationId, row.kind, row.entityId));
  }
  const keptSubjects = new Set<string>();
  return rows.filter((scored) => {
    const { row } = scored;
    if (row.kind !== 'activity') return true;
    if (!row.subjectKind || !row.subjectId) return true;
    const subjectKey = activityCollapseKey(row.organizationId, row.subjectKind, row.subjectId);
    if (hasOwnRow.has(subjectKey)) return false;
    if (keptSubjects.has(subjectKey)) return false;
    keptSubjects.add(subjectKey);
    return true;
  });
}

/** Cap how many of one family's rows can fill the palette's first page, so a single dominant
 * family (e.g. tasks) can't crowd out every other kind of match. */
export function applyPaletteDiversityCap(rows: readonly ScoredRow[], limit: number): ScoredRow[] {
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
