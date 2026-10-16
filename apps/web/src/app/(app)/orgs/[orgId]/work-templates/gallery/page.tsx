'use client';
import type { JSX } from 'react';
import { useTypedRoute } from '@/lib/app-location';
import { GalleryWorkspace } from '@/components/templates/gallery/gallery-workspace';
import { GalleryBrowsePage } from '@/components/templates/gallery/gallery-browse-page';
/** Choose actual organizational starting work through current released catalog metadata. */
export default function GalleryPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/work-templates/gallery');
  return (
    <GalleryWorkspace orgId={orgId}>
      <GalleryBrowsePage />
    </GalleryWorkspace>
  );
}
