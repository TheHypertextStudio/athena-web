/**
 * `@docket/api` — mapping one scored search row into the `SearchResult` DTO the API returns.
 */
import { type EntityDisplaySubjectType } from '@docket/work/entity-display-contract';
import { OrganizationId } from '@docket/identity-access/ids';
import { and, eq, or } from 'drizzle-orm';

import type { SearchDocumentKind, SearchOut, SearchUsedIn } from '../contracts/search';
import { storedEntityDisplayOut } from '../lib/entity-display-output';
import { facetRecord } from './query-filters';
import { snippetText } from './query-scoring';
import type { ScoredRow, SearchDocumentRow } from './query-types';

/** Coerce an untrusted `subjectKind` string to a known `SearchDocumentKind`, defaulting to
 * `'activity'` when it isn't one of the recognized values. */
export function normalizeSearchKind(kind: string): SearchDocumentKind {
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

/** The clickable actions a result row offers: opening it, downloading an attachment, or opening
 * its external source. */
export function actionFor(row: SearchDocumentRow): SearchOut['items'][number]['actions'] {
  const href = typeof row.route['href'] === 'string' ? row.route['href'] : undefined;
  const actions = href ? [{ kind: 'open', label: 'Open', href }] : [];
  const facet = facetRecord(row.facet);
  if (
    row.kind === 'attachment' &&
    facet['attachmentKind'] === 'file' &&
    row.organizationId &&
    row.subjectKind === 'task' &&
    row.subjectId
  ) {
    actions.push({
      kind: 'download',
      label: 'Download',
      href: `/v1/orgs/${row.organizationId}/tasks/${row.subjectId}/attachments/${row.entityId}/download`,
    });
  }
  if (row.externalUrl) {
    actions.push({ kind: 'open_external', label: 'Open source', href: row.externalUrl });
  }
  return actions;
}

/** Map one scored, permission-filtered row into the `SearchResult` DTO the API returns. */
export function toSearchResult(
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
    display: null,
    // Copied because the DTO's inferred array type is mutable; the resolver hands back a readonly.
    usedIn: [...usedIn],
    updatedAt: (row.sourceUpdatedAt ?? row.updatedAt).toISOString(),
  };
}

/** Native search kinds that have a user-owned decorative display record. */
function displaySubjectTypeForSearchKind(
  kind: SearchDocumentKind,
): EntityDisplaySubjectType | null {
  switch (kind) {
    case 'team':
    case 'task':
    case 'project':
    case 'program':
    case 'initiative':
    case 'milestone':
    case 'cycle':
    case 'label':
      return kind;
    default:
      return null;
  }
}

/** Compose custom display only after search visibility has produced the page. */
export async function withSearchDisplays(items: SearchOut['items']): Promise<SearchOut['items']> {
  const candidates = items.flatMap((item) => {
    const subjectType = displaySubjectTypeForSearchKind(item.kind);
    return item.organizationId && subjectType
      ? [{ organizationId: item.organizationId, subjectType, subjectId: item.entityId }]
      : [];
  });
  if (candidates.length === 0) return items;

  const { db, entityDisplay } = await import('@docket/db');
  const conditions = candidates.map((candidate) =>
    and(
      eq(entityDisplay.organizationId, candidate.organizationId),
      eq(entityDisplay.subjectType, candidate.subjectType),
      eq(entityDisplay.subjectId, candidate.subjectId),
    ),
  );
  const rows = await db
    .select()
    .from(entityDisplay)
    .where(or(...conditions));
  const displays = new Map(
    rows.map((row) => [
      `${row.organizationId}:${row.subjectType}:${row.subjectId}`,
      storedEntityDisplayOut(row.subjectType, row.subjectId, row),
    ]),
  );
  return items.map((item) => {
    const subjectType = displaySubjectTypeForSearchKind(item.kind);
    if (!item.organizationId || !subjectType) return item;
    return {
      ...item,
      display: displays.get(`${item.organizationId}:${subjectType}:${item.entityId}`) ?? null,
    };
  });
}
