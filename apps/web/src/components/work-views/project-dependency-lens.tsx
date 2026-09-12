'use client';

import { Skeleton } from '@docket/ui/primitives';
import dynamic from 'next/dynamic';
import { type JSX, useEffect, useState } from 'react';

import { projectOverviewDef } from '@/lib/fetch-project-overview';
import { useApiQuery } from '@/lib/query';

import { WorkViewLoadFailure } from './work-view-load-failure';

const ProjectGraphPanel = dynamic(
  () =>
    import('@/components/canvas/project-graph-panel').then((module) => module.ProjectGraphPanel),
  { ssr: false },
);

/** Props for the retained Project-only dependency lens. */
export interface ProjectDependencyLensProps {
  readonly organizationId: string;
  /** Surface title used by the shared recovery state, owned by the host's page copy. */
  readonly title: string;
  /**
   * Recover from a failed load. The host owns this because the lens is one of several reads that
   * fail together, and a retry that repaired only this one would leave the rest broken.
   */
  readonly onRetry: () => void;
  /** A newly created Project that should open once the invalidated overview refreshes. */
  readonly requestedSelectionId?: string | null | undefined;
  /** Notify the host after the requested Project is present and selected. */
  readonly onRequestedSelectionResolved?: ((id: string) => void) | undefined;
  /** Notify the host when a settled refresh still excludes the created Project. */
  readonly onRequestedSelectionMissing?: ((id: string) => void) | undefined;
  /** Incremented by the host when clearing filters should retry the same Project id. */
  readonly requestedSelectionAttempt?: number | undefined;
  /** Route canvas creation through the retained Project work-view host. */
  readonly onCreateProject?: ((returnFocusTo?: HTMLElement | null) => void) | undefined;
}

/** Load the dependency projection only after the viewer opens its dedicated lens. */
export function ProjectDependencyLens({
  organizationId,
  title,
  onRetry,
  requestedSelectionId = null,
  onRequestedSelectionResolved,
  onRequestedSelectionMissing,
  requestedSelectionAttempt = 0,
  onCreateProject,
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

  const rows = query.data?.items;
  // placeholder: the dependency graph — which projects block which, and in what order.
  if (query.isPending) return <Skeleton className="h-full min-h-80 w-full" />;
  // A failed refresh never blanks a graph the viewer can still read, which is the same contract
  // `WorkViewLoadFailure` states for roster rows. Only a lens with nothing to show yields the
  // content area to the recovery state.
  if (rows === undefined) {
    return (
      <WorkViewLoadFailure
        title={title}
        error={query.error}
        retrying={query.isFetching}
        onRetry={onRetry}
      />
    );
  }
  return (
    <ProjectGraphPanel
      rows={rows}
      orgId={organizationId}
      requestedSelectionId={requestedSelectionId}
      onRequestedSelectionResolved={onRequestedSelectionResolved}
      requestedSelectionSettled={
        settledSelection?.id === requestedSelectionId &&
        settledSelection.attempt === requestedSelectionAttempt
      }
      onRequestedSelectionMissing={onRequestedSelectionMissing}
      onCreateProject={onCreateProject}
    />
  );
}
