import type { TemplateCopyReview } from './gallery-review-types';
import type { WorkTemplateGalleryItem } from '@docket/work/template-gallery-contract';
import {
  galleryStructure,
  galleryPreviewSources,
  type GalleryStructureNode,
} from './gallery-structure';
import { GALLERY_CATEGORIES, gallerySourceKey } from './gallery-metadata';

/** Optional curated browse grouping retained as navigation context, never as implicit selection. */
export interface GalleryReviewOutcome {
  readonly name: string;
  readonly slugs: readonly string[];
}
/** Actual server-reviewed definition and its current public catalog use summary. */
export type GalleryReviewedCopy = TemplateCopyReview['copies'][number] & {
  readonly use?: string;
  readonly adjustmentCount?: number;
  readonly includedCount?: number;
};
/** One outcome or category containing only explicitly selected reviewed definitions. */
export interface GalleryReviewGroup {
  readonly name: string;
  readonly copies: readonly GalleryReviewedCopy[];
}
function workCount(nodes: readonly GalleryStructureNode[]): number {
  return nodes.reduce((count, node) => count + 1 + workCount(node.children), 0);
}
/** Preserve outcome/category browse order and exact selected roots without mounting nested work outlines. */
export function galleryReviewGroups(
  preview: TemplateCopyReview,
  items: readonly WorkTemplateGalleryItem[],
  outcomes: readonly GalleryReviewOutcome[] = [],
): readonly GalleryReviewGroup[] {
  const sources = galleryPreviewSources(preview);
  const selected = preview.roots.flatMap((identity) => {
    const copy = preview.copies.find(
      (entry) => gallerySourceKey(entry.source) === gallerySourceKey(identity),
    );
    const item = items.find(
      (entry) => gallerySourceKey(entry.identity) === gallerySourceKey(identity),
    );
    return copy
      ? [
          {
            ...copy,
            includedCount: workCount(galleryStructure(copy.definition, sources, copy.source)),
            adjustmentCount: preview.omissions.filter(
              (entry) => gallerySourceKey(entry.source) === gallerySourceKey(copy.source),
            ).length,
            ...(item ? { use: item.use } : {}),
          },
        ]
      : [];
  });
  const assigned = new Set<string>(),
    groups: GalleryReviewGroup[] = [];
  function assign(name: string, matches: (item: WorkTemplateGalleryItem) => boolean): void {
    const copies = selected.filter(
      (copy) =>
        !assigned.has(gallerySourceKey(copy.source)) &&
        items.some(
          (item) =>
            gallerySourceKey(item.identity) === gallerySourceKey(copy.source) && matches(item),
        ),
    );
    if (!copies.length) return;
    copies.forEach((copy) => assigned.add(gallerySourceKey(copy.source)));
    groups.push({ name, copies });
  }
  outcomes.forEach((outcome) => {
    assign(outcome.name, (item) => outcome.slugs.includes(item.slug));
  });
  GALLERY_CATEGORIES.forEach((category) => {
    assign(category.label, (item) => item.category === category.value);
  });
  const other = selected.filter((copy) => !assigned.has(gallerySourceKey(copy.source)));
  if (other.length) groups.push({ name: 'Other selected templates', copies: other });
  return groups;
}
