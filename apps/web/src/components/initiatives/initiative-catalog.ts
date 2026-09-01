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
import type { Health } from '@docket/work/capability-contract';
import type { InitiativeOverviewItem } from '@docket/work/initiative-contract';

import {
  type WorkStatusDisplay,
  statusFieldOptions,
  statusRankOf,
} from '@/components/entity-display/work-status';
import { type FieldCatalog, type FieldOption } from '@/components/views/field-catalog';
import {
  formatPlanningTimeframe,
  planningTimeframeKey,
  toPlanningTimeframe,
} from '@/lib/planning-timeframe';

/** Human label for each health value. */
export const HEALTH_LABEL: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/** The health values, ordered by severity, with their labels and glyph hints. */
const HEALTH_OPTIONS: readonly FieldOption[] = (
  ['on_track', 'at_risk', 'off_track'] as const satisfies readonly Health[]
).map((health) => ({ value: health, label: HEALTH_LABEL[health], hint: health }));

/** Severity order rank for health (on track → at risk → off track; unset last). */
function healthRank(value: string | number | null): number {
  const order = ['on_track', 'at_risk', 'off_track'];
  if (value === null) return order.length;
  const index = order.indexOf(String(value));
  return index === -1 ? order.length : index;
}

/** The workspace data a page supplies so the catalog can offer the statuses it actually has. */
export interface InitiativeCatalogDeps {
  /** Loaded Initiative rows used to derive non-empty semantic timeframe options. */
  initiatives: readonly InitiativeOverviewItem[];
  /** The workspace's Initiative statuses, in board order, from the status registry. */
  statuses: readonly WorkStatusDisplay[];
}

/**
 * Build the initiative {@link FieldCatalog} the Initiatives toolbar drives.
 *
 * @remarks
 * No field declares `groupable: true` — see the module remarks for why the tree roster does not
 * offer a grouping affordance the way every flat entity roster does.
 *
 * @param deps - The workspace's Initiative statuses.
 * @returns the catalog over {@link InitiativeOverviewItem}.
 */
export function buildInitiativeCatalog(
  deps: InitiativeCatalogDeps,
): FieldCatalog<InitiativeOverviewItem> {
  const timeframeByKey = new Map<string, { value: string; label: string; date: string }>();
  for (const initiative of deps.initiatives) {
    const value = initiativeTargetTimeframeKey(initiative);
    const label = formatInitiativeTarget(initiative);
    if (!value || !label || !initiative.targetDate) continue;
    timeframeByKey.set(value, { value, label, date: initiative.targetDate });
  }
  const targetTimeframeOptions = [...timeframeByKey.values()]
    .sort(
      (left, right) => left.date.localeCompare(right.date) || left.label.localeCompare(right.label),
    )
    .map(({ value, label }) => ({ value, label }));

  return [
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      accessor: (initiative) => initiative.status,
      options: statusFieldOptions(deps.statuses),
      sortable: true,
      rank: statusRankOf(deps.statuses),
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
    {
      key: 'targetTimeframe',
      label: 'Target timeframe',
      type: 'enum',
      accessor: initiativeTargetTimeframeKey,
      options: targetTimeframeOptions,
      rank: (value) =>
        typeof value === 'string' ? Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`) : Infinity,
    },
  ];
}

/** Format one Initiative target with its saved planning semantics. */
export function formatInitiativeTarget(initiative: InitiativeOverviewItem): string | null {
  return formatPlanningTimeframe(
    toPlanningTimeframe(
      initiative.targetDate,
      initiative.targetDateResolution,
      initiative.targetDateFiscalYearStartMonth,
    ),
  );
}

/** Build one Initiative target's stable semantic filter key. */
export function initiativeTargetTimeframeKey(initiative: InitiativeOverviewItem): string | null {
  return planningTimeframeKey(
    toPlanningTimeframe(
      initiative.targetDate,
      initiative.targetDateResolution,
      initiative.targetDateFiscalYearStartMonth,
    ),
  );
}
