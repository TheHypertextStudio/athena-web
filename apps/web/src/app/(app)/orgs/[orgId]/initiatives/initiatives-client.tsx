'use client';

import type { JSX } from 'react';

import { WorkViewPage } from '@/components/work-views/work-view-page';
import { useTypedRoute } from '@/lib/app-location';

/** Render the Initiative hierarchy through the typed server view system. */
export default function InitiativesClient(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/initiatives');
  return <WorkViewPage organizationId={orgId} target="initiative" />;
}
