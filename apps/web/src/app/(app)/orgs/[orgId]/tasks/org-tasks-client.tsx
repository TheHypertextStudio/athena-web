'use client';

import type { JSX } from 'react';

import { WorkViewPage } from '@/components/work-views/work-view-page';
import { useTypedRoute } from '@/lib/app-location';

/** Render the organization Task roster through the typed server view system. */
export default function OrgTasksClient(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/tasks');
  return <WorkViewPage organizationId={orgId} target="task" />;
}
