import { GALLERY_CATALOG, type GalleryEntry } from '@docket/work/template-gallery';
import {
  CatalogVersionId,
  normalizeCopyDefinition,
  authoredCopyReferences,
} from '@docket/work/template-copy';
import {
  WorkTemplateGalleryDetail,
  WorkTemplateGallerySource,
  WorkTemplateGalleryItem,
  WorkTemplateGalleryQuery,
  WorkTemplateGalleryFork,
  WorkTemplateGalleryForkSet,
} from '@docket/work/template-gallery-contract';
import { CursorQuery, type Page } from '../../contracts/pagination';
import { BlueprintError } from '@docket/work/blueprints';
import { NotFoundError, ValidationError } from '../../error';
import { decodeTupleCursor, pageResultByTuple } from '../list-cursor';

function item(entry: GalleryEntry): WorkTemplateGalleryItem {
  return WorkTemplateGalleryItem.parse({
    identity: {
      kind: 'catalog',
      release: entry.release,
      workTypeId: entry.id,
      catalogVersionId: CatalogVersionId.parse(entry.versionId),
    },
    slug: entry.slug,
    name: entry.definition.name,
    targetType: entry.definition.payload.targetType,
    category: entry.category,
    forks: entry.forks,
    use: entry.use,
  });
}
function matches(entry: GalleryEntry, query: WorkTemplateGalleryQuery): boolean {
  return (
    (!query.category || entry.category === query.category) &&
    (!query.targetType || entry.definition.payload.targetType === query.targetType) &&
    (!query.fork || entry.forks.includes(query.fork)) &&
    (!query.search ||
      [entry.definition.name, entry.use, entry.slug]
        .join(' ')
        .toLowerCase()
        .includes(query.search.toLowerCase()))
  );
}
function cursorPosition(
  rows: readonly GalleryEntry[],
  cursor: string | undefined,
  key: string,
): number {
  const decoded = decodeTupleCursor(cursor);
  if (!decoded) return 0;
  const index = rows.findIndex((row) => row.slug === decoded[2]);
  if (decoded.length !== 3 || decoded[0] !== 1 || decoded[1] !== key || index < 0)
    throw new ValidationError([
      { path: ['cursor'], message: 'The catalog cursor is invalid or expired.' },
    ]);
  return index + 1;
}
/** Discover immutable catalog work in authored category/order with filter-bound opaque pagination. */
export function listTemplateGallery(
  filters: WorkTemplateGalleryQuery,
  paging: { readonly limit: number; readonly cursor?: string | undefined },
): Page<WorkTemplateGalleryItem> {
  const query = WorkTemplateGalleryQuery.parse(filters),
    page = CursorQuery.parse(paging);
  const key = JSON.stringify([
    query.category ?? null,
    query.fork ?? null,
    query.targetType ?? null,
    query.search?.toLowerCase() ?? '',
  ]);
  const rows = GALLERY_CATALOG.filter((entry) => matches(entry, query));
  const offset = cursorPosition(rows, page.cursor, key);
  const result = pageResultByTuple(
    rows.slice(offset, offset + page.limit + 1),
    page.limit,
    (entry) => [entry.release, key, entry.slug],
  );
  return { ...result, items: result.items.map(item), total: rows.length };
}
/** Resolve a real released catalog entry; unknown slugs never resolve by display-name matching. */
export function requireGalleryEntry(slug: string): GalleryEntry {
  const entry = GALLERY_CATALOG.find((value) => value.slug === slug);
  if (!entry) throw new NotFoundError('Catalog definition not found');
  return entry;
}
function detailSource(entry: GalleryEntry) {
  return WorkTemplateGallerySource.parse({
    ...item(entry),
    definition: normalizeCopyDefinition(entry.definition, entry.defaultSchedules),
    labelSuggestions: entry.labelSuggestions,
    offeringSuggestions: entry.offeringSuggestions,
  });
}
function referencedEntries(root: GalleryEntry): readonly GalleryEntry[] {
  const entries = new Map(
    GALLERY_CATALOG.map((entry) => [JSON.stringify([entry.id, entry.versionId]), entry]),
  );
  const selected = new Set<string>(),
    pending = [root];
  while (pending.length) {
    const owner = pending.pop();
    if (!owner || selected.has(owner.slug)) continue;
    selected.add(owner.slug);
    if (selected.size > 100)
      throw new BlueprintError('blueprint_limit', 'Preview at most 100 referenced definitions.');
    const definition = normalizeCopyDefinition(owner.definition, owner.defaultSchedules);
    for (const { reference } of authoredCopyReferences({ definition })) {
      const target =
        reference.selection.kind === 'pinned'
          ? entries.get(
              JSON.stringify([reference.workTypeId, reference.selection.workTypeVersionId]),
            )
          : null;
      if (!target)
        throw new BlueprintError(
          'blueprint_invalid',
          'Catalog references need exact released definitions.',
        );
      pending.push(target);
    }
  }
  return GALLERY_CATALOG.filter((entry) => entry.slug !== root.slug && selected.has(entry.slug));
}
/** Read the root and every exact referenced catalog definition without pretending they are publications. */
export function getTemplateGalleryDetail(slug: string): WorkTemplateGalleryDetail {
  const entry = requireGalleryEntry(slug);
  return WorkTemplateGalleryDetail.parse({
    ...detailSource(entry),
    references: referencedEntries(entry).map(detailSource),
  });
}

/** Select every marked root of an approved fork, preserving complete curated membership. */
export function getTemplateGalleryFork(
  fork: WorkTemplateGalleryForkSet['fork'],
): WorkTemplateGalleryForkSet {
  const checked = WorkTemplateGalleryFork.parse(fork);
  return WorkTemplateGalleryForkSet.parse({
    fork: checked,
    release: 1,
    items: GALLERY_CATALOG.filter((entry) => entry.forks.includes(checked)).map(item),
  });
}
