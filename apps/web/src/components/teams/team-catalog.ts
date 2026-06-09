'use client';

/**
 * The {@link FieldCatalog} for the org Teams list — the declaration of what the unified
 * {@link import('@/components/views/filter-toolbar').FilterToolbar} can filter / group / sort a
 * team roster by.
 *
 * @remarks
 * A Team has no lifecycle status or health (it is a *unit*, not a tracked effort), so its catalog
 * is shaped to what a team actually carries: its **triage** queue (on / off), its **workflow
 * state count**, its **key**, and its **name**. Triage is modeled as an `enum` (a boolean read as
 * two stable buckets) so the roster can be filtered + grouped by whether a team runs a triage
 * queue; the workflow-state count is a `number` so it can be sorted (and compared); key and name
 * are sortable text. This is the Teams counterpart to the reference
 * {@link import('@/components/projects/project-catalog').buildProjectCatalog} — the same unified
 * engine, declared over the fields that make sense for a team.
 */
import type { TeamOut } from '@docket/types';

import { type FieldCatalog, type FieldOption } from '@/components/views/field-catalog';

/** The stored bucket values for the triage-queue field. */
const TRIAGE_ON = 'on';
const TRIAGE_OFF = 'off';

/** The triage buckets (a team's `triageEnabled` boolean read as two stable choices). */
const TRIAGE_OPTIONS: readonly FieldOption[] = [
  { value: TRIAGE_ON, label: 'Triage on' },
  { value: TRIAGE_OFF, label: 'Triage off' },
];

/** Resolve a triage bucket value to its display label (chips + group headers). */
function resolveTriage(value: string): string {
  return value === TRIAGE_ON ? 'Triage on' : 'Triage off';
}

/** Order rank for the triage buckets (on before off). */
function triageRank(value: string | number | null): number {
  if (value === TRIAGE_ON) return 0;
  if (value === TRIAGE_OFF) return 1;
  return 2;
}

/**
 * Build the team {@link FieldCatalog} the Teams toolbar drives.
 *
 * @returns the catalog over {@link TeamOut}.
 */
export function buildTeamCatalog(): FieldCatalog<TeamOut> {
  return [
    {
      key: 'triageEnabled',
      label: 'Triage',
      type: 'enum',
      accessor: (team) => (team.triageEnabled ? TRIAGE_ON : TRIAGE_OFF),
      options: TRIAGE_OPTIONS,
      resolveLabel: resolveTriage,
      groupable: true,
      sortable: true,
      rank: triageRank,
    },
    {
      key: 'workflowStateCount',
      label: 'Workflow states',
      type: 'number',
      accessor: (team) => team.workflowStates?.length ?? 0,
      sortable: true,
    },
    {
      key: 'key',
      label: 'Key',
      type: 'text',
      accessor: (team) => team.key,
      sortable: true,
    },
    {
      key: 'name',
      label: 'Name',
      type: 'text',
      accessor: (team) => team.name,
      sortable: true,
    },
  ];
}
