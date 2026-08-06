import type { CanonicalEntityKind } from '@docket/types';

/** The source row an event should cause the search indexer to reproject. */
export interface EventSearchReindexTarget {
  sourceTable: string;
  entityId: string;
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
 * Activity on a thing is evidence the thing changed rank, so a Linear comment bumps the freshness
 * of the task mirroring that issue. External events reached this with `null` for years, because
 * association was never implemented and every external ref carried no Docket id; they were indexed
 * as activity but never refreshed the object they concerned.
 *
 * Takes the resolved id directly rather than digging it out of an entity ref: internal and external
 * events reach this from different shapes, and both now carry the same answer on the event row.
 *
 * @param entityKind - The canonical kind of the event's subject, when it has one.
 * @param docketEntityId - The Docket entity the event resolved to, or null when unassociated.
 * @returns the table and row to reproject, or null when there is nothing to refresh.
 */
export function eventSearchReindexTarget(
  entityKind: CanonicalEntityKind | null | undefined,
  docketEntityId: string | null,
): EventSearchReindexTarget | null {
  if (!entityKind || !docketEntityId) return null;
  const sourceTable = ENTITY_SOURCE_TABLE[entityKind];
  return sourceTable ? { sourceTable, entityId: docketEntityId } : null;
}
