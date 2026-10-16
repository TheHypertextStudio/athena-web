import type { GallerySlug } from './identities';
import type { GalleryCategory, GalleryFork } from './types';
import { COMMERCIAL_GALLERY_METADATA } from './metadata-commercial';
import { COMMUNITY_GALLERY_METADATA } from './metadata-community';
/** Approved first-release category, kind and onboarding fork metadata. */
export const GALLERY_METADATA = {
  ...COMMERCIAL_GALLERY_METADATA,
  ...COMMUNITY_GALLERY_METADATA,
} as const satisfies Readonly<
  Record<
    GallerySlug,
    {
      readonly name: string;
      readonly kind: 'task' | 'project' | 'program' | 'initiative';
      readonly category: GalleryCategory;
      readonly forks: readonly GalleryFork[];
    }
  >
>;
