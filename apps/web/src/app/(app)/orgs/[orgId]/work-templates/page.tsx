'use client';
import type { JSX } from 'react';
import { WorkTemplatesWorkspace } from '@/components/templates/work-templates-workspace';
import { useTypedRoute } from '@/lib/app-location';

/** The workspace's versioned work-template library. */
export default function WorkTemplatesPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/work-templates');
  return <WorkTemplatesWorkspace orgId={orgId} />;
}
