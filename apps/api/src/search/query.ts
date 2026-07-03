import { OrganizationId, type SearchDocumentKind, type SearchOut } from '@docket/types';
import { and, eq, ilike, inArray, isNull, or } from 'drizzle-orm';

interface SearchWorkspaceInput {
  scope: 'hub' | 'org';
  userId: string;
  orgId?: string;
  activeOrgId?: string | null;
  params: {
    q: string;
    limit?: number;
    cursor?: string;
    families?: readonly string[];
    kinds?: readonly string[];
    sources?: readonly string[];
    orgIds?: readonly string[];
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
  snippet: string | null;
}

type SearchDocumentRow = Awaited<ReturnType<typeof loadCandidateRows>>[number];

/** Run permission-filtered semantic workspace search. */
export async function searchWorkspace(input: SearchWorkspaceInput): Promise<SearchOut> {
  const query = input.params.q.trim();
  const limit = Math.min(Math.max(input.params.limit ?? 20, 1), 100);
  if (query.length === 0) return { query, items: [], facets: [] };

  const callerOrgIds = await resolveCallerOrgIds(input.userId);
  const requestedOrgIds = new Set(input.params.orgIds ?? []);
  const accessibleOrgIds =
    input.scope === 'org'
      ? input.orgId && callerOrgIds.includes(input.orgId)
        ? [input.orgId]
        : []
      : callerOrgIds.filter((orgId) => requestedOrgIds.size === 0 || requestedOrgIds.has(orgId));

  const candidateRows = await loadCandidateRows({
    userId: input.userId,
    orgIds: accessibleOrgIds,
    query,
    includeArchived: input.params.includeArchived ?? false,
  });

  const fromTime = input.params.from ? new Date(input.params.from).getTime() : null;
  const toTime = input.params.to ? new Date(input.params.to).getTime() : null;
  const cursor = decodeCursor(input.params.cursor);
  const scored = candidateRows
    .filter((row) => filterRow(row, input.params, fromTime, toTime))
    .map((row) => scoreRow(row, query, input.activeOrgId ?? null))
    .filter((row): row is ScoredRow => row !== null)
    .sort(compareScoredRows)
    .filter((row) => (cursor ? compareCursor(row, cursor) > 0 : true));

  const page = scored.slice(0, limit);
  const next = scored[limit];
  return {
    query,
    items: page.map(toSearchResult),
    facets: buildFacetSummaries(scored),
    ...(next ? { nextCursor: encodeCursor(next) } : {}),
  };
}

async function resolveCallerOrgIds(userId: string): Promise<string[]> {
  const schema = await import('@docket/db');
  const rows = await schema.db
    .select({ organizationId: schema.actor.organizationId })
    .from(schema.actor)
    .where(
      and(
        eq(schema.actor.userId, userId),
        eq(schema.actor.kind, 'human'),
        eq(schema.actor.status, 'active'),
      ),
    );
  return [...new Set(rows.map((row) => row.organizationId))];
}

async function loadCandidateRows(input: {
  userId: string;
  orgIds: readonly string[];
  query: string;
  includeArchived: boolean;
}) {
  const schema = await import('@docket/db');
  const pattern = `%${input.query}%`;
  const visibility =
    input.orgIds.length > 0
      ? or(
          inArray(schema.searchDocument.organizationId, input.orgIds),
          eq(schema.searchDocument.userId, input.userId),
        )
      : eq(schema.searchDocument.userId, input.userId);
  const conditions = [
    visibility,
    or(
      ilike(schema.searchDocument.title, pattern),
      ilike(schema.searchDocument.summary, pattern),
      ilike(schema.searchDocument.body, pattern),
    ),
  ];
  if (!input.includeArchived) conditions.push(isNull(schema.searchDocument.archivedAt));
  return schema.db
    .select()
    .from(schema.searchDocument)
    .where(and(...conditions))
    .limit(500);
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
  const rowTime = rowSortTime(row);
  if (fromTime !== null && rowTime < fromTime) return false;
  if (toTime !== null && rowTime > toTime) return false;
  return true;
}

function scoreRow(
  row: SearchDocumentRow,
  query: string,
  activeOrgId: string | null,
): ScoredRow | null {
  const queryLower = query.toLowerCase();
  const title = row.title.toLowerCase();
  const summary = row.summary?.toLowerCase() ?? '';
  const body = row.body?.toLowerCase() ?? '';
  const matchedFields: ScoredRow['matchedFields'] = [];
  let score = row.baseRank;

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
  if (row.organizationId && row.organizationId === activeOrgId) score += 5;
  if (matchedFields.length === 0) return null;

  const sortTime = rowSortTime(row);
  score += recencyBoost(sortTime);
  return {
    row,
    score,
    sortTime,
    matchedFields: [...new Set(matchedFields)],
    snippet: snippetFor(row, queryLower),
  };
}

function recencyBoost(sortTime: number): number {
  const daysAgo = Math.max(0, (Date.now() - sortTime) / 86_400_000);
  return Math.max(0, 20 - Math.min(20, daysAgo));
}

function rowSortTime(row: SearchDocumentRow): number {
  return row.occurredAt?.getTime() ?? row.sourceUpdatedAt?.getTime() ?? row.updatedAt.getTime();
}

function snippetFor(row: SearchDocumentRow, queryLower: string): string | null {
  for (const value of [row.title, row.summary, row.body]) {
    if (value?.toLowerCase().includes(queryLower)) return value;
  }
  return row.summary ?? row.body ?? null;
}

function toSearchResult(scored: ScoredRow): SearchOut['items'][number] {
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
    snippet: scored.snippet,
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
  for (const { row } of rows) {
    familyCounts.set(row.family, (familyCounts.get(row.family) ?? 0) + 1);
    kindCounts.set(row.kind, (kindCounts.get(row.kind) ?? 0) + 1);
    if (row.sourceSystem)
      sourceCounts.set(row.sourceSystem, (sourceCounts.get(row.sourceSystem) ?? 0) + 1);
  }
  return [
    facetSummary('family', 'Family', familyCounts),
    facetSummary('kind', 'Kind', kindCounts),
    facetSummary('source', 'Source', sourceCounts),
  ].filter((facet) => facet.values.length > 0);
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
