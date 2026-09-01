import type { SearchDocumentKind } from '../../contracts/search';
import type { SourceSystemKind } from '@docket/connections/event-contract';

import { baseRankFor } from '../rank';
import { activityRoute } from '../routes';
import {
  cleanText,
  preloadedProjector,
  searchDocumentId,
  type SearchDocumentDraft,
  sourceUpdatedAt,
} from '../types';

interface EventEntity {
  kind?: string | null;
  title?: string | null;
  url?: string | null;
}

interface EventRow {
  id: string;
  organizationId: string;
  userId?: string | null;
  sourceSystem: SourceSystemKind;
  externalUrl?: string | null;
  kind: string;
  occurredAt: Date;
  title: string;
  summary?: string | null;
  actor?: unknown;
  entity?: EventEntity | null;
  entityKind?: string | null;
  docketEntityId?: string | null;
  participants?: unknown[];
  detail?: unknown;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  archivedAt?: Date | null;
}

/**
 * The search kind an event's subject scopes to, or null when it has no Docket subject.
 *
 * @remarks
 * Reads the resolved association rather than the `entity` jsonb. Until association existed this
 * returned null for every external event, so all external activity was indexed org-wide visible
 * instead of being scoped to the thing it was about.
 */
function searchKindForEntity(
  entityKind: string | null | undefined,
  docketEntityId: string | null | undefined,
): SearchDocumentKind | null {
  if (!docketEntityId) return null;
  switch (entityKind) {
    case 'work_item':
      return 'task';
    case 'project':
      return 'project';
    case 'program':
      return 'program';
    case 'initiative':
      return 'initiative';
    case 'cycle':
      return 'cycle';
    case 'calendar_event':
      return 'calendar_event';
    case 'organization':
      return 'organization';
    default:
      return null;
  }
}

/** Projector that turns a canonical event-log row into searchable activity. */
export const eventSearchProjector = preloadedProjector<EventRow>(
  'event',
  (row): SearchDocumentDraft => {
    const subjectKind = searchKindForEntity(row.entityKind, row.docketEntityId);
    const subjectId = subjectKind ? (row.docketEntityId ?? null) : null;
    return {
      id: searchDocumentId('activity', row.organizationId, row.id),
      organizationId: row.organizationId,
      userId: row.userId ?? null,
      kind: 'activity',
      family: 'activity',
      sourceTable: 'event',
      entityId: row.id,
      subjectKind,
      subjectId,
      sourceSystem: row.sourceSystem,
      externalUrl: row.externalUrl ?? row.entity?.url ?? null,
      title: row.title,
      summary: cleanText(row.summary),
      body: cleanText(row.summary),
      facet: {
        eventKind: row.kind,
        actor: row.actor,
        entity: row.entity,
        entityKind: row.entityKind,
        participants: row.participants ?? [],
        detail: row.detail,
      },
      route: activityRoute(row.organizationId, row.id, row.externalUrl ?? row.entity?.url ?? null),
      visibility:
        subjectKind && subjectId ? { mode: 'event', subjectKind, subjectId } : { mode: 'event' },
      baseRank: baseRankFor('activity'),
      occurredAt: row.occurredAt,
      sourceUpdatedAt: sourceUpdatedAt(row),
      archivedAt: row.archivedAt ?? null,
    };
  },
);

/** Search projectors registered for activity-family documents. */
export const activitySearchProjectors = [eventSearchProjector];
