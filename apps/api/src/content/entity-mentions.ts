/**
 * Everything one entity's prose points at, for its Resources tab.
 *
 * @remarks
 * Read straight off the `mention` edges the reconciler derives, so a reference appears here the
 * moment its description is saved and disappears when the author deletes it — with nobody attaching
 * or detaching anything.
 *
 * A reference written twice in one body is one row carrying a count, not two rows. Which fields it
 * appears in travels with it, so the tab can say "in Description" rather than leaving the reader to
 * wonder where it came from.
 */
import type { EntityMention, MentionRef, MentionSubjectType } from '@docket/types';
import { mentionRefKey } from '@docket/types';

import { loadVisibleDocuments, type SearchCaller } from '../search/query';

import { entityMentionHref } from './mention-href';
import { createDrizzleMentionStorage } from './drizzle-mention-storage';
import type { ExternalResourceRepository, MentionStorage, StoredResource } from './mention-ports';
import { toExternalResourceOut } from './resource-view';

/** What the Resources tab asks for. */
export interface EntityMentionsQuery {
  /** Where edges and resource rows are read from. Injected, so this is testable with no database. */
  readonly storage?: MentionStorage;
  /** Whose access decides which referenced entities are named. */
  readonly caller: SearchCaller;
  /** The workspace the subject lives in. */
  readonly orgId: string;
  /** The kind of entity whose prose is being read. */
  readonly subjectType: MentionSubjectType;
  /** The entity whose prose is being read. */
  readonly subjectId: string;
}

/** External and entity references, each in document order. */
export interface EntityMentionsResult {
  readonly external: EntityMention[];
  readonly entities: EntityMention[];
}

/** One reference accumulated across however many times it was written. */
interface Accumulated {
  readonly ref: MentionRef;
  readonly key: string;
  label: string;
  readonly fields: Set<string>;
  occurrences: number;
  readonly externalResourceId: string | null;
}

/**
 * Read the references derived from one entity's prose.
 *
 * @remarks
 * Referenced Docket entities are filtered through the shared visibility query, so a reader who
 * cannot see a task does not learn its title from a Resources tab either. An entity reference that
 * fails that check is dropped rather than shown as inaccessible: unlike a chip sitting inline in
 * prose the reader can already see, a list row has no context that would make "you cannot see this"
 * useful.
 *
 * @param input - The caller, the org, and the subject.
 * @returns The references, split by what they point at.
 */
export async function loadEntityMentions(
  input: EntityMentionsQuery,
): Promise<EntityMentionsResult> {
  const storage = input.storage ?? createDrizzleMentionStorage();
  const rows = await storage.mentions.listForSubject({
    organizationId: input.orgId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
  });

  if (rows.length === 0) return { external: [], entities: [] };

  const accumulated = new Map<string, Accumulated>();
  for (const row of rows) {
    const ref: MentionRef =
      row.targetKind === 'entity' && row.targetEntityKind !== null && row.targetEntityId !== null
        ? { kind: 'entity', entityKind: row.targetEntityKind, entityId: row.targetEntityId }
        : { kind: 'external', url: '' };
    // An external edge carries its URL on the resource row, not on the edge itself.
    if (ref.kind === 'external' && row.externalResourceId === null) continue;

    const key =
      ref.kind === 'entity' ? mentionRefKey(ref) : `resource:${row.externalResourceId ?? ''}`;
    const existing = accumulated.get(key);
    if (existing === undefined) {
      accumulated.set(key, {
        ref,
        key,
        label: row.label,
        fields: new Set([row.field]),
        occurrences: 1,
        externalResourceId: row.externalResourceId,
      });
      continue;
    }
    existing.fields.add(row.field);
    existing.occurrences += 1;
  }

  const resourceIds = [...accumulated.values()]
    .map((entry) => entry.externalResourceId)
    .filter((id): id is string => id !== null);

  const [resources, visibleEntityIds] = await Promise.all([
    loadResources(storage.resources, input.orgId, resourceIds),
    loadVisibleEntityIds(input, [...accumulated.values()]),
  ]);

  const external: EntityMention[] = [];
  const entities: EntityMention[] = [];

  for (const entry of accumulated.values()) {
    const fields = [...entry.fields];
    if (entry.ref.kind === 'external') {
      const row =
        entry.externalResourceId === null ? undefined : resources.get(entry.externalResourceId);
      if (row === undefined) continue;
      external.push({
        ref: { kind: 'external', url: row.canonicalUrl },
        key: entry.key,
        label: entry.label,
        href: row.canonicalUrl,
        fields,
        occurrences: entry.occurrences,
        resource: toExternalResourceOut(row),
      });
      continue;
    }

    if (!visibleEntityIds.has(entry.ref.entityId)) continue;
    entities.push({
      ref: entry.ref,
      key: entry.key,
      label: entry.label,
      href: entityMentionHref(input.orgId, entry.ref),
      fields,
      occurrences: entry.occurrences,
      resource: null,
    });
  }

  return { external, entities };
}

/** Narrow referenced Docket entities to the ones this caller may see. */
async function loadVisibleEntityIds(
  input: EntityMentionsQuery,
  entries: readonly Accumulated[],
): Promise<ReadonlySet<string>> {
  const entityIds = entries.flatMap((entry) =>
    entry.ref.kind === 'entity' ? [entry.ref.entityId] : [],
  );
  if (entityIds.length === 0) return new Set();
  const rows = await loadVisibleDocuments({
    caller: input.caller,
    orgId: input.orgId,
    entityIds,
  });
  return new Set(rows.map((row) => row.entityId));
}

/** Load the shared resource rows for a batch of ids. */
async function loadResources(
  resources: ExternalResourceRepository,
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, StoredResource>> {
  const rows = await resources.findByIds(orgId, ids);
  return new Map(rows.map((row) => [row.id, row]));
}
