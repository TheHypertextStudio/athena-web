'use client';

/**
 * The {@link FieldCatalog} for the org Cycles list — the declaration of what the unified
 * {@link import('@/components/views/filter-toolbar').FilterToolbar} can filter / group / sort a
 * cadence roster by.
 *
 * @remarks
 * This applies the unified filtering engine to Cycles (the pattern the Projects list
 * established). It replaces the page's hard-coded Current/Upcoming/Completed segments with a real
 * {@link import('@/components/views/filter-toolbar').FilterToolbar}: a cycle can now be filtered
 * by **status** and **team**, grouped by status / team, and sorted by status, team, start date,
 * end date, or number — all through one Linear-style bar. The page defaults the grouping to
 * **status** so the familiar segmented look is preserved, but it is now user-changeable.
 *
 * Status declares a custom {@link FieldDescriptor.rank} so cycles order by cadence lifecycle
 * (current → upcoming → completed) rather than alphabetically, and carries a glyph `hint` so a
 * grouped header can show the cycle status glyph. Team is a `relation` field whose options +
 * label resolution are injected from the page's already-loaded teams (Phase B data), so the value
 * chooser needs no extra fetch.
 */
import type { CycleOut, CycleStatus } from '@docket/types';

import { type FieldCatalog, type FieldOption } from '@/components/views/field-catalog';

import { STATUS_LABEL, statusGlyphType } from './cycle-status';

/** The cycle statuses, in cadence-lifecycle order, with their glyph hints. */
const STATUS_OPTIONS: readonly FieldOption[] = (['active', 'upcoming', 'completed'] as const).map(
  (status: CycleStatus) => ({
    value: status,
    label: STATUS_LABEL[status],
    hint: statusGlyphType(status),
  }),
);

/** Cadence-lifecycle order rank for a status (active → upcoming → completed; unknown last). */
function statusRank(value: string | number | null): number {
  const order = ['active', 'upcoming', 'completed'];
  if (value === null) return order.length;
  const index = order.indexOf(String(value));
  return index === -1 ? order.length : index;
}

/** Injected resolvers a page supplies so the cycle catalog can skin its team relation field. */
export interface CycleCatalogDeps {
  /** Vocabulary label for the "Team" relation. */
  teamLabel: string;
  /** The team relation options (the org's teams as choosable values). */
  teamOptions: () => readonly FieldOption[];
  /** Resolve a team id to its display name (chips + group headers). */
  resolveTeam: (id: string) => string;
}

/**
 * Build the cycle {@link FieldCatalog} the Cycles toolbar drives.
 *
 * @param deps - The page-supplied team relation options + label resolver.
 * @returns the catalog over {@link CycleOut}.
 */
export function buildCycleCatalog(deps: CycleCatalogDeps): FieldCatalog<CycleOut> {
  return [
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      accessor: (cycle) => cycle.status,
      options: STATUS_OPTIONS,
      groupable: true,
      sortable: true,
      rank: statusRank,
    },
    {
      key: 'teamId',
      label: deps.teamLabel,
      type: 'relation',
      accessor: (cycle) => cycle.teamId,
      resolveOptions: deps.teamOptions,
      resolveLabel: deps.resolveTeam,
      groupable: true,
      sortable: true,
    },
    {
      key: 'startsAt',
      label: 'Start date',
      type: 'date',
      accessor: (cycle) => cycle.startsAt,
      sortable: true,
    },
    {
      key: 'endsAt',
      label: 'End date',
      type: 'date',
      accessor: (cycle) => cycle.endsAt,
      sortable: true,
    },
    {
      key: 'number',
      label: 'Number',
      type: 'number',
      accessor: (cycle) => cycle.number,
      sortable: true,
    },
  ];
}
