'use client';

import { Skeleton } from '@docket/ui/primitives';
import dynamic from 'next/dynamic';
import { type JSX, useEffect, useState } from 'react';

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
  /** A newly created Project that should open once the invalidated overview refreshes. */
  readonly requestedSelectionId?: string | null | undefined;
  /** Notify the host after the requested Project is present and selected. */
  readonly onRequestedSelectionResolved?: ((id: string) => void) | undefined;
  /** Notify the host when a settled refresh still excludes the created Project. */
  readonly onRequestedSelectionMissing?: ((id: string) => void) | undefined;
  /** Incremented by the host when clearing filters should retry the same Project id. */
  readonly requestedSelectionAttempt?: number | undefined;
}

/** Load the dependency projection only after the viewer opens its dedicated lens. */
export function ProjectDependencyLens({
  organizationId,
  requestedSelectionId = null,
  onRequestedSelectionResolved,
  onRequestedSelectionMissing,
  requestedSelectionAttempt = 0,
}: ProjectDependencyLensProps): JSX.Element {
  const query = useApiQuery(projectOverviewDef(organizationId));
  const [settledSelection, setSettledSelection] = useState<{
    readonly id: string;
    readonly attempt: number;
  } | null>(null);
  const refetch = query.refetch;

  useEffect(() => {
    setSettledSelection(null);
    if (requestedSelectionId === null) return;
    let active = true;
    void refetch().then(() => {
      if (active) {
        setSettledSelection({ id: requestedSelectionId, attempt: requestedSelectionAttempt });
      }
    });
    return () => {
      active = false;
    };
  }, [refetch, requestedSelectionAttempt, requestedSelectionId]);

  if (query.isPending) return <Skeleton className="h-full min-h-80 w-full" />;
  if (query.isError) {
    return (
      <p role="alert" className="text-error text-body-medium p-4">
        {userErrorMessage(query.error, 'Could not load project dependencies.')}
      </p>
    );
  }
  return (
    <ProjectGraphPanel
      rows={query.data.items}
      orgId={organizationId}
      requestedSelectionId={requestedSelectionId}
      onRequestedSelectionResolved={onRequestedSelectionResolved}
      requestedSelectionSettled={
        settledSelection?.id === requestedSelectionId &&
        settledSelection.attempt === requestedSelectionAttempt
      }
      onRequestedSelectionMissing={onRequestedSelectionMissing}
    />
  );
}
