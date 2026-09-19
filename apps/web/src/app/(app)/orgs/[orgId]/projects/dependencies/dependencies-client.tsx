'use client';

import type { JSX } from 'react';

import { ProjectGraphRoute } from '@/components/canvas/project-graph-route';
import { useTypedRoute } from '@/lib/app-location';

/** Render the Project dependencies canvas for the workspace named in the URL. */
export default function ProjectDependenciesClient(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/projects/dependencies');
  return <ProjectGraphRoute orgId={orgId} />;
}
