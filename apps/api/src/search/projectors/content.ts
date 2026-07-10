import { baseRankFor } from '../rank';
import { contentRoute } from '../routes';
import {
  cleanText,
  type OrgScopedRow,
  preloadedProjector,
  searchDocumentId,
  type SearchDocumentDraft,
  sourceUpdatedAt,
  subjectVisibility,
} from '../types';

function contentDocument(
  row: OrgScopedRow,
  kind: SearchDocumentDraft['kind'],
  title: string,
  subjectKind: string,
  subjectId: string,
  options: {
    summary?: string | null;
    body?: string | null;
    facet?: Record<string, unknown>;
    externalUrl?: string | null;
  } = {},
): SearchDocumentDraft {
  return {
    id: searchDocumentId(kind, row.organizationId, row.id),
    organizationId: row.organizationId,
    userId: null,
    kind,
    family: 'content',
    sourceTable: kind,
    entityId: row.id,
    subjectKind,
    subjectId,
    sourceSystem: 'docket',
    externalUrl: options.externalUrl ?? null,
    title,
    summary: cleanText(options.summary),
    body: cleanText(options.body),
    facet: { subjectKind, subjectId, ...(options.facet ?? {}) },
    route: contentRoute(row.organizationId, subjectKind, subjectId, kind, row.id),
    visibility: subjectVisibility(subjectKind, subjectId),
    baseRank: baseRankFor(kind),
    occurredAt: null,
    sourceUpdatedAt: sourceUpdatedAt(row),
    archivedAt: row.archivedAt ?? null,
  };
}

/** Projector for comments attached to searchable Docket subjects. */
export const commentSearchProjector = preloadedProjector<
  OrgScopedRow & {
    authorId?: string | null;
    subjectType: string;
    subjectId: string;
    body: string;
    parentCommentId?: string | null;
    editedAt?: Date | null;
  }
>('comment', (row) => ({
  ...contentDocument(
    row,
    'comment',
    `Comment on ${row.subjectType}`,
    row.subjectType,
    row.subjectId,
    {
      summary: row.body,
      body: row.body,
      facet: {
        authorId: row.authorId,
        parentCommentId: row.parentCommentId,
        editedAt: row.editedAt?.toISOString() ?? null,
      },
    },
  ),
  sourceTable: 'comment',
}));

/** Projector for status updates attached to searchable Docket subjects. */
export const updateSearchProjector = preloadedProjector<
  OrgScopedRow & {
    authorId?: string | null;
    subjectType: string;
    subjectId: string;
    health?: string | null;
    body: string;
  }
>('update', (row) => ({
  ...contentDocument(
    row,
    'update',
    `Update on ${row.subjectType}`,
    row.subjectType,
    row.subjectId,
    {
      summary: row.body,
      body: row.body,
      facet: { authorId: row.authorId, health: row.health },
    },
  ),
  sourceTable: 'update',
}));

/** Projector for attachments associated with searchable Docket subjects. */
export const attachmentSearchProjector = preloadedProjector<
  OrgScopedRow & {
    subjectType: string;
    subjectId: string;
    kind: string;
    title: string;
    url?: string | null;
    sourceIntegrationId?: string | null;
    externalId?: string | null;
    metadata?: Record<string, unknown> | null;
  }
>('attachment', (row) => ({
  ...contentDocument(row, 'attachment', row.title, row.subjectType, row.subjectId, {
    summary: row.url ?? row.kind,
    body: row.url,
    externalUrl: row.url ?? null,
    facet: {
      attachmentKind: row.kind,
      sourceIntegrationId: row.sourceIntegrationId,
      externalId: row.externalId,
      metadata: row.metadata,
    },
  }),
  sourceTable: 'attachment',
}));

/** Search projectors registered for content-family documents. */
export const contentSearchProjectors = [
  commentSearchProjector,
  updateSearchProjector,
  attachmentSearchProjector,
];
