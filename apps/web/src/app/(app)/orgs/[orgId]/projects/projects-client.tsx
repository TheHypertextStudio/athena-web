'use client';

import type { JSX } from 'react';

import { WorkViewPage } from '@/components/work-views/work-view-page';
import { useAppParams } from '@/lib/app-location';

/** Render the organization Project roster through the typed server view system. */
export default function ProjectsListClient(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  return <WorkViewPage organizationId={orgId} target="project" />;
}
