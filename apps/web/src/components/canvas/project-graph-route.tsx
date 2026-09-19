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
import { useOwnPageScroll, useShellSidebar } from '@docket/ui/components';
import { ChevronLeft } from '@docket/ui/icons';
import {
  Button,
  Skeleton,
  Surface,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import { type JSX, type ReactNode, useEffect } from 'react';

import CanvasFloatingBar from '@/components/canvas/canvas-floating-bar';
import { CANVAS_COMPACT_SIDEBAR_BELOW_PX } from '@/components/canvas/canvas-floating-chrome';
import { ProjectGraphPanel } from '@/components/canvas/project-graph-panel';
import DocketLink from '@/components/docket-link';
import { LoadFailure } from '@/components/feedback';
import {
  PROJECT_LENS_COPY,
  ProjectLensSwitch,
  projectRosterHref,
} from '@/components/work-views/project-lens-frame';
import { projectOverviewDef } from '@/lib/fetch-project-overview';
import { useApiQuery } from '@/lib/query';

/** The sidebar drops to its icon rail on any window narrower than this while the canvas is open. */
function useCompactSidebar(): void {
  const { requestCompact } = useShellSidebar();
  useEffect(() => {
    if (window.innerWidth >= CANVAS_COMPACT_SIDEBAR_BELOW_PX) return undefined;
    return requestCompact();
  }, [requestCompact]);
}

/** The way back to the roster. */
function BackToProjects({ orgId }: { readonly orgId: string }): JSX.Element {
  const label = `Back to ${PROJECT_LENS_COPY.title.toLowerCase()}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" iconOnly asChild aria-label={label}>
          <DocketLink href={projectRosterHref(orgId)}>
            <ChevronLeft aria-hidden="true" />
          </DocketLink>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

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
      <CanvasFloatingBar
        title={PROJECT_LENS_COPY.title}
        ariaLabel="Project dependencies"
        navigation={<BackToProjects orgId={orgId} />}
        controls={<ProjectLensSwitch orgId={orgId} />}
      />
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
  useCompactSidebar();
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
        <LoadFailure
          title={PROJECT_LENS_COPY.title}
          error={query.error}
          retrying={query.isFetching}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </ProjectGraphState>
    );
  }
  return (
    <Surface tone="page" shape="none" className="flex h-full min-h-0 w-full flex-col">
      <ProjectGraphPanel
        rows={rows}
        orgId={orgId}
        chrome={{
          title: PROJECT_LENS_COPY.title,
          navigation: <BackToProjects orgId={orgId} />,
          lensSwitch: <ProjectLensSwitch orgId={orgId} />,
        }}
      />
    </Surface>
  );
}
