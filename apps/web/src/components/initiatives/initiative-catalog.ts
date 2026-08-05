'use client';

/**
 * The {@link FieldCatalog} for the org Initiatives hierarchy roster — the declaration of what the
 * shared {@link import('@/components/views/filter-toolbar').FilterToolbar} can filter and sort a
 * theme tree by.
 *
 * @remarks
 * Initiatives are the one entity roster that renders as a **tree** (arbitrary-depth parent/child
 * nesting, `role="treegrid"`, live drag-to-reparent) rather than a flat list. Flattening it into
 * grouped buckets — the way Projects/Programs/Cycles/Teams present a chosen grouping — would
 * discard the hierarchy a viewer is actively navigating and fight the reparent gesture, so this
 * catalog deliberately declares **no `groupable` field**; the Display menu still surfaces Ordering
 * for its sortable fields. Filtering and sorting otherwise behave exactly like every other roster:
 * **status** and **health** are filterable/sortable enums ranked by lifecycle/severity (not
 * alphabetically), and **name** is a sortable, `contains`-filterable text field — the same Add
 * Filter chip that replaces this page's previous bespoke search box.
 *
 * The catalog only declares what a *field* means; a matching descendant keeping its ancestor
 * chain visible while its non-matching ancestors are hidden is tree-specific behavior the page
 * itself implements (it needs the parent/child index the catalog has no reason to hold).
 */
import type { Health, InitiativeOverviewItem, InitiativeStatus } from '@docket/types';

import { type FieldCatalog, type FieldOption } from '@/components/views/field-catalog';

import { statusGlyphType } from '../projects/project-status';

/** Human label for each Initiative lifecycle status. */
export const STATUS_LABEL: Record<InitiativeStatus, string> = {
  proposed: 'Proposed',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** Human label for each health verdict. */
export const HEALTH_LABEL: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/**
 * The initiative lifecycle statuses, in workflow order, with their glyph hints.
 *
 * @remarks
 * An Initiative's status is manually owned (unlike a Project's derived status), so the glyph
 * borrows the shared project-status glyph vocabulary purely for the shared dot/check family —
 * `proposed` reads as the not-yet-started glyph since it has no dedicated mapping.
 */
const STATUS_OPTIONS: readonly FieldOption[] = (
  ['proposed', 'active', 'completed', 'canceled'] as const satisfies readonly InitiativeStatus[]
).map((status) => ({
  value: status,
  label: STATUS_LABEL[status],
  hint: statusGlyphType(status),
}));

/** Lifecycle order rank for a status (proposed → active → completed → canceled; unknown last). */
function statusRank(value: string | number | null): number {
  const order = ['proposed', 'active', 'completed', 'canceled'];
  if (value === null) return order.length;
  const index = order.indexOf(String(value));
  return index === -1 ? order.length : index;
}

/** The health verdicts, ordered by severity, with their labels + glyph hints. */
const HEALTH_OPTIONS: readonly FieldOption[] = (
  ['on_track', 'at_risk', 'off_track'] as const satisfies readonly Health[]
).map((health) => ({ value: health, label: HEALTH_LABEL[health], hint: health }));

/** Severity order rank for a health verdict (on track → at risk → off track; unset last). */
function healthRank(value: string | number | null): number {
  const order = ['on_track', 'at_risk', 'off_track'];
  if (value === null) return order.length;
  const index = order.indexOf(String(value));
  return index === -1 ? order.length : index;
}

/**
 * Build the initiative {@link FieldCatalog} the Initiatives toolbar drives.
 *
 * @remarks
 * No field declares `groupable: true` — see the module remarks for why the tree roster does not
 * offer a grouping affordance the way every flat entity roster does.
 *
 * @returns the catalog over {@link InitiativeOverviewItem}.
 */
export function buildInitiativeCatalog(): FieldCatalog<InitiativeOverviewItem> {
  return [
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      accessor: (initiative) => initiative.status,
      options: STATUS_OPTIONS,
      sortable: true,
      rank: statusRank,
    },
    {
      key: 'health',
      label: 'Health',
      type: 'enum',
      accessor: (initiative) => initiative.health ?? null,
      options: HEALTH_OPTIONS,
      sortable: true,
      rank: healthRank,
    },
    {
      key: 'name',
      label: 'Name',
      type: 'text',
      accessor: (initiative) => initiative.name,
      sortable: true,
    },
    {
      key: 'targetDate',
      label: 'Target date',
      type: 'date',
      accessor: (initiative) => initiative.targetDate ?? null,
      sortable: true,
    },
  ];
}
