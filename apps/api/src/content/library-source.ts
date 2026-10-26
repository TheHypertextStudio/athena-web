import type { attachment, externalResource } from '@docket/db';
import type { z } from 'zod';
import { NotFoundError } from '../error';
import { LibrarySummary, type LibraryRef } from '../contracts/library';
import type { ScoredRow } from '../search/query-types';
import { projectPreloadedSearchDocument } from '../search/registry';
import { toExternalResourceOut } from './resource-view';

/** A live Library source row. */
export type LibrarySource = typeof attachment.$inferSelect | typeof externalResource.$inferSelect;

/** Canonical URI for Library detail or uploaded content. */
export function libraryUri(ref: LibraryRef, content = false): string {
  return `docket://${ref.orgId}/library/${ref.kind}/${encodeURIComponent(ref.id)}${content ? '/content' : ''}`;
}

/** Project safe Library metadata without storage keys or arbitrary attachment metadata. */
export function summarizeLibraryResource(
  ref: LibraryRef,
  source: LibrarySource,
  usedIn: z.infer<typeof LibrarySummary>['usedIn'],
): z.infer<typeof LibrarySummary> {
  const linked = 'canonicalUrl' in source;
  return LibrarySummary.parse({
    ...ref,
    uri: libraryUri(ref),
    title: source.title,
    description: linked ? source.description : null,
    sourceUrl: linked ? source.canonicalUrl : source.url,
    updatedAt: source.updatedAt.toISOString(),
    usedIn,
    metadata: linked
      ? toExternalResourceOut(source)
      : {
          kind: source.kind,
          subjectType: source.subjectType,
          subjectId: source.subjectId,
          fileName: source.fileName,
          mimeType: source.mimeType,
          byteSize: source.byteSize,
          ...(source.kind === 'file'
            ? { downloadUrl: `/v1/orgs/${ref.orgId}/deliverables/${source.id}/download` }
            : {}),
        },
  });
}

/** Project a live Library row through its existing visibility policy. */
export async function scoreLibrarySource(
  ref: LibraryRef,
  source: LibrarySource,
): Promise<ScoredRow> {
  const draft = await projectPreloadedSearchDocument(ref.kind, source);
  if (!draft) throw new NotFoundError();
  return {
    row: {
      ...draft,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      indexedAt: source.updatedAt,
      textRank: 0,
    },
    score: 0,
    sortTime: source.updatedAt.getTime(),
    matchedFields: [],
    snippetMatch: null,
  };
}
