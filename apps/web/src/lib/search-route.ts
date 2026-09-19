import type { SearchDocumentKind, SearchResult, SearchRoute } from './contracts/search';

const INTERNAL_ROUTE_PREFIX = '/';

/** True when a search href should leave Next.js client routing. */
export function isExternalSearchHref(href: string | null): boolean {
  return href !== null && !href.startsWith(INTERNAL_ROUTE_PREFIX);
}

/** Resolve the best app href for a semantic search result. */
export function hrefForSearchResult(result: SearchResult): string | null {
  return hrefForSearchRoute(result.route);
}

/** Resolve the best app href for a semantic search route. */
export function hrefForSearchRoute(route: SearchRoute): string | null {
  switch (route.type) {
    case 'entity':
      return hrefForEntity(route.organizationId, route.entityKind, route.entityId, route.href);
    case 'content':
      return hrefForContent(route);
    case 'activity':
      return (
        route.externalUrl ?? route.href ?? activityFallbackHref(route.organizationId, route.eventId)
      );
    case 'calendar_event':
      return `/search?kind=calendar_event&id=${encodeURIComponent(route.calendarEventId)}`;
    case 'external':
      return route.externalUrl;
  }
}

// Mapping for standard entity paths to reduce complexity
const STANDARD_ENTITY_PATHS: Record<string, string> = {
  agent_session: 'sessions',
  task: 'tasks',
  project: 'projects',
  program: 'programs',
  initiative: 'initiatives',
  cycle: 'cycles',
};

function hrefForEntity(
  organizationId: string,
  kind: SearchDocumentKind,
  entityId: string,
  serverHref: string,
): string {
  // Standard org entity paths using mapping
  if (kind in STANDARD_ENTITY_PATHS) {
    const pathSegment = STANDARD_ENTITY_PATHS[kind as keyof typeof STANDARD_ENTITY_PATHS];
    return `/orgs/${organizationId}/${pathSegment}/${entityId}`;
  }

  // Special cases requiring custom logic
  switch (kind) {
    case 'organization':
      return `/orgs/${organizationId}/my-work`;
    case 'team':
      return `/orgs/${organizationId}/teams`;
    case 'member':
      return withQuery(`/orgs/${organizationId}/settings/members`, 'actorId', entityId);
    case 'agent':
      return withQuery('/athena', 'workspace', organizationId);
    case 'label':
      return labelFilterHref(organizationId, entityId);
    case 'saved_view':
      return withQuery(`/orgs/${organizationId}/views`, 'viewId', entityId);
    case 'calendar_event':
      return `/search?kind=calendar_event&id=${encodeURIComponent(entityId)}`;
    case 'external_resource':
      return withQuery(`/orgs/${organizationId}/library`, 'resourceId', entityId);
    case 'milestone':
    case 'comment':
    case 'update':
    case 'attachment':
    case 'activity':
      return normalizeInternalHref(serverHref);
  }
}

function hrefForContent(route: Extract<SearchRoute, { type: 'content' }>): string {
  const subjectHref = hrefForEntity(
    route.organizationId,
    route.subjectKind,
    route.subjectId,
    route.href,
  );
  return withQuery(subjectHref, `${route.contentKind}Id`, route.contentId);
}

function activityFallbackHref(organizationId: string | null, eventId: string): string {
  const params = new URLSearchParams({ eventId });
  return organizationId ? `/orgs/${organizationId}/stream?${params}` : `/stream?${params}`;
}

function normalizeInternalHref(href: string): string {
  if (href.startsWith('/agenda')) return href.replace('/agenda', '/search');
  if (href.startsWith('/orgs/') || href.startsWith('/search') || href.startsWith('/stream')) {
    return href;
  }
  return `/search?href=${encodeURIComponent(href)}`;
}

/**
 * The task-list URL pre-filtered to one label, in the view toolbar's `filter=field:op:value`
 * codec — mirrors `entityHref`'s label case in `apps/api/src/search/routes.ts`; if either side's
 * shape changes, the other must change with it.
 */
export function labelFilterHref(organizationId: string, labelId: string): string {
  return withQuery(`/orgs/${organizationId}/tasks`, 'filter', `labels:eq:${labelId}`);
}

function withQuery(base: string, key: string, value: string): string {
  const [pathname, query = ''] = base.split('?');
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${pathname}?${params.toString()}`;
}
