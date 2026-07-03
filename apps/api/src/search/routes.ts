import type { SearchDocumentKind } from '@docket/types';

import type { SearchRouteDraft } from './types';

/** Build a first-party entity href for the current web route tree. */
export function entityHref(
  organizationId: string,
  kind: SearchDocumentKind,
  entityId: string,
  facet?: Record<string, string | null | undefined>,
): string {
  switch (kind) {
    case 'organization':
      return `/orgs/${organizationId}`;
    case 'team':
      return `/orgs/${organizationId}/teams`;
    case 'member':
      return `/orgs/${organizationId}/settings/members`;
    case 'agent':
      return `/orgs/${organizationId}/agents`;
    case 'agent_session':
      return `/orgs/${organizationId}/sessions/${entityId}`;
    case 'task':
      return `/orgs/${organizationId}/tasks/${entityId}`;
    case 'project':
      return `/orgs/${organizationId}/projects/${entityId}`;
    case 'program':
      return `/orgs/${organizationId}/programs/${entityId}`;
    case 'initiative':
      return `/orgs/${organizationId}/initiatives/${entityId}`;
    case 'milestone':
      return facet?.['projectId']
        ? `/orgs/${organizationId}/projects/${facet['projectId']}?milestoneId=${entityId}`
        : `/orgs/${organizationId}/projects?milestoneId=${entityId}`;
    case 'cycle':
      return `/orgs/${organizationId}/cycles/${entityId}`;
    case 'label':
      return `/orgs/${organizationId}/tasks?labelId=${entityId}`;
    case 'saved_view':
      return `/orgs/${organizationId}/views?viewId=${entityId}`;
    case 'comment':
    case 'update':
    case 'attachment':
    case 'calendar_event':
    case 'activity':
      return `/orgs/${organizationId}/search?kind=${kind}&id=${entityId}`;
  }
}

/** Route metadata for an entity search result. */
export function entityRoute(
  organizationId: string,
  kind: SearchDocumentKind,
  entityId: string,
  facet: Record<string, string | null | undefined> = {},
): SearchRouteDraft {
  return {
    type: 'entity',
    organizationId,
    entityKind: kind,
    entityId,
    href: entityHref(organizationId, kind, entityId, facet),
  };
}

/** Route metadata for content that lives under another object. */
export function contentRoute(
  organizationId: string,
  subjectKind: string,
  subjectId: string,
  contentKind: SearchDocumentKind,
  contentId: string,
): SearchRouteDraft {
  return {
    type: 'content',
    organizationId,
    subjectKind,
    subjectId,
    contentKind,
    contentId,
    href: `/orgs/${organizationId}/search?subjectKind=${subjectKind}&subjectId=${subjectId}&${contentKind}Id=${contentId}`,
  };
}

/** Route metadata for a user-private calendar event. */
export function calendarEventRoute(calendarEventId: string): SearchRouteDraft {
  return {
    type: 'calendar_event',
    calendarEventId,
    href: `/agenda?eventId=${calendarEventId}`,
  };
}

/** Route metadata for one canonical activity event. */
export function activityRoute(
  organizationId: string | null,
  eventId: string,
  externalUrl: string | null,
): SearchRouteDraft {
  return {
    type: 'activity',
    organizationId,
    eventId,
    href: organizationId
      ? `/orgs/${organizationId}/stream?eventId=${eventId}`
      : `/search?eventId=${eventId}`,
    externalUrl,
  };
}
