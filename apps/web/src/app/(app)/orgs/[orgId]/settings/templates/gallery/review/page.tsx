'use client';
import type { JSX } from 'react';
import { useTypedRoute } from '@/lib/app-location';
import { GalleryWorkspace } from '@/components/templates/gallery/gallery-workspace';
import { GalleryReviewPage } from '@/components/templates/gallery/gallery-review-page';
/** Explicitly review current destination and exact checked work before keeping or publishing copies. */
export default function GalleryReviewRoute(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/settings/templates/gallery/review');
  return (
    <GalleryWorkspace orgId={orgId}>
      <GalleryReviewPage />
    </GalleryWorkspace>
  );
}
