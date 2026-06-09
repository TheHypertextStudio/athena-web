'use client';

/**
 * The {@link FieldCatalog} for the org Initiatives list — the declaration of what the unified
 * {@link import('@/components/views/filter-toolbar').FilterToolbar} can filter / group / sort a
 * theme roster by.
 *
 * @remarks
 * This applies the unified filtering engine to Initiatives (the pattern the Projects list
 * established). It replaces the page's hard-coded Active/Completed partition with a real
 * {@link import('@/components/views/filter-toolbar').FilterToolbar}: an initiative can now be
 * filtered by **status** and **health**, grouped by status / health, and sorted by status,
 * health, name, or creation date — all through one Linear-style bar. The page defaults the
 * grouping to **status** so the familiar sectioned look is preserved, but it is now
 * user-changeable.
 *
 * An Initiative carries no work of its own, so the catalog reads the *roll-up* the page already
 * enriches each row with: the auto-derived `derivedStatus` and the worst-child `rolledUpHealth`.
 * Status and health declare a custom {@link FieldDescriptor.rank} so they order by lifecycle /
 * severity rather than alphabetically, and carry a glyph `hint` so a grouped header can show the
 * field's domain glyph.
 */
import type { Health } from '@docket/types';

import { HEALTH_LABEL } from '@/components/projects/health';
import { statusGlyphType } from '@/components/projects/project-status';
import { type FieldCatalog, type FieldOption } from '@/components/views/field-catalog';

import type { InitiativeRowData } from './initiative-row';

/** The row shape the initiative catalog reads (the enriched row + its creation timestamp). */
export interface InitiativeCatalogRow extends InitiativeRowData {
  /** ISO creation timestamp, for the "Created" sort. */
  readonly createdAt: string;
}

/** Human label for each Initiative derived status. */
const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
};

/**
 * The initiative derived statuses, in lifecycle order, with their glyph hints.
 *
 * @remarks
 * An Initiative's status is auto-derived (`completed` once every associated Project is terminal,
 * else `active`), so the glyph borrows the shared project-status glyph vocabulary — `active`
 * reads as the in-progress dot, `completed` as the check — keeping a theme row in the same family.
 */
const STATUS_OPTIONS: readonly FieldOption[] = (['active', 'completed'] as const).map((status) => ({
  value: status,
  label: STATUS_LABEL[status] ?? status,
  hint: statusGlyphType(status),
}));

/** Lifecycle order rank for a derived status (active → completed; unknown last). */
function statusRank(value: string | number | null): number {
  const order = ['active', 'completed'];
  if (value === null) return order.length;
  const index = order.indexOf(String(value));
  return index === -1 ? order.length : index;
}

/** The health verdicts, ordered by severity, with their labels + glyph hints. */
const HEALTH_OPTIONS: readonly FieldOption[] = (['on_track', 'at_risk', 'off_track'] as const).map(
  (health: Health) => ({ value: health, label: HEALTH_LABEL[health], hint: health }),
);

/** Severity order rank for a rolled-up health verdict (on track → at risk → off track; unset last). */
function healthRank(value: string | number | null): number {
  const order = ['on_track', 'at_risk', 'off_track'];
  if (value === null) return order.length;
  const index = order.indexOf(String(value));
  return index === -1 ? order.length : index;
}

/**
 * Build the initiative {@link FieldCatalog} the Initiatives toolbar drives.
 *
 * @returns the catalog over {@link InitiativeCatalogRow}.
 */
export function buildInitiativeCatalog(): FieldCatalog<InitiativeCatalogRow> {
  return [
    {
      key: 'derivedStatus',
      label: 'Status',
      type: 'enum',
      accessor: (initiative) => initiative.derivedStatus,
      options: STATUS_OPTIONS,
      groupable: true,
      sortable: true,
      rank: statusRank,
    },
    {
      key: 'rolledUpHealth',
      label: 'Health',
      type: 'enum',
      accessor: (initiative) => initiative.rolledUpHealth ?? null,
      options: HEALTH_OPTIONS,
      groupable: true,
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
      key: 'createdAt',
      label: 'Created',
      type: 'date',
      accessor: (initiative) => initiative.createdAt,
      sortable: true,
    },
  ];
}
