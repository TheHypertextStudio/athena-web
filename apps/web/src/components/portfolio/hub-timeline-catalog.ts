/**
 * The Hub Portfolio's {@link TimelineCatalog} — how a cross-org Project bar plots on a time axis.
 *
 * @remarks
 * The portfolio is the shared timeline engine's **second consumer**, and that is the point: an
 * abstraction validated against one caller is just that caller's code with a type parameter. The
 * Hub exercises a materially different shape from the Projects lens — rows arrive pre-grouped by
 * organization rather than by a view field, health is a free-form wire string rather than a
 * checked enum, no dependency graph is available, and the surface is read-only — so anything the
 * engine had quietly assumed about Projects surfaces here.
 *
 * Like every catalog this is a pure projection with no state and no writes.
 */
import type { HubPortfolioSwimlane, HubProjectBar } from '@docket/types';

import {
  type TimelineCatalog,
  type TimelineMarker,
  type TimelineTint,
  resolveSpan,
} from '@/components/timeline/timeline-catalog';
import { parseDate } from '@/components/timeline/time-scale';
import { entityDragSource } from '@/lib/entity-drag';
import type { AppliedView } from '@/components/views/apply-view';

/**
 * A portfolio bar paired with the Program lane it sits in.
 *
 * @remarks
 * The Hub's nesting (org → program → project) is flattened to one level here, with the Program
 * carried alongside each bar so it can still be surfaced as row context. Flattening is what lets
 * the shared engine — whose layout model is a single ordered sequence of fixed-height tracks —
 * render the portfolio without special-casing it.
 */
export interface HubTimelineRow {
  /** The project bar. */
  readonly bar: HubProjectBar;
  /** The Program the bar is filed under, or `null` when it is program-less. */
  readonly programName: string | null;
}

/** Narrow the Hub's free-form health string onto the engine's domain-free tone vocabulary. */
function tintForHealth(health: string | null | undefined): TimelineTint {
  if (health === 'on_track') return 'positive';
  if (health === 'at_risk') return 'caution';
  if (health === 'off_track') return 'critical';
  return 'neutral';
}

/** Title-case a lifecycle status for display (Hub statuses are free-form per org). */
function statusLabel(status: string): string {
  if (status.length === 0) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

/**
 * Flatten the Hub's org swimlanes into an {@link AppliedView} the shared engine can render.
 *
 * @remarks
 * Each organization becomes one group band, so a tenant's slice of the roadmap stays contiguous
 * and never merges with another's — the property the bespoke swimlane implementation existed to
 * guarantee. Grouping is supplied by the caller rather than assumed by the engine, which is
 * exactly what lets two very different surfaces share one canvas.
 *
 * @param swimlanes - The `api.v1.hub.portfolio` swimlanes.
 * @param focusedOrgId - When set, restrict the view to that organization's band.
 * @returns the grouped rows, ready for the timeline canvas.
 */
export function buildHubTimelineView(
  swimlanes: readonly HubPortfolioSwimlane[],
  focusedOrgId: string | null,
): AppliedView<HubTimelineRow> {
  const groups = [];
  const all: HubTimelineRow[] = [];

  for (const swimlane of swimlanes) {
    if (focusedOrgId !== null && swimlane.organization.id !== focusedOrgId) continue;
    const rows: HubTimelineRow[] = [];
    // Program-less work leads the band, then each Program's projects in lane order.
    for (const bar of swimlane.unassigned) rows.push({ bar, programName: null });
    for (const lane of swimlane.programs) {
      for (const bar of lane.projects) rows.push({ bar, programName: lane.program.name });
    }
    if (rows.length === 0) continue;
    all.push(...rows);
    groups.push({ id: swimlane.organization.id, label: swimlane.organization.name, rows });
  }

  return { rows: all, groups };
}

/**
 * Build the Hub Portfolio timeline catalog.
 *
 * @returns the {@link TimelineCatalog} for flattened portfolio rows.
 */
export function buildHubTimelineCatalog(): TimelineCatalog<HubTimelineRow> {
  return {
    id: (row) => row.bar.id,
    label: (row) => row.bar.name,
    sublabel: (row) => row.programName,
    href: (row) => `/orgs/${row.bar.organizationId}/projects/${row.bar.id}`,
    span: (row) => resolveSpan(parseDate(row.bar.startDate), parseDate(row.bar.targetDate)),
    markers: (row): readonly TimelineMarker[] => {
      const markers: TimelineMarker[] = [];
      for (const milestone of row.bar.milestones) {
        const at = parseDate(milestone.targetDate);
        if (at === null) continue;
        markers.push({ id: milestone.id, name: milestone.name, at });
      }
      return markers;
    },
    tint: (row) => tintForHealth(row.bar.health),
    // The portfolio read is deliberately bounded and carries no task roll-up, so a bar shows no
    // completion fill rather than implying a zero.
    progress: () => null,
    // Dependency edges are an org-scoped concept; the cross-org read does not resolve them.
    edges: () => ({ blockedBy: [], blocks: [] }),
    statusLabel: (row) => statusLabel(row.bar.status),
    dragSource: (row) =>
      entityDragSource({
        kind: 'project',
        id: row.bar.id,
        organizationId: row.bar.organizationId,
        title: row.bar.name,
      }),
  };
}
