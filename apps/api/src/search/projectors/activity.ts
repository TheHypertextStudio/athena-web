import type { SearchDocumentKind, SourceSystemKind } from '@docket/types';

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
  docketEntityId?: string | null;
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
  participants?: unknown[];
  detail?: unknown;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  archivedAt?: Date | null;
}

function searchKindForEntity(entity: EventEntity | null | undefined): SearchDocumentKind | null {
  if (!entity?.docketEntityId) return null;
  switch (entity.kind) {
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

export const eventSearchProjector = preloadedProjector<EventRow>(
  'event',
  (row): SearchDocumentDraft => {
    const subjectKind = searchKindForEntity(row.entity);
    const subjectId = subjectKind ? (row.entity?.docketEntityId ?? null) : null;
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

export const activitySearchProjectors = [eventSearchProjector];
