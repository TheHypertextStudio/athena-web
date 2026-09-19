import { markdownToPlainText } from '../../content/markdown-links';
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

/** Document creation options. */
interface ContentDocumentOptions {
  readonly kind: SearchDocumentDraft['kind'];
  readonly title: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly summary?: string | null | undefined;
  readonly body?: string | null | undefined;
  readonly facet?: Record<string, unknown> | undefined;
  readonly externalUrl?: string | null | undefined;
}

function contentDocument(row: OrgScopedRow, options: ContentDocumentOptions): SearchDocumentDraft {
  const { kind, title, subjectKind, subjectId, summary, body, facet, externalUrl } = options;
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
    externalUrl,
    title,
    summary: cleanText(summary),
    body: cleanText(body),
    facet: { subjectKind, subjectId, ...(facet ?? {}) },
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
    authorId?: string | null | undefined;
    subjectType: string;
    subjectId: string;
    body: string;
    parentCommentId?: string | null | undefined;
    editedAt?: Date | null | undefined;
  }
>('comment', (row) => ({
  ...contentDocument(row, {
    kind: 'comment',
    title: `Comment on ${row.subjectType}`,
    subjectKind: row.subjectType,
    subjectId: row.subjectId,
    // `body` is Markdown (comments are authored in the same rich editor as everything else a
    // reader mentions), so the display summary needs the same plain-text treatment `work.ts`
    // gives Initiative/Project/Program/Task — otherwise a `@`-mentioned comment's hovercard
    // shows raw `#`/`*` source.
    summary: markdownToPlainText(row.body),
    body: row.body,
    facet: {
      authorId: row.authorId,
      parentCommentId: row.parentCommentId,
      editedAt: row.editedAt?.toISOString() ?? null,
    },
  }),
  sourceTable: 'comment',
}));

/** Projector for status updates attached to searchable Docket subjects. */
export const updateSearchProjector = preloadedProjector<
  OrgScopedRow & {
    authorId?: string | null | undefined;
    subjectType: string;
    subjectId: string;
    health?: string | null | undefined;
    body: string;
  }
>('update', (row) => ({
  ...contentDocument(row, {
    kind: 'update',
    title: `Update on ${row.subjectType}`,
    subjectKind: row.subjectType,
    subjectId: row.subjectId,
    // Same reasoning as `commentSearchProjector`: `body` is Markdown, so the summary shown in a
    // preview needs the plain-text treatment, not the raw source.
    summary: markdownToPlainText(row.body),
    body: row.body,
    facet: { authorId: row.authorId, health: row.health },
  }),
  sourceTable: 'update',
}));

/** Projector for attachments associated with searchable Docket subjects. */
export const attachmentSearchProjector = preloadedProjector<
  OrgScopedRow & {
    subjectType: string;
    subjectId: string;
    kind: string;
    title: string;
    url?: string | null | undefined;
    sourceIntegrationId?: string | null | undefined;
    externalId?: string | null | undefined;
    metadata?: Record<string, unknown> | null | undefined;
    fileName?: string | null | undefined;
    mimeType?: string | null | undefined;
    byteSize?: number | null | undefined;
  }
>('attachment', (row) => ({
  ...contentDocument(row, {
    kind: 'attachment',
    title: row.title,
    subjectKind: row.subjectType,
    subjectId: row.subjectId,
    summary: row.url ?? row.kind,
    body: row.url,
    externalUrl: row.url ?? null,
    facet: {
      attachmentKind: row.kind,
      sourceIntegrationId: row.sourceIntegrationId,
      externalId: row.externalId,
      metadata: row.metadata,
      fileName: row.fileName,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
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
