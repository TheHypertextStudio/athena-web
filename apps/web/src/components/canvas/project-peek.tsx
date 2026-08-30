'use client';

/**
 * `components/canvas/project-peek` — what selecting a project on the dependency canvas tells you.
 *
 * @remarks
 * Clicking a card used to do exactly one thing: draw a ring around it. Selection with no content
 * is the canvas admitting it has nothing to say — you clicked a thing and learned that you had
 * clicked it. This is the answer to "what is this project", read straight off the portfolio row
 * the canvas already has in memory: its status and health, who leads it, when it runs, how far
 * along it is, and — the reason someone is on *this* lens rather than the list — everything it is
 * waiting on and everything waiting on it.
 *
 * Dependencies are split into upstream and downstream and each one is a button, so the panel is
 * also how you walk the graph: select a blocker, read it, keep going. A neighbour outside the
 * current filter is still listed (a hidden blocker is the most dangerous kind) but is not
 * selectable, because the canvas has no node to move the selection to.
 *
 * It is a docked column beside the canvas rather than a card floating over it, so reading it costs
 * width instead of costing the part of the diagram nearest the node you just clicked. On a host too
 * narrow for a column it covers the canvas instead — see {@link GraphInspectorHost}.
 */
import type { Health, ProjectOverviewItem, ProjectStatus } from '@docket/types';
import { ArrowRight } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import Link from '@/components/docket-link';
import type { JSX } from 'react';

import { HEALTH_FILL_CLASS, HEALTH_LABEL } from '@/components/entity-display/health';
import { useWorkStatus, useWorkStatusResolver } from '@/components/entity-display/use-work-status';
import { WorkStatusBadge } from '@/components/entity-display/work-status';
import { formatCalendarDate } from '@/lib/format-date';

import { CanvasInspector } from './canvas-inspector';

/** One neighbouring project in the dependency lists. */
export interface ProjectPeekNeighbor {
  /** The neighbour's id. */
  readonly id: string;
  /** The neighbour's name. */
  readonly name: string;
  /** The neighbour's lifecycle status. */
  readonly status: ProjectStatus;
  /** Whether the neighbour is on the canvas, and therefore selectable. */
  readonly onCanvas: boolean;
}

/** Props for {@link ProjectPeek}. */
export interface ProjectPeekProps {
  /** The selected portfolio row. */
  readonly project: ProjectOverviewItem;
  /** The owning org id, for the "open project" link. */
  readonly orgId: string;
  /** The project lead's display name, or `null` when unset or unresolvable. */
  readonly leadName: string | null;
  /** Projects this one is waiting on. */
  readonly blockedBy: readonly ProjectPeekNeighbor[];
  /** Projects waiting on this one. */
  readonly blocks: readonly ProjectPeekNeighbor[];
  /** Move the selection to another project on the canvas. */
  readonly onSelect: (id: string) => void;
  /** Dismiss the panel. */
  readonly onClose: () => void;
}

/** One labelled property line — always rendered, so the panel's height does not jitter. */
function Property({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-on-surface-variant text-label-medium shrink-0">{label}</span>
      <span className="text-on-surface text-body-small min-w-0 truncate text-right">
        {children}
      </span>
    </div>
  );
}

/** A dependency list, or nothing when this project has no edge in that direction. */
function NeighborList({
  label,
  neighbors,
  onSelect,
}: {
  label: string;
  neighbors: readonly ProjectPeekNeighbor[];
  onSelect: (id: string) => void;
}): JSX.Element {
  const statusOf = useWorkStatusResolver('project');

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-on-surface-variant text-label-medium">{label}</span>
      {neighbors.length === 0 ? (
        <span className="text-on-surface-variant text-body-small">None</span>
      ) : (
        neighbors.map((neighbor) => {
          const status = statusOf(neighbor.status);
          return (
            <button
              key={neighbor.id}
              type="button"
              disabled={!neighbor.onCanvas}
              onClick={() => {
                onSelect(neighbor.id);
              }}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left',
                neighbor.onCanvas
                  ? 'hover:bg-surface-container-high cursor-pointer'
                  : 'cursor-default opacity-60',
              )}
            >
              <WorkStatusBadge name={status.name} category={status.category} />
              <span className="text-on-surface text-body-small min-w-0 truncate">
                {neighbor.name}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

/**
 * The dependency canvas's selection inspector for a project.
 *
 * @param props - The {@link ProjectPeekProps}.
 * @returns the rendered panel.
 */
export default function ProjectPeek({
  project,
  orgId,
  leadName,
  blockedBy,
  blocks,
  onSelect,
  onClose,
}: ProjectPeekProps): JSX.Element {
  const projectStatus = useWorkStatus('project', project.status);
  const health: Health | null = project.health ?? null;
  const percent =
    project.taskCount === 0
      ? 0
      : Math.round((project.completedTaskCount / project.taskCount) * 100);
  const start = formatCalendarDate(project.startDate, { month: 'short', day: 'numeric' });
  const target = formatCalendarDate(project.targetDate, { month: 'short', day: 'numeric' });

  return (
    <CanvasInspector title={project.name} closeLabel="Close project details" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {project.summary ? (
          <p className="text-on-surface-variant text-body-small line-clamp-3">{project.summary}</p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Property label="Status">
            <WorkStatusBadge name={projectStatus.name} category={projectStatus.category} />
          </Property>
          <Property label="Health">
            {health === null ? (
              <span className="text-on-surface-variant">Not set</span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn('size-2 rounded-full', HEALTH_FILL_CLASS[health])}
                />
                {HEALTH_LABEL[health]}
              </span>
            )}
          </Property>
          <Property label="Lead">
            {leadName ?? <span className="text-on-surface-variant">Unassigned</span>}
          </Property>
          <Property label="Dates">
            <span className="tabular-nums">
              {start === null && target === null ? (
                <span className="text-on-surface-variant">Not scheduled</span>
              ) : (
                `${start ?? '—'} → ${target ?? '—'}`
              )}
            </span>
          </Property>
          <Property label="Tasks">
            <span className="tabular-nums">
              {project.completedTaskCount} of {project.taskCount} done ({percent}%)
            </span>
          </Property>
        </div>

        <NeighborList label="Waiting on" neighbors={blockedBy} onSelect={onSelect} />
        <NeighborList label="Blocking" neighbors={blocks} onSelect={onSelect} />

        <Button asChild size="sm" variant="outline" className="gap-1.5 self-start">
          <Link href={`/orgs/${orgId}/projects/${project.id}`}>
            Open project <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </CanvasInspector>
  );
}
