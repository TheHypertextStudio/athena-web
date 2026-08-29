'use client';

import type { ProjectViewRow } from '@docket/types';
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

/** Build the shared timeline projection for a typed Project view row. */
export function buildProjectViewTimelineCatalog(): TimelineCatalog<ProjectViewRow> {
  return {
    id: (row) => row.id,
    label: (row) => row.name,
    sublabel: () => null,
    href: (row) => `/orgs/${row.organizationId}/projects/${row.id}`,
    span: (row) => resolveSpan(parseDate(row.startDate), parseDate(row.targetDate)),
    markers: (row) =>
      row.milestones.flatMap((milestone) => {
        const at = parseDate(milestone.targetDate);
        return at === null ? [] : [{ id: milestone.id, name: milestone.name, at }];
      }),
    tint: (row) => tint(row.health),
    progress: (row) => row.progress,
    edges: (row) => ({ blockedBy: row.blockedByIds, blocks: row.blocksIds }),
    statusLabel: (row) => row.status.replaceAll('_', ' '),
    object: (row) => ({
      kind: 'project',
      id: row.id,
      organizationId: row.organizationId,
      title: row.name,
    }),
  };
}

/** Props for the Project work-view timeline adapter. */
export interface ProjectTimelineAdapterProps {
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
  rows,
  density,
  canSchedule,
  onReschedule,
  onApplyCascade,
  applyingCascade,
  onActivate,
  onPrefetch,
}: ProjectTimelineAdapterProps): JSX.Element {
  const catalog = buildProjectViewTimelineCatalog();
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
        if (row !== undefined) {
          onReschedule({ id, organizationId: row.organizationId }, span);
        }
      }}
      onApplyCascade={(changes: readonly ScheduleChange[]) => {
        const ownedChanges = changes.flatMap((change) => {
          const row = rows.find((candidate) => candidate.id === change.id);
          return row === undefined
            ? []
            : [
                {
                  ...change,
                  organizationId: row.organizationId,
                } satisfies ProjectTimelineScheduleChange,
              ];
        });
        onApplyCascade(ownedChanges);
      }}
      applyingCascade={applyingCascade}
      onActivate={onActivate}
      onPrefetch={onPrefetch}
    />
  );
}
