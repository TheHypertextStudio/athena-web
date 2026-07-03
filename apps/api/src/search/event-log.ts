import type { CanonicalEntityKind, SourceSystemKind } from '@docket/types';

/** The source row an event should cause the search indexer to reproject. */
export interface EventSearchReindexTarget {
  sourceTable: string;
  entityId: string;
}

interface EventEntityForSearch {
  kind: CanonicalEntityKind;
  source: SourceSystemKind;
  externalId: string;
  docketEntityId?: string | null;
}

const ENTITY_SOURCE_TABLE: Partial<Record<CanonicalEntityKind, string>> = {
  work_item: 'task',
  project: 'project',
  program: 'program',
  initiative: 'initiative',
  cycle: 'cycle',
  calendar_event: 'calendar_event',
  organization: 'organization',
};

/**
 * Resolve the Docket source row that should be reindexed after a canonical event.
 *
 * @remarks
 * Docket-origin events use `externalId` as the Docket id. External events only reindex
 * a Docket object once enrichment has filled `docketEntityId`; otherwise the event is
 * still searchable as activity but does not imply an internal object changed rank.
 */
export function eventSearchReindexTarget(
  entity: EventEntityForSearch | null | undefined,
): EventSearchReindexTarget | null {
  if (!entity) return null;
  const sourceTable = ENTITY_SOURCE_TABLE[entity.kind];
  if (!sourceTable) return null;
  const entityId = entity.docketEntityId ?? (entity.source === 'docket' ? entity.externalId : null);
  return entityId ? { sourceTable, entityId } : null;
}
