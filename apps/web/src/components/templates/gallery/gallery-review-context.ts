import type {
  WorkTemplateGalleryItem,
  WorkTemplateGalleryPreview,
} from '@docket/work/template-gallery-contract';
import { GALLERY_OUTCOMES, gallerySourceKey } from './gallery-metadata';
import type { GalleryTabMemory } from './gallery-session';
import type { GalleryReviewOutcome } from './gallery-review-groups';

/** Retain the actual curated navigation context without changing selected roots or full-fork membership. */
export function gallerySelectedOutcomes(memory: GalleryTabMemory): readonly GalleryReviewOutcome[] {
  return memory.view === 'suggested' && memory.filters.fork
    ? GALLERY_OUTCOMES[memory.filters.fork]
    : [];
}
/** Resolve current exact catalog metadata for all reviewed copies, including subordinate dependencies. */
export function galleryReviewedMetadata(
  preview: WorkTemplateGalleryPreview,
  catalog: readonly WorkTemplateGalleryItem[],
): readonly WorkTemplateGalleryItem[] {
  const sources = new Set(preview.copies.map((copy) => gallerySourceKey(copy.source)));
  return catalog.filter((item) => sources.has(gallerySourceKey(item.identity)));
}
