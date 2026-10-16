'use client';
import type { JSX } from 'react';
import { useTypedRoute } from '@/lib/app-location';
import { GalleryWorkspace } from '@/components/templates/gallery/gallery-workspace';
import { GalleryBundlePage } from '@/components/templates/gallery/gallery-bundle-page';
/** Reopen one actual saved installation through current authorized draft state. */
export default function GalleryBundleRoute(): JSX.Element {
  const {
    params: { orgId, bundleId },
  } = useTypedRoute('/orgs/[orgId]/settings/templates/gallery/copies/[bundleId]');
  return (
    <GalleryWorkspace orgId={orgId}>
      <GalleryBundlePage bundleId={bundleId} />
    </GalleryWorkspace>
  );
}
