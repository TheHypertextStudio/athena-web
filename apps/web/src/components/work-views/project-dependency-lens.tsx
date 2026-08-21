'use client';

import { Skeleton } from '@docket/ui/primitives';
import dynamic from 'next/dynamic';
import type { JSX } from 'react';

import { projectOverviewDef } from '@/lib/fetch-project-overview';
import { userErrorMessage } from '@/lib/problem';
import { useApiQuery } from '@/lib/query';

const ProjectGraphPanel = dynamic(
  () =>
    import('@/components/canvas/project-graph-panel').then((module) => module.ProjectGraphPanel),
  { ssr: false },
);

/** Props for the retained Project-only dependency lens. */
export interface ProjectDependencyLensProps {
  readonly organizationId: string;
}

/** Load the dependency projection only after the viewer opens its dedicated lens. */
export function ProjectDependencyLens({ organizationId }: ProjectDependencyLensProps): JSX.Element {
  const query = useApiQuery(projectOverviewDef(organizationId));
  if (query.isPending) return <Skeleton className="h-full min-h-80 w-full" />;
  if (query.isError) {
    return (
      <p role="alert" className="text-error text-body-medium p-4">
        {userErrorMessage(query.error, 'Could not load project dependencies.')}
      </p>
    );
  }
  return <ProjectGraphPanel rows={query.data.items} orgId={organizationId} />;
}
