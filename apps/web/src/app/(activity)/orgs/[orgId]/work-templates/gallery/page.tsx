'use client';
import type { JSX } from 'react';
import { WorkTemplateGalleryQuery } from '@docket/work/template-gallery-contract';
import { useAppSearchParams, useTypedRoute } from '@/lib/app-location';
import { GalleryWorkspace } from '@/components/templates/gallery/gallery-workspace';
import { GalleryBrowsePage } from '@/components/templates/gallery/gallery-browse-page';
/** Choose actual organizational starting work through current released catalog metadata. */
export default function GalleryPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/work-templates/gallery');
  const search = useAppSearchParams();
  const fork = WorkTemplateGalleryQuery.shape.fork.safeParse(search.get('fork'));
  return (
    <GalleryWorkspace orgId={orgId} initialFork={fork.success ? fork.data : undefined}>
      <GalleryBrowsePage />
    </GalleryWorkspace>
  );
}
