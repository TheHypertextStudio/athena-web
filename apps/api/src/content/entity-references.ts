/**
 * `@docket/api` — what references a thing, as opposed to what a thing references.
 *
 * @remarks
 * MENTIONS-001 shipped the outbound direction and the index for the inbound one, but no endpoint
 * over it. `mention_target_entity_idx` on `(organizationId, targetEntityKind, targetEntityId)` and
 * `mention_resource_idx` on `externalResourceId` make both arms an index scan, so this is a read
 * that was already paid for.
 *
 * Visibility is delegated to {@link loadVisibleDocuments} rather than recomputed. A backlink panel
 * is exactly the surface where a second, subtly different permission check would leak the title of
 * something the reader cannot open.
 */
import type { EntityReferencesOut } from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';

import { loadVisibleDocuments, type SearchCaller } from '../search/query';

/** What {@link loadInboundReferences} needs to answer "what points at this?". */
export interface InboundReferencesQuery {
  /** Whose permissions decide which referencing records are visible. */
  readonly caller: SearchCaller;
  /** The workspace to look in; mentions never cross one. */
  readonly orgId: string;
  /**
   * The kind of thing being referenced: `external_resource` for a Library row, otherwise the
   * Docket entity kind stored on `mention.targetEntityKind`.
   */
  readonly targetKind: string;
  /** The referenced thing's id. */
  readonly targetId: string;
}

/** The order backlink groups render in — the containers first, then the prose that sits inside them. */
const GROUP_ORDER = ['initiative', 'program', 'project', 'task', 'team', 'comment', 'update'];

function groupRank(subjectType: string): number {
  const index = GROUP_ORDER.indexOf(subjectType);
  return index === -1 ? GROUP_ORDER.length : index;
}

/**
 * Load the records that use one entity or external resource.
 *
 * @remarks
 * Titles and routes come from the search projection rather than from each source table, so one
 * batched read covers every subject kind at once and the hrefs match the ones search already hands
 * out. A subject with no search document is dropped: it is either not yet indexed or not visible,
 * and both cases should read the same to the caller.
 *
 * @param input - The caller, the workspace, and the referenced thing.
 * @returns The visible records using the target, grouped by subject kind.
 */
export async function loadInboundReferences(
  input: InboundReferencesQuery,
): Promise<EntityReferencesOut> {
  const schema = await import('@docket/db');

  const targetMatch =
    input.targetKind === 'external_resource'
      ? eq(schema.mention.externalResourceId, input.targetId)
      : and(
          eq(schema.mention.targetEntityKind, input.targetKind as 'task'),
          eq(schema.mention.targetEntityId, input.targetId),
        );

  const [mentionRows, attachmentRows] = await Promise.all([
    schema.db
      .select({
        subjectType: schema.mention.subjectType,
        subjectId: schema.mention.subjectId,
      })
      .from(schema.mention)
      .where(and(eq(schema.mention.organizationId, input.orgId), targetMatch)),
    input.targetKind === 'external_resource'
      ? schema.db
          .select({
            subjectType: schema.attachment.subjectType,
            subjectId: schema.attachment.subjectId,
          })
          .from(schema.attachment)
          .where(
            and(
              eq(schema.attachment.organizationId, input.orgId),
              eq(schema.attachment.externalResourceId, input.targetId),
              isNull(schema.attachment.archivedAt),
            ),
          )
      : Promise.resolve([]),
  ]);
  const rows = [...mentionRows, ...attachmentRows];
  if (rows.length === 0) return { total: 0, groups: [] };

  // One record can reference the same target several times in one field; it is still one backlink.
  const subjectTypeById = new Map<string, string>();
  for (const row of rows) subjectTypeById.set(row.subjectId, row.subjectType);

  const documents = await loadVisibleDocuments({
    caller: input.caller,
    orgId: input.orgId,
    entityIds: [...subjectTypeById.keys()],
  });

  const byType = new Map<
    string,
    { subjectType: string; subjectId: string; title: string; href: string }[]
  >();
  for (const document of documents) {
    const subjectType = subjectTypeById.get(document.entityId);
    if (!subjectType) continue;
    const href = typeof document.route['href'] === 'string' ? document.route['href'] : null;
    if (!href) continue;
    const bucket = byType.get(subjectType) ?? [];
    bucket.push({ subjectType, subjectId: document.entityId, title: document.title, href });
    byType.set(subjectType, bucket);
  }

  const groups = [...byType.entries()]
    .sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b))
    .map(([subjectType, items]) => ({
      subjectType,
      items: items.sort((a, b) => a.title.localeCompare(b.title)),
    }));

  return { total: groups.reduce((sum, group) => sum + group.items.length, 0), groups };
}
