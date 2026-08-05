/**
 * `@docket/api` — search projector for resources that live outside Docket.
 *
 * @remarks
 * `external_resource` accumulates on its own: `reconcileMentions` writes a row the first time
 * anyone references a Drive file, a Figma board, or a web page in prose, deduped per organization
 * by `canonicalKey`. Until this projector existed that corpus was invisible — the Library and the
 * command palette both read `search_document`, and nothing put these rows there.
 *
 * Projecting them rather than querying `external_resource` directly is what keeps one visibility
 * filter in the system. A second read path beside `searchWorkspace` would be a second place for a
 * cross-tenant mistake to live.
 */
import { baseRankFor } from '../rank';
import { entityRoute } from '../routes';
import {
  cleanText,
  preloadedProjector,
  searchDocumentId,
  type SearchDocumentDraft,
  type SearchProjector,
} from '../types';

/** The `external_resource` columns this projection reads. */
interface ExternalResourceRow {
  id: string;
  organizationId: string;
  provider: string;
  canonicalKey: string;
  canonicalUrl: string;
  externalId: string | null;
  resourceType: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  iconUrl: string | null;
  thumbnailUrl: string | null;
  mimeType: string | null;
  ownerLabel: string | null;
  externalUpdatedAt: Date | null;
  unfurlStatus: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  archivedAt?: Date | null;
}

/**
 * `source_system` values that a resource provider genuinely corresponds to.
 *
 * @remarks
 * `source_system` is the canonical *event source* taxonomy, and most resource providers are not
 * event sources — Docket ingests no Figma or Dropbox events. Mapping only the provider that really
 * is one, and leaving the rest null, keeps the two vocabularies from being quietly merged. The
 * provider itself always rides on the facet, so nothing loses attribution.
 */
const PROVIDER_SOURCE_SYSTEM: Record<string, SearchDocumentDraft['sourceSystem']> = {
  google_drive: 'google_drive',
};

/**
 * A readable stand-in for a resource whose title has not been unfurled yet.
 *
 * @remarks
 * `external_resource.title` stays null until an unfurl resolves one, deliberately, so that nothing
 * renders a fabricated name. But `search_document.title` is NOT NULL and a row with no title
 * cannot be matched against at all. The resolution is to index the URL *as a URL* — host plus path,
 * which no reader will mistake for a human title — and to record `titleResolved: false` on the
 * facet so a surface can style it as the placeholder it is rather than as a name.
 *
 * @param canonicalUrl - The resource's canonical URL.
 * @returns host and path, or the raw URL when it will not parse.
 */
function urlStandIn(canonicalUrl: string): string {
  try {
    const url = new URL(canonicalUrl);
    return url.pathname === '/' ? url.host : `${url.host}${url.pathname}`;
  } catch {
    return canonicalUrl;
  }
}

/**
 * Project one external resource into its search document.
 *
 * @remarks
 * Freshness comes from `externalUpdatedAt` when the provider reports it, because that is when the
 * document actually changed; our own `updatedAt` moves whenever an unfurl retries and would
 * otherwise float untouched resources to the top of a recency-ordered Library.
 */
function projectExternalResource(row: ExternalResourceRow): SearchDocumentDraft {
  const resolvedTitle = cleanText(row.title);
  return {
    id: searchDocumentId('external_resource', row.organizationId, row.id),
    organizationId: row.organizationId,
    userId: null,
    kind: 'external_resource',
    family: 'content',
    sourceTable: 'external_resource',
    entityId: row.id,
    subjectKind: null,
    subjectId: null,
    sourceSystem: PROVIDER_SOURCE_SYSTEM[row.provider] ?? null,
    externalUrl: row.canonicalUrl,
    title: resolvedTitle ?? urlStandIn(row.canonicalUrl),
    summary: cleanText(row.description),
    // The provider's own text is all we have; there is no body to index beyond the description.
    body: null,
    facet: {
      provider: row.provider,
      resourceType: row.resourceType,
      canonicalKey: row.canonicalKey,
      unfurlStatus: row.unfurlStatus,
      titleResolved: resolvedTitle !== null,
      // Display metadata travels on the facet so a Library row renders its glyph and site without
      // a second round trip per row.
      ...(row.iconUrl ? { iconUrl: row.iconUrl } : {}),
      ...(row.thumbnailUrl ? { thumbnailUrl: row.thumbnailUrl } : {}),
      ...(row.siteName ? { siteName: row.siteName } : {}),
      ...(row.ownerLabel ? { ownerLabel: row.ownerLabel } : {}),
      ...(row.mimeType ? { mimeType: row.mimeType } : {}),
    },
    route: entityRoute(row.organizationId, 'external_resource', row.id),
    // No per-row visibility column exists: disclosing a link into shared prose is what puts the
    // row here, so every member of the organization may see it.
    visibility: { mode: 'org_members' },
    baseRank: baseRankFor('external_resource'),
    occurredAt: null,
    sourceUpdatedAt: row.externalUpdatedAt ?? row.updatedAt ?? row.createdAt ?? null,
    archivedAt: row.archivedAt ?? null,
  };
}

/** Projector for resources referenced from Docket prose but stored elsewhere. */
export const externalResourceSearchProjector = preloadedProjector<ExternalResourceRow>(
  'external_resource',
  projectExternalResource,
);

/** Every projector in the resources family. */
export const resourceSearchProjectors: readonly SearchProjector[] = [
  externalResourceSearchProjector,
];
