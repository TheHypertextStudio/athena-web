'use client';

import type { ProjectViewRow } from '@docket/work/work-view-contract';
import type { JSX } from 'react';

import type { AppliedView } from '@/components/views/apply-view';
import type { ViewDisplayState } from '@/components/views/field-catalog';
import type { ScheduleChange } from '@/components/timeline/cascade';
import TimelineCanvas from '@/components/timeline/timeline-canvas';
import {
  resolveSpan,
  type TimelineCatalog,
  type TimelineSpan,
  type TimelineTint,
} from '@/components/timeline/timeline-catalog';
import { parseDate } from '@/components/timeline/time-scale';
import { useTimelineViewport } from '@/components/timeline/use-timeline-viewport';

import { isRouteOwnedDirectWorkViewRow, workViewRowInteractionPolicy } from './work-view-object';
import type {
  ProjectTimelineScheduleChange,
  ProjectTimelineSubject,
} from './use-project-timeline-mutations';

function tint(health: ProjectViewRow['health']): TimelineTint {
  if (health === 'on_track') return 'positive';
  if (health === 'at_risk') return 'caution';
  if (health === 'off_track') return 'critical';
  return 'neutral';
}

/**
 * Build the shared timeline projection for Project rows in one route organization.
 *
 * @param routeOrganizationId - The organization whose direct Projects this route renders.
 * @param canSchedule - Whether the route user may schedule or drag direct Projects.
 * @returns A timeline catalog with route ownership and capability applied to every interaction.
 */
export function buildProjectViewTimelineCatalog(
  routeOrganizationId: string,
  canSchedule = true,
): TimelineCatalog<ProjectViewRow> {
  return {
    id: (row) => row.id,
    label: (row) => row.name,
    sublabel: () => null,
    href: (row) => `/orgs/${row.organizationId}/projects/${row.id}`,
    span: (row) => resolveSpan(parseDate(row.startDate), parseDate(row.targetDate)),
    schedulable: (row) => canSchedule && isRouteOwnedDirectWorkViewRow(row, routeOrganizationId),
    markers: (row) =>
      row.milestones.flatMap((milestone) => {
        const at = parseDate(milestone.targetDate);
        return at === null ? [] : [{ id: milestone.id, name: milestone.name, at }];
      }),
    tint: (row) => tint(row.health),
    progress: (row) => row.progress,
    edges: (row) => ({ blockedBy: row.blockedByIds, blocks: row.blocksIds }),
    statusLabel: (row) => row.status.replaceAll('_', ' '),
    interaction: (row) => workViewRowInteractionPolicy(row, routeOrganizationId, canSchedule),
  };
}

/**
 * Attach the route owner to writable Project cascade changes and discard context rows.
 *
 * @param rows - Project rows rendered in the route timeline.
 * @param routeOrganizationId - The organization whose schedule may be edited.
 * @param changes - Generic changes proposed by the shared timeline engine.
 * @returns only changes for direct Projects owned by the route organization.
 */
export function routeOwnedProjectScheduleChanges(
  rows: readonly ProjectViewRow[],
  routeOrganizationId: string,
  changes: readonly ScheduleChange[],
): readonly ProjectTimelineScheduleChange[] {
  const rowsById = new Map<string, ProjectViewRow>(rows.map((row) => [row.id, row]));
  return changes.flatMap((change) => {
    const row = rowsById.get(change.id);
    return row !== undefined && isRouteOwnedDirectWorkViewRow(row, routeOrganizationId)
      ? [{ ...change, organizationId: routeOrganizationId }]
      : [];
  });
}

/** Props for the Project work-view timeline adapter. */
export interface ProjectTimelineAdapterProps {
  /** Organization whose timeline route owns schedule writes. */
  readonly organizationId: string;
  readonly rows: readonly ProjectViewRow[];
  readonly density: 'comfortable' | 'compact';
  readonly canSchedule: boolean;
  readonly onReschedule: (project: ProjectTimelineSubject, span: TimelineSpan) => void;
  readonly onApplyCascade: (changes: readonly ProjectTimelineScheduleChange[]) => void;
  readonly applyingCascade: boolean;
  readonly onActivate: (id: string) => void;
  readonly onPrefetch: (id: string) => void;
}

/** Render typed Project rows through the existing timeline engine. */
export function ProjectTimelineAdapter({
  organizationId,
  rows,
  density,
  canSchedule,
  onReschedule,
  onApplyCascade,
  applyingCascade,
  onActivate,
  onPrefetch,
}: ProjectTimelineAdapterProps): JSX.Element {
  const catalog = buildProjectViewTimelineCatalog(organizationId, canSchedule);
  const applied: AppliedView<ProjectViewRow> = { rows, groups: null };
  const spans = rows.flatMap((row) => {
    const span = catalog.span(row);
    return span ? [span] : [];
  });
  const display: ViewDisplayState = { density, progress: true, markers: true, scale: 'auto' };
  const viewport = useTimelineViewport(spans, display.scale);
  return (
    <TimelineCanvas
      applied={applied}
      catalog={catalog}
      display={display}
      viewport={viewport}
      noun="Project"
      pluralNoun="Projects"
      canSchedule={canSchedule}
      fullBleed
      onReschedule={(id, span) => {
        const row = rows.find((candidate) => candidate.id === id);
        if (row !== undefined && isRouteOwnedDirectWorkViewRow(row, organizationId)) {
          onReschedule({ id, organizationId }, span);
        }
      }}
      onApplyCascade={(changes: readonly ScheduleChange[]) => {
        onApplyCascade(routeOwnedProjectScheduleChanges(rows, organizationId, changes));
      }}
      applyingCascade={applyingCascade}
      onActivate={onActivate}
      onPrefetch={onPrefetch}
    />
  );
}
