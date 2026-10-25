'use client';
import type { JSX } from 'react';
import { useTypedRoute } from '@/lib/app-location';
import { GalleryWorkspace } from '@/components/templates/gallery/gallery-workspace';
import { GalleryEntryPage } from '@/components/templates/gallery/gallery-entry-page';
/** Inspect actual included and recurring work in one released definition. */
export default function GalleryDetailPage(): JSX.Element {
  const {
    params: { orgId, slug },
  } = useTypedRoute('/orgs/[orgId]/work-templates/gallery/[slug]');
  return (
    <GalleryWorkspace orgId={orgId}>
      <GalleryEntryPage slug={slug} />
    </GalleryWorkspace>
  );
}
