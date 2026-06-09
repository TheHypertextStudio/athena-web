'use client';

/**
 * The {@link FieldCatalog} for the org Projects list — the declaration of what the unified
 * {@link FilterToolbar} can filter / group / sort a project roster by.
 *
 * @remarks
 * This is the reference application of the unified filtering engine (the pattern the Apply phase
 * copies to Programs, Initiatives, Cycles, and Teams). It replaces the bespoke single-select
 * status menu the Projects list used to ship: a project can now be filtered by **status**,
 * **health**, **lead**, and **team**; grouped by status / health / lead / team; and sorted by
 * status, health, target date, or name — all through one Linear-style bar.
 *
 * Status and health declare a custom {@link FieldDescriptor.rank} so they order by lifecycle /
 * severity rather than alphabetically, and carry a glyph `hint` so a grouped header can show the
 * field's domain glyph. Lead and team are `relation` fields whose options + label resolution are
 * injected from the page's already-loaded members/teams (Phase B data), so the value chooser
 * needs no extra fetch.
 */
import type { Health, ProjectOut } from '@docket/types';

import { type FieldCatalog, type FieldOption } from '@/components/views/field-catalog';

import { HEALTH_LABEL } from './health';
import { STATUS_LABEL, statusGlyphType } from './project-status';

/** The project lifecycle statuses, in workflow order, with their glyph hints. */
const STATUS_OPTIONS: readonly FieldOption[] = (
  ['planned', 'active', 'completed', 'canceled'] as const
).map((status) => ({ value: status, label: STATUS_LABEL[status], hint: statusGlyphType(status) }));

/** Lifecycle order rank for a status (planned → active → completed → canceled; unknown last). */
function statusRank(value: string | number | null): number {
  const order = ['planned', 'active', 'completed', 'canceled'];
  if (value === null) return order.length;
  const index = order.indexOf(String(value));
  return index === -1 ? order.length : index;
}

/** The health verdicts, most-concerning treated by severity rank, with their labels. */
const HEALTH_OPTIONS: readonly FieldOption[] = (['on_track', 'at_risk', 'off_track'] as const).map(
  (health: Health) => ({ value: health, label: HEALTH_LABEL[health], hint: health }),
);

/** Severity order rank for a health verdict (on track → at risk → off track; unset last). */
function healthRank(value: string | number | null): number {
  const order = ['on_track', 'at_risk', 'off_track'];
  if (value === null) return order.length;
  const index = order.indexOf(String(value));
  return index === -1 ? order.length : index;
}

/** Injected resolvers a page supplies so the project catalog can skin relation fields. */
export interface ProjectCatalogDeps {
  /** Vocabulary label for the project "Lead" relation (kept neutral as "Lead"). */
  leadLabel: string;
  /** Vocabulary label for the "Team" relation. */
  teamLabel: string;
  /** The lead relation options (the org's members as choosable values). */
  leadOptions: () => readonly FieldOption[];
  /** Resolve a lead actor id to its display name (chips + group headers). */
  resolveLead: (id: string) => string;
  /** The team relation options. */
  teamOptions: () => readonly FieldOption[];
  /** Resolve a team id to its display name. */
  resolveTeam: (id: string) => string;
}

/**
 * Build the project {@link FieldCatalog} the Projects toolbar drives.
 *
 * @param deps - The page-supplied relation options + label resolvers.
 * @returns the catalog over {@link ProjectOut}.
 */
export function buildProjectCatalog(deps: ProjectCatalogDeps): FieldCatalog<ProjectOut> {
  return [
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      accessor: (project) => project.status,
      options: STATUS_OPTIONS,
      groupable: true,
      sortable: true,
      rank: statusRank,
    },
    {
      key: 'health',
      label: 'Health',
      type: 'enum',
      accessor: (project) => project.health ?? null,
      options: HEALTH_OPTIONS,
      groupable: true,
      sortable: true,
      rank: healthRank,
    },
    {
      key: 'leadId',
      label: deps.leadLabel,
      type: 'relation',
      accessor: (project) => project.leadId ?? null,
      resolveOptions: deps.leadOptions,
      resolveLabel: deps.resolveLead,
      groupable: true,
    },
    {
      key: 'teamId',
      label: deps.teamLabel,
      type: 'relation',
      accessor: (project) => project.teamId ?? null,
      resolveOptions: deps.teamOptions,
      resolveLabel: deps.resolveTeam,
      groupable: true,
    },
    {
      key: 'targetDate',
      label: 'Target date',
      type: 'date',
      accessor: (project) => project.targetDate ?? null,
      sortable: true,
    },
    {
      key: 'name',
      label: 'Name',
      type: 'text',
      accessor: (project) => project.name,
      sortable: true,
    },
  ];
}
