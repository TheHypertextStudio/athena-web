/**
 * The Projects surface's {@link TimelineCatalog} — how a Project projects onto a time axis.
 *
 * @remarks
 * This is the entire per-page cost of adopting the shared timeline: a declaration of where a
 * Project's dates, checkpoints, colour, progress, and dependencies live. Everything else — the
 * calendar axis, zooming, group bands, dependency edges, drag-to-schedule, the unscheduled tray —
 * comes from the engine, exactly as a list page gets the whole filter toolbar from a field
 * catalog.
 *
 * The catalog is a pure projection: it reads a row and returns values. It holds no state and
 * performs no writes, so it is directly unit-testable and the engine stays free of any Project
 * vocabulary.
 */
import type { ProjectOverviewItem } from '@docket/types';

import { entityDragSource } from '@/lib/entity-drag';

import {
  type TimelineCatalog,
  type TimelineMarker,
  type TimelineTint,
  resolveSpan,
} from '@/components/timeline/timeline-catalog';
import { parseDate } from '@/components/timeline/time-scale';

/**
 * Map a Project's health verdict onto the engine's domain-free tone vocabulary.
 *
 * @remarks
 * The engine never learns what "health" means; this is the only place the translation happens, so
 * every timeline in the product ends up speaking one colour language.
 */
function tintForHealth(health: ProjectOverviewItem['health']): TimelineTint {
  if (health === 'on_track') return 'positive';
  if (health === 'at_risk') return 'caution';
  if (health === 'off_track') return 'critical';
  return 'neutral';
}

/** Title-case a lifecycle status for display (statuses arrive as free-form lowercase strings). */
function statusLabel(status: string): string {
  if (status.length === 0) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

/**
 * Build the Projects timeline catalog.
 *
 * @param orgId - The active organization, for deep links.
 * @param resolveTeam - Resolve a Team id to its display name, for row context.
 * @returns the {@link TimelineCatalog} for `ProjectOverviewItem` rows.
 */
export function buildProjectTimelineCatalog(
  orgId: string,
  resolveTeam: (teamId: string) => string | null,
): TimelineCatalog<ProjectOverviewItem> {
  return {
    id: (row) => row.id,
    label: (row) => row.name,
    sublabel: (row) => (row.teamId === null ? null : resolveTeam(row.teamId)),
    href: (row) => `/orgs/${orgId}/projects/${row.id}`,
    span: (row) => resolveSpan(parseDate(row.startDate), parseDate(row.targetDate)),
    markers: (row): readonly TimelineMarker[] => {
      const markers: TimelineMarker[] = [];
      for (const milestone of row.milestones) {
        const at = parseDate(milestone.targetDate);
        // An undated checkpoint has no position; it belongs on the Project detail, not the axis.
        if (at === null) continue;
        markers.push({ id: milestone.id, name: milestone.name, at });
      }
      return markers;
    },
    tint: (row) => tintForHealth(row.health),
    progress: (row) => (row.taskCount === 0 ? null : row.completedTaskCount / row.taskCount),
    edges: (row) => ({ blockedBy: row.blockedByIds, blocks: row.blocksIds }),
    statusLabel: (row) => statusLabel(row.status),
    // A Project is draggable as an object from its label cell, matching every other core-object
    // surface; the bar itself is reserved for the pointer gesture that reschedules it.
    dragSource: (row) =>
      entityDragSource({
        kind: 'project',
        id: row.id,
        organizationId: row.organizationId,
        title: row.name,
      }),
  };
}
