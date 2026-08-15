'use client';

/**
 * The {@link FieldCatalog} for the org Programs list — the declaration of what the unified
 * {@link import('@/components/views/filter-toolbar').FilterToolbar} can filter / group / sort a
 * program roster by.
 *
 * @remarks
 * Programs are *ongoing* operational lines of work, so this catalog reads liveness rather than a
 * finish line: a program can be filtered by **status**, **health**, and **owner**; grouped by status / health / owner; and sorted by status, health, or
 * name. It is the Programs counterpart to the reference
 * {@link import('@/components/projects/project-catalog').buildProjectCatalog} — the same unified
 * engine, with the project's `lead` / `team` / `target date` swapped for a program's `owner` (and
 * no target date, since a program has no finish line).
 *
 * Status options and their {@link FieldDescriptor.rank} come from the workspace's own Program
 * status set, so the roster reads in the board order someone chose in settings; health declares its
 * own severity rank. Both carry a glyph `hint` so a grouped header can show the field's domain
 * glyph. Owner is a `relation` field whose options + label resolution are injected
 * from the page's already-loaded members (Phase B data), so the value chooser needs no extra
 * fetch.
 */
import type { Health, ProgramOut } from '@docket/types';

import {
  type WorkStatusDisplay,
  statusFieldOptions,
  statusRankOf,
} from '@/components/entity-display/work-status';
import { type FieldCatalog, type FieldOption } from '@/components/views/field-catalog';

import { HEALTH_LABEL } from './health';

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

/** Injected resolvers a page supplies so the program catalog can skin its relation fields. */
export interface ProgramCatalogDeps {
  /** The workspace's Program statuses, in board order, from the status registry. */
  statuses: readonly WorkStatusDisplay[];
  /** Vocabulary label for the program "Owner" relation (kept neutral as "Owner"). */
  ownerLabel: string;
  /** The owner relation options (the org's members as choosable values). */
  ownerOptions: () => readonly FieldOption[];
  /** Resolve an owner actor id to its display name (chips + group headers). */
  resolveOwner: (id: string) => string;
}

/**
 * Build the program {@link FieldCatalog} the Programs toolbar drives.
 *
 * @param deps - The page-supplied relation options + label resolvers.
 * @returns the catalog over {@link ProgramOut}.
 */
export function buildProgramCatalog(deps: ProgramCatalogDeps): FieldCatalog<ProgramOut> {
  return [
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      accessor: (program) => program.status,
      options: statusFieldOptions(deps.statuses),
      groupable: true,
      sortable: true,
      rank: statusRankOf(deps.statuses),
    },
    {
      key: 'health',
      label: 'Health',
      type: 'enum',
      accessor: (program) => program.health ?? null,
      options: HEALTH_OPTIONS,
      groupable: true,
      sortable: true,
      rank: healthRank,
    },
    {
      key: 'ownerId',
      label: deps.ownerLabel,
      type: 'relation',
      accessor: (program) => program.ownerId ?? null,
      resolveOptions: deps.ownerOptions,
      resolveLabel: deps.resolveOwner,
      groupable: true,
    },
    {
      key: 'name',
      label: 'Name',
      type: 'text',
      accessor: (program) => program.name,
      sortable: true,
    },
  ];
}
