'use client';

/**
 * `components/canvas/project-graph-bar` — the floating bar over the Project dependencies canvas.
 *
 * @remarks
 * One row carries the title, the way back, the List and Dependencies switch, the live counts, and
 * the New project action. While something is selected the same row becomes the selection's bar,
 * so nothing floats over a card. Rendered inside the command provider so the selection's actions
 * can read the canvas commands.
 */
import { Plus } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import { transitionNameStyle } from '@/lib/view-transition';

import { BulkSelectionActions } from './bulk-actions-bar';
import { useCanvasCommandContext } from './canvas-command-context';
import CanvasFloatingBar from './canvas-floating-bar';

/** The chrome a Project dependencies host names for the bar. */
export interface ProjectGraphChrome {
  /** The vocabulary title the bar carries. */
  readonly title: string;
  /** A `view-transition-name` on the title, so the page that names the same text morphs into it. */
  readonly titleTransitionName?: string | undefined;
  /** A `view-transition-name` on New project, so the page's own button morphs into it. */
  readonly createTransitionName?: string | undefined;
  /** The way back: an icon button before the title. */
  readonly navigation?: ReactNode;
  /** The List and Dependencies switch beside the title. */
  readonly lensSwitch?: ReactNode;
}

/** What the bar counts. */
export interface ProjectGraphCounts {
  readonly projects: number;
  readonly dependencies: number;
}

/** Props for {@link ProjectGraphBar}. */
export interface ProjectGraphBarProps {
  readonly chrome: ProjectGraphChrome;
  readonly counts: ProjectGraphCounts;
  /** Open Project creation; omitted for a viewer who cannot contribute. */
  readonly onCreate?: ((returnFocusTo: HTMLElement) => void) | undefined;
  /** Pixels a floating inspector covers at the right edge. */
  readonly insetRight: number;
  readonly onHeightChange: (height: number) => void;
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
  chrome,
  counts,
  onCreate,
  insetRight,
  onHeightChange,
}: ProjectGraphBarProps): JSX.Element {
  const commands = useCanvasCommandContext();
  const selection =
    commands !== null && commands.selectedObjects.length > 0 ? (
      <BulkSelectionActions commands={commands} />
    ) : null;
  return (
    <CanvasFloatingBar
      title={chrome.title}
      titleTransitionName={chrome.titleTransitionName}
      ariaLabel="Project dependencies"
      navigation={chrome.navigation}
      controls={chrome.lensSwitch}
      trailing={<ProjectGraphCountsLabel counts={counts} />}
      selection={selection}
      actions={
        onCreate === undefined ? undefined : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label="New project"
            style={transitionNameStyle(chrome.createTransitionName)}
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
