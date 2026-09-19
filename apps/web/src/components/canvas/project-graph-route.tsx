'use client';

/**
 * `components/canvas/project-graph-route` — the body of the Project dependencies page.
 *
 * @remarks
 * The page owns its scroll and runs the canvas edge to edge, so the sidebar drops to its icon rail
 * on most windows and the floating bar carries everything a band used to. The bar renders in every
 * state, so the way back and the List switch are always there: over a placeholder while the
 * overview loads, over the recovery state when it fails, and over the canvas once it arrives. A
 * failed refresh never blanks a graph the viewer can still read; only a page with nothing to draw
 * yields to the recovery state. The canvas is imported statically: the route's own chunk carries
 * React Flow, so a warmed route mounts the bar and the canvas in one commit.
 */
import { useOwnPageScroll } from '@docket/ui/components';
import { Skeleton, Surface } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import { useCompactSidebarWhileMounted } from '@/components/canvas/canvas-floating-chrome';
import { ProjectGraphBar } from '@/components/canvas/project-graph-bar';
import { ProjectGraphPanel } from '@/components/canvas/project-graph-panel';
import { QueryLoadFailure } from '@/components/feedback';
import { PROJECT_LENS_COPY } from '@/components/work-views/project-lens-frame';
import { projectOverviewDef } from '@/lib/fetch-project-overview';
import { useApiQuery } from '@/lib/query';

/** The page while there is no graph to draw: the floating bar over a placeholder or a recovery. */
function ProjectGraphState({
  orgId,
  children,
}: {
  readonly orgId: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Surface tone="page" shape="none" className="relative flex h-full min-h-0 w-full flex-col">
      <ProjectGraphBar orgId={orgId} />
      {children}
    </Surface>
  );
}

/** Props for {@link ProjectGraphRoute}. */
export interface ProjectGraphRouteProps {
  /** The workspace whose Projects the canvas draws. */
  readonly orgId: string;
}

/** The Project dependencies page: the overview query, and the state it is in. */
export function ProjectGraphRoute({ orgId }: ProjectGraphRouteProps): JSX.Element {
  useOwnPageScroll();
  useCompactSidebarWhileMounted();
  const query = useApiQuery(projectOverviewDef(orgId));
  const rows = query.data?.items;
  // placeholder: the dependency graph — which projects block which, and in what order.
  if (query.isPending) {
    return (
      <ProjectGraphState orgId={orgId}>
        <Skeleton className="absolute inset-2 rounded-lg" />
      </ProjectGraphState>
    );
  }
  if (rows === undefined) {
    return (
      <ProjectGraphState orgId={orgId}>
        <QueryLoadFailure title={PROJECT_LENS_COPY.title} query={query} />
      </ProjectGraphState>
    );
  }
  return (
    <Surface tone="page" shape="none" className="flex h-full min-h-0 w-full flex-col">
      <ProjectGraphPanel rows={rows} orgId={orgId} />
    </Surface>
  );
}
