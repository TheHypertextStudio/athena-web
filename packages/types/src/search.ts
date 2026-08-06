/**
 * `@docket/types` — workspace-wide semantic search DTOs.
 *
 * @remarks
 * Search results preserve what each hit is (`kind`), where it lives (`organizationId`,
 * `subject`, `source`), and why it matched (`snippet`, `matchedFields`, `facets`). The
 * command palette and the full `/search` page both consume this same shape.
 */
import { z } from 'zod';

import { SourceSystemKind } from './event';
import { OrganizationId } from './primitives';

/** Broad information architecture family for one search result. */
export const SearchDocumentFamily = z.enum(['work', 'people', 'content', 'activity']);
/** Search-document-family value. */
export type SearchDocumentFamily = z.infer<typeof SearchDocumentFamily>;

/** Narrow semantic kind for one search result. */
export const SearchDocumentKind = z.enum([
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
/** Search-document-kind value. */
export type SearchDocumentKind = z.infer<typeof SearchDocumentKind>;

/** The searchable fields that contributed to one result. */
export const SearchMatchedField = z.enum(['title', 'summary', 'body', 'facet', 'source']);
/** Search-matched-field value. */
export type SearchMatchedField = z.infer<typeof SearchMatchedField>;

/** A typed route the web app can interpret without switching on legacy hit types. */
export const SearchRoute = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('entity'),
    organizationId: OrganizationId,
    entityKind: SearchDocumentKind,
    entityId: z.string(),
    href: z.string(),
  }),
  z.object({
    type: z.literal('content'),
    organizationId: OrganizationId,
    subjectKind: SearchDocumentKind,
    subjectId: z.string(),
    contentKind: SearchDocumentKind,
    contentId: z.string(),
    href: z.string(),
  }),
  z.object({
    type: z.literal('activity'),
    organizationId: OrganizationId.nullable(),
    eventId: z.string(),
    href: z.string().nullable(),
    externalUrl: z.string().nullable(),
  }),
  z.object({
    type: z.literal('calendar_event'),
    calendarEventId: z.string(),
    href: z.string(),
  }),
  z.object({
    type: z.literal('external'),
    externalUrl: z.string(),
  }),
]);
/** Search-route value. */
export type SearchRoute = z.infer<typeof SearchRoute>;

/** The containing or canonical subject of a content/activity result. */
export const SearchSubject = z
  .object({
    kind: SearchDocumentKind,
    id: z.string(),
    title: z.string().nullable(),
    organizationId: OrganizationId.nullable(),
  })
  .meta({ id: 'SearchSubject', description: 'The containing subject for a search result.' });
/** Search-subject value. */
export type SearchSubject = z.infer<typeof SearchSubject>;

/** Source attribution for external content and activity-backed results. */
export const SearchSource = z
  .object({
    system: SourceSystemKind,
    externalUrl: z.string().nullable(),
    eventId: z.string().nullable(),
  })
  .meta({ id: 'SearchSource', description: 'Source attribution for a search result.' });
/** Search-source value. */
export type SearchSource = z.infer<typeof SearchSource>;

/** A structured facet bucket returned with a search page. */
export const SearchFacetSummary = z
  .object({
    field: z.string(),
    label: z.string(),
    values: z.array(
      z.object({
        value: z.string(),
        label: z.string(),
        count: z.number().int().nonnegative(),
      }),
    ),
  })
  .meta({ id: 'SearchFacetSummary', description: 'A facet bucket for search filtering.' });
/** Search-facet-summary value. */
export type SearchFacetSummary = z.infer<typeof SearchFacetSummary>;

/** A contextual action shown on a search result row. */
export const SearchAction = z
  .object({
    kind: z.string(),
    label: z.string(),
    href: z.string().optional(),
  })
  .meta({ id: 'SearchAction', description: 'A contextual action for a search result.' });
/** Search-action value. */
export type SearchAction = z.infer<typeof SearchAction>;

/**
 * A work container a resource is referenced from.
 *
 * @remarks
 * Answers "what is this for?", which a reference *count* cannot. A resource used by the Q3 launch
 * is a launch document; one used by nothing is orphaned documentation. Both readings are
 * actionable, and neither survives being reduced to a number.
 *
 * Resolution walks up from whatever mentioned the resource to the shallowest container that
 * accounts for the most references, so a row reads "Q3 launch" rather than naming one arbitrary
 * task among eleven.
 */
export const SearchUsedIn = z
  .object({
    kind: z.enum(['initiative', 'program', 'project', 'team']),
    id: z.string(),
    title: z.string(),
  })
  .meta({
    id: 'SearchUsedIn',
    description: 'A work container a search result is referenced from.',
  });
/** Search-used-in value. */
export type SearchUsedIn = z.infer<typeof SearchUsedIn>;

/** One semantic search result. */
export const SearchResult = z
  .object({
    id: z.string(),
    organizationId: OrganizationId.nullable(),
    userId: z.string().nullable(),
    kind: SearchDocumentKind,
    family: SearchDocumentFamily,
    title: z.string(),
    summary: z.string().nullable(),
    snippet: z.string().nullable(),
    matchedFields: z.array(SearchMatchedField),
    route: SearchRoute,
    subject: SearchSubject.nullable(),
    source: SearchSource.nullable(),
    facets: z.record(z.string(), z.unknown()),
    actions: z.array(SearchAction),
    score: z.number(),
    /**
     * The source row's own id, as opposed to {@link SearchResult.id}'s `kind:org:entityId`
     * composite. Callers that key off a record — a `?resourceId=` link, a mention lookup — need
     * this one, and deriving it from `route` client-side gets it wrong for route variants that
     * carry neither an `entityId` nor a `contentId`.
     */
    entityId: z.string(),
    /**
     * Where the result lives outside Docket, when it lives outside Docket.
     *
     * @remarks
     * Distinct from `source.externalUrl`, which is only populated when the row also has a
     * `sourceSystem` — and most resource providers deliberately have none, because `source_system`
     * is the event-source taxonomy. Without this field the URL is reachable only by digging through
     * `actions`, which turns a presentation detail into a wire contract.
     */
    externalUrl: z.string().nullable(),
    /** The work containers referencing this result, most-referencing first; empty when none do. */
    usedIn: z.array(SearchUsedIn).default([]),
    /**
     * When the underlying thing last changed, as an ISO timestamp.
     *
     * @remarks
     * Prefers the source's own updated time over the projection's, so a search reindex does not
     * make every row look freshly edited. Present here because no `*Out` DTO in the repository
     * exposes `updatedAt`, and a browsable list has to be able to show and sort by it.
     */
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SearchResult', description: 'One typed, permission-filtered search hit.' });
/** Search-result value. */
export type SearchResult = z.infer<typeof SearchResult>;

/**
 * Parsed search query parameters used by Hub and org-scoped search routes.
 *
 * @remarks
 * `q` is optional. Omitting it asks for *browse* rather than search: the same
 * permission-filtered corpus, ordered by recency instead of by relevance. The Library surface
 * depends on that mode, and it shares this one code path rather than getting its own endpoint so
 * that no second copy of the visibility filter can ever drift from this one.
 */
export const SearchQuery = z
  .object({
    q: z.string().trim().optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
    families: z.array(SearchDocumentFamily).default([]),
    kinds: z.array(SearchDocumentKind).default([]),
    sources: z.array(SourceSystemKind).default([]),
    orgIds: z.array(OrganizationId).default([]),
    ownerIds: z.array(z.string()).default([]),
    assigneeIds: z.array(z.string()).default([]),
    labelIds: z.array(z.string()).default([]),
    /** Resolve specific source entity ids, for a deep link to a row that is not on the first page. */
    ids: z.array(z.string()).default([]),
    statuses: z.array(z.string()).default([]),
    healths: z.array(z.string()).default([]),
    activeOrgId: OrganizationId.optional(),
    surface: z.enum(['page', 'palette']).default('page'),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    includeArchived: z.boolean().default(false),
  })
  .meta({ id: 'SearchQuery', description: 'Search query parameters after parsing.' });
/** Search-query value. */
export type SearchQuery = z.infer<typeof SearchQuery>;

/** Search response shared by the Hub palette endpoint and full search page endpoint. */
export const SearchOut = z
  .object({
    query: z.string(),
    items: z.array(SearchResult),
    facets: z.array(SearchFacetSummary),
    nextCursor: z.string().optional(),
  })
  .meta({ id: 'SearchOut', description: 'Semantic workspace search results.' });
/** Search-out value. */
export type SearchOut = z.infer<typeof SearchOut>;
