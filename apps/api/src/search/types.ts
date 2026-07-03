import type { SearchDocumentFamily, SearchDocumentKind, SourceSystemKind } from '@docket/types';

/** Structured route metadata persisted on a search document. */
export type SearchRouteDraft = Record<string, unknown> & { href: string };
/** Structured facet metadata persisted on a search document. */
export type SearchFacetDraft = Record<string, unknown>;
/** Query-time visibility metadata persisted on a search document. */
export type SearchVisibilityDraft =
  | { mode: 'org_members' }
  | { mode: 'user_private' }
  | { mode: 'grantable'; subjectKind: string; subjectId: string }
  | { mode: 'event'; subjectKind?: string; subjectId?: string };

/** A source-row projection ready to upsert into `search_document`. */
export interface SearchDocumentDraft {
  id: string;
  organizationId: string | null;
  userId: string | null;
  kind: SearchDocumentKind;
  family: SearchDocumentFamily;
  sourceTable: string;
  entityId: string;
  subjectKind: string | null;
  subjectId: string | null;
  sourceSystem: SourceSystemKind | null;
  externalUrl: string | null;
  title: string;
  summary: string | null;
  body: string | null;
  facet: SearchFacetDraft;
  route: SearchRouteDraft;
  visibility: SearchVisibilityDraft;
  baseRank: number;
  occurredAt: Date | null;
  sourceUpdatedAt: Date | null;
  archivedAt: Date | null;
}

/** Input for a search projector. A preloaded row keeps unit tests small and direct. */
export interface SearchProjectionInput<Row = unknown> {
  entityId: string;
  row?: Row;
}

/** Converts one source row into one semantic search document. */
export interface SearchProjector<Row = unknown> {
  readonly sourceTable: string;
  project(input: SearchProjectionInput<Row>): Promise<SearchDocumentDraft | null>;
}

/** Build a projector whose unit-test path receives a preloaded source row. */
export function preloadedProjector<Row>(
  sourceTable: string,
  project: (row: Row) => SearchDocumentDraft | null,
): SearchProjector<Row> {
  return {
    sourceTable,
    async project(input) {
      if (!input.row) return null;
      return project(input.row);
    },
  };
}

/** Shared shape for rows with common audit columns. */
export interface OrgScopedRow {
  id: string;
  organizationId: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  archivedAt?: Date | null;
}

/** Build the stable search document id from the semantic kind, scope, and source id. */
export function searchDocumentId(
  kind: SearchDocumentKind,
  scope: string | null | undefined,
  entityId: string,
): string {
  return `${kind}:${scope ?? 'global'}:${entityId}`;
}

/** First non-empty text value, with surrounding whitespace removed. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Pick the source row timestamp that best represents freshness for search ranking. */
export function sourceUpdatedAt(row: {
  updatedAt?: Date | null;
  createdAt?: Date | null;
  occurredAt?: Date | null;
}): Date | null {
  return row.updatedAt ?? row.occurredAt ?? row.createdAt ?? null;
}

/** Visibility metadata for a work object with a public/private visibility column. */
export function workVisibility(
  row: { id: string; visibility?: string | null },
  kind: SearchDocumentKind,
): SearchVisibilityDraft {
  return row.visibility === 'private'
    ? { mode: 'grantable', subjectKind: kind, subjectId: row.id }
    : { mode: 'org_members' };
}

/** Visibility metadata for content that inherits a subject's permissions. */
export function subjectVisibility(subjectKind: string, subjectId: string): SearchVisibilityDraft {
  return { mode: 'grantable', subjectKind, subjectId };
}
