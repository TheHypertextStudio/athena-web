'use client';

import type { JSX } from 'react';

import { WorkViewPage } from '@/components/work-views/work-view-page';
import { useTypedRoute } from '@/lib/app-location';

/** Render the organization Program roster through the typed server view system. */
export default function ProgramsListClient(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/programs');
  return <WorkViewPage organizationId={orgId} target="program" />;
}
