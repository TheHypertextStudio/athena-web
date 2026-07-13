import { OrganizationId, type SearchDocumentKind, type SearchOut } from '@docket/types';
import type { searchDocument } from '@docket/db';
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import {
  resourceAccessKey,
  resolveResourceAccess,
  type ResourceAccessRef,
} from '../permissions/resource-access';

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
    ownerIds?: readonly string[];
    assigneeIds?: readonly string[];
    labelIds?: readonly string[];
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
  snippet: string | null;
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

/** Run permission-filtered semantic workspace search. */
export async function searchWorkspace(input: SearchWorkspaceInput): Promise<SearchOut> {
  const query = input.params.q.trim();
  const maxLimit = input.params.surface === 'palette' ? 50 : 100;
  const limit = Math.min(Math.max(input.params.limit ?? 20, 1), maxLimit);
  if (query.length === 0) return { query, items: [], facets: [] };

  const callerAccess = await resolveCallerOrgAccess(input.userId);
  const callerAccessByOrg = new Map(callerAccess.map((access) => [access.organizationId, access]));
  const callerOrgIds = callerAccess.map((access) => access.organizationId);
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
  const visible = await filterVisibleRows(candidateRows, {
    userId: input.userId,
    accessByOrg: callerAccessByOrg,
  });

  const fromTime = input.params.from ? new Date(input.params.from).getTime() : null;
  const toTime = input.params.to ? new Date(input.params.to).getTime() : null;
  const cursor = decodeCursor(input.params.cursor);
  const scored = visible.rows
    .filter((row) => filterRow(row, input.params, fromTime, toTime))
    .map((row) =>
      scoreRow(row, query, {
        activeOrgId: input.activeOrgId ?? null,
        userId: input.userId,
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
  return {
    query,
    items: page.map(toSearchResult),
    facets: buildFacetSummaries(scored),
    ...(next ? { nextCursor: encodeCursor(next) } : {}),
  };
}

async function resolveCallerOrgAccess(userId: string): Promise<CallerOrgAccess[]> {
  const schema = await import('@docket/db');
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
    .where(
      and(
        eq(schema.actor.userId, userId),
        eq(schema.actor.kind, 'human'),
        eq(schema.actor.status, 'active'),
      ),
    );
  return rows.map((row) => ({
    organizationId: row.organizationId,
    actorId: row.actorId,
    roleId: row.roleId,
    isGuest: row.roleKey === 'guest' || row.roleDefaultVisibility === 'private',
  }));
}

async function loadCandidateRows(input: {
  userId: string;
  orgIds: readonly string[];
  query: string;
  includeArchived: boolean;
}) {
  const schema = await import('@docket/db');
  const pattern = `%${input.query}%`;
  const textVector = searchTextVector(schema.searchDocument);
  const tsQuery = sql`plainto_tsquery('simple', ${input.query})`;
  const fullTextMatch = sql`${textVector} @@ ${tsQuery}`;
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
  caller: { userId: string; accessByOrg: ReadonlyMap<string, CallerOrgAccess> },
): Promise<{ rows: SearchDocumentRow[]; recipientEventIds: ReadonlySet<string> }> {
  const subjectRefs = new Map<string, ResourceAccessRef>();
  const eventIds: string[] = [];

  for (const row of rows) {
    const visibility = readVisibility(row.visibility);
    if (visibility.mode === 'event') eventIds.push(row.entityId);
    const subject = visibilitySubject(row, visibility);
    if (subject) subjectRefs.set(resourceAccessKey(subject), subject);
  }

  const subjectAccess = await resolveResourceAccess(caller.userId, [...subjectRefs.values()]);
  const recipientEventIds = await loadRecipientEventIds(caller.userId, eventIds);

  const visibleRows = rows.filter((row) => {
    const visibility = readVisibility(row.visibility);
    switch (visibility.mode) {
      case 'user_private':
        return row.userId === caller.userId;
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
        if (row.userId) return row.userId === caller.userId;
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
    userId: string;
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
    snippet: snippetFor(row, queryLower, terms),
  };
}

function relationshipBoost(
  row: SearchDocumentRow,
  context: { userId: string; callerActorId: string | null; activityRecipient: boolean },
): number {
  let boost = row.userId === context.userId ? 8 : 0;
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

function snippetFor(
  row: SearchDocumentRow,
  queryLower: string,
  terms: readonly string[],
): string | null {
  for (const value of [row.title, row.summary, row.body]) {
    if (value?.toLowerCase().includes(queryLower)) return value;
  }
  for (const term of terms) {
    for (const value of [row.title, row.summary, row.body]) {
      if (value?.toLowerCase().includes(term)) return value;
    }
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
