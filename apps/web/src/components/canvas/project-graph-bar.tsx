'use client';

/**
 * `components/canvas/project-graph-bar` — the floating bar over the Project dependencies canvas.
 *
 * @remarks
 * One row carries the title, the way back, the List and Dependencies switch, the live counts, and
 * the New project action. While something is selected the same row becomes the selection's bar,
 * so nothing floats over a card. The bar composes its fixed pieces from the workspace id, so the
 * loading and failure states render the same bar the canvas does. Rendered inside the command
 * provider once a canvas exists, so the selection's actions can read the canvas commands.
 */
import { ChevronLeft, Plus } from '@docket/ui/icons';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@docket/ui/primitives';
import type { JSX } from 'react';

import DocketLink from '@/components/docket-link';
import {
  PROJECT_LENS_COPY,
  PROJECT_LENS_TRANSITION,
  ProjectLensSwitch,
  projectRosterHref,
} from '@/components/work-views/project-lens-frame';
import { transitionNameStyle } from '@/lib/view-transition';

import { BulkSelectionActions } from './bulk-actions-bar';
import { useCanvasCommandContext } from './canvas-command-context';
import CanvasFloatingBar from './canvas-floating-bar';

/** What the bar counts. */
export interface ProjectGraphCounts {
  readonly projects: number;
  readonly dependencies: number;
}

/** Props for {@link ProjectGraphBar}. */
export interface ProjectGraphBarProps {
  /** The workspace whose roster the way back and the List segment open. */
  readonly orgId: string;
  /** The live counts; omitted while there is no graph to count. */
  readonly counts?: ProjectGraphCounts;
  /** Open Project creation; omitted for a viewer who cannot contribute. */
  readonly onCreate?: ((returnFocusTo: HTMLElement) => void) | undefined;
  /** Pixels a floating inspector covers at the right edge. */
  readonly insetRight?: number;
  /** Receives the bar's measured height. */
  readonly onHeightChange?: (height: number) => void;
}

/** The way back to the roster. */
function BackToProjects({ orgId }: { readonly orgId: string }): JSX.Element {
  const label = `Back to ${PROJECT_LENS_COPY.title.toLowerCase()}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" iconOnly asChild aria-label={label}>
          <DocketLink href={projectRosterHref(orgId)} transition="shared-element">
            <ChevronLeft aria-hidden="true" />
          </DocketLink>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * "3 projects · 2 dependencies". The label appears once the bar has room beside the title and the
 * switch, and its second half once the bar is wide.
 */
function ProjectGraphCountsLabel({ counts }: { readonly counts: ProjectGraphCounts }): JSX.Element {
  return (
    <span className="text-on-surface-variant text-label-medium hidden shrink-0 whitespace-nowrap @lg:inline">
      {counts.projects} {counts.projects === 1 ? 'project' : 'projects'}
      <span className="hidden @2xl:inline">
        {' · '}
        {counts.dependencies} {counts.dependencies === 1 ? 'dependency' : 'dependencies'}
      </span>
    </span>
  );
}

/** The floating chrome row over the Project dependencies canvas. */
export function ProjectGraphBar({
  orgId,
  counts,
  onCreate,
  insetRight = 0,
  onHeightChange,
}: ProjectGraphBarProps): JSX.Element {
  const commands = useCanvasCommandContext();
  const selection =
    commands !== null && commands.selectedObjects.length > 0 ? (
      <BulkSelectionActions commands={commands} />
    ) : null;
  return (
    <CanvasFloatingBar
      title={PROJECT_LENS_COPY.title}
      titleTransitionName={PROJECT_LENS_TRANSITION.title}
      ariaLabel="Project dependencies"
      navigation={<BackToProjects orgId={orgId} />}
      controls={<ProjectLensSwitch orgId={orgId} />}
      trailing={counts === undefined ? undefined : <ProjectGraphCountsLabel counts={counts} />}
      selection={selection}
      actions={
        onCreate === undefined ? undefined : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label="New project"
            style={transitionNameStyle(PROJECT_LENS_TRANSITION.create)}
            onClick={(event) => {
              onCreate(event.currentTarget);
            }}
          >
            <Plus aria-hidden className="size-4" />
            <span className="hidden @lg:inline">New project</span>
          </Button>
        )
      }
      onClearSelection={commands?.clearSelection}
      insetRight={insetRight}
      onHeightChange={onHeightChange}
    />
  );
}
