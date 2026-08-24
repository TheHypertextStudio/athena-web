'use client';

import type { InitiativeViewRow } from '@docket/types';
import type { JSX } from 'react';

import type { AppliedView } from '@/components/views/apply-view';
import type { ViewDisplayState } from '@/components/views/field-catalog';
import TimelineCanvas from '@/components/timeline/timeline-canvas';
import {
  type TimelineCatalog,
  type TimelineSpan,
  type TimelineTint,
} from '@/components/timeline/timeline-catalog';
import { parseDate } from '@/components/timeline/time-scale';
import { useTimelineViewport } from '@/components/timeline/use-timeline-viewport';

function tint(health: InitiativeViewRow['health']): TimelineTint {
  if (health === 'on_track') return 'positive';
  if (health === 'at_risk') return 'caution';
  if (health === 'off_track') return 'critical';
  return 'neutral';
}

function initiativeSpan(row: InitiativeViewRow): TimelineSpan | null {
  const starts = row.contributingProjects
    .map((project) => parseDate(project.startDate))
    .filter((value): value is number => value !== null);
  const ends = row.contributingProjects
    .flatMap((project) => [parseDate(project.targetDate), parseDate(project.startDate)])
    .filter((value): value is number => value !== null);
  if (starts.length > 0 || ends.length > 0) {
    const all = [...starts, ...ends];
    return { start: Math.min(...all), end: Math.max(...all) };
  }
  const target = parseDate(row.targetDate);
  return target === null ? null : { start: target, end: target };
}

/** Build an Initiative timeline whose span and markers come from contributing Projects. */
export function buildInitiativeTimelineCatalog(
  organizationId: string,
): TimelineCatalog<InitiativeViewRow> {
  return {
    id: (row) => row.id,
    label: (row) => row.name,
    sublabel: (row) => (row.isContext ? 'Context' : null),
    href: (row) => `/orgs/${organizationId}/initiatives/${row.id}`,
    span: initiativeSpan,
    markers: (row) =>
      row.contributingProjects.flatMap((project) => {
        const at = parseDate(project.targetDate);
        return at === null ? [] : [{ id: project.id, name: project.name, at }];
      }),
    tint: (row) => tint(row.health),
    progress: (row) => {
      if (row.contributingProjects.length === 0) return null;
      return (
        row.contributingProjects.reduce((sum, project) => sum + project.progress, 0) /
        row.contributingProjects.length
      );
    },
    edges: () => ({ blockedBy: [], blocks: [] }),
    statusLabel: (row) => row.status.replaceAll('_', ' '),
    object: (row) =>
      row.isContext
        ? null
        : ({
            kind: 'initiative',
            id: row.id,
            organizationId: row.organizationId,
            title: row.name,
            meta: { parentInitiativeId: row.parent, parentLinkId: null },
          } as const),
  };
}

/** Props for the read-only Initiative rollup timeline. */
export interface InitiativeTimelineProps {
  readonly organizationId: string;
  readonly rows: readonly InitiativeViewRow[];
  readonly density: 'comfortable' | 'compact';
  readonly onActivate: (id: string) => void;
  readonly onPrefetch: (id: string) => void;
}

/** Render Initiative rollups without inventing an Initiative start-date mutation. */
export function InitiativeTimeline({
  organizationId,
  rows,
  density,
  onActivate,
  onPrefetch,
}: InitiativeTimelineProps): JSX.Element {
  const catalog = buildInitiativeTimelineCatalog(organizationId);
  const applied: AppliedView<InitiativeViewRow> = { rows, groups: null };
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
      noun="Initiative"
      pluralNoun="Initiatives"
      canSchedule={false}
      fullBleed
      onReschedule={() => undefined}
      onApplyCascade={() => undefined}
      applyingCascade={false}
      onActivate={onActivate}
      onPrefetch={onPrefetch}
    />
  );
}
