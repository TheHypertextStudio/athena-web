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
 * enriches each row with the canonical `status` and worst-child `rolledUpHealth`.
 * Status and health declare a custom {@link FieldDescriptor.rank} so they order by lifecycle /
 * severity rather than alphabetically, and carry a glyph `hint` so a grouped header can show the
 * field's domain glyph.
 */
import type { Health } from '@docket/types';
import { type Column, StatusIcon } from '@docket/ui/components';
import { FolderKanban, Layers } from '@docket/ui/icons';
import { createElement, type ReactNode } from 'react';

import { HEALTH_DOT_CLASS, HEALTH_LABEL } from '@/components/projects/health';
import { statusGlyphType } from '@/components/projects/project-status';
import { type FieldCatalog, type FieldOption, findField } from '@/components/views/field-catalog';

import type { InitiativeRowData } from './initiative-row';

/** The row shape the initiative catalog reads (the enriched row + its creation timestamp). */
export interface InitiativeCatalogRow extends InitiativeRowData {
  /** ISO creation timestamp, for the "Created" sort. */
  readonly createdAt: string;
}

/** Human label for each Initiative lifecycle status. */
const STATUS_LABEL: Record<string, string> = {
  proposed: 'Proposed',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};

/**
 * The initiative derived statuses, in lifecycle order, with their glyph hints.
 *
 * @remarks
 * An Initiative's status is auto-derived (`completed` once every associated Project is terminal,
 * else `active`), so the glyph borrows the shared project-status glyph vocabulary — `active`
 * reads as the in-progress dot, `completed` as the check — keeping a theme row in the same family.
 */
const STATUS_OPTIONS: readonly FieldOption[] = (
  ['proposed', 'active', 'completed', 'canceled'] as const
).map((status) => ({
  value: status,
  label: STATUS_LABEL[status] ?? status,
  hint: statusGlyphType(status),
}));

/** Lifecycle order rank for a derived status (active → completed; unknown last). */
function statusRank(value: string | number | null): number {
  const order = ['proposed', 'active', 'completed', 'canceled'];
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
      key: 'status',
      label: 'Status',
      type: 'enum',
      accessor: (initiative) => initiative.status,
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

/** Render a muted dash for an unset value, keeping aligned columns visually quiet but present. */
function emDash(): ReactNode {
  return createElement('span', { className: 'text-on-surface-variant/60' }, '—');
}

/** A compact scope cell: an icon + a "N noun" count (end-aligned, tabular). */
function scopeCell(
  icon: typeof FolderKanban,
  count: number,
  noun: string,
  nounPlural: string,
): ReactNode {
  return createElement(
    'span',
    { className: 'text-on-surface-variant flex items-center gap-1.5 tabular-nums' },
    createElement(icon, { 'aria-hidden': true, className: 'size-3.5' }),
    `${String(count)} ${count === 1 ? noun : nounPlural}`,
  );
}

/** Page-supplied vocabulary nouns the initiative scope columns need. */
export interface InitiativeColumnDeps {
  /** Header label for the Programs scope column (vocabulary-resolved plural, title-cased). */
  programsHeader: string;
  /** Singular Program noun (vocabulary-resolved, lower-cased) for the cell count. */
  programNoun: string;
  /** Plural Program noun (vocabulary-resolved, lower-cased) for the cell count. */
  programNounPlural: string;
  /** Header label for the Projects scope column (vocabulary-resolved plural, title-cased). */
  projectsHeader: string;
  /** Singular Project noun (vocabulary-resolved, lower-cased) for the cell count. */
  projectNoun: string;
  /** Plural Project noun (vocabulary-resolved, lower-cased) for the cell count. */
  projectNounPlural: string;
}

/**
 * Derive the {@link EntityTable} columns for the Initiatives roster from its {@link FieldCatalog}.
 *
 * @remarks
 * Columns are derived from the catalog so the table headers + the toolbar's group/sort fields read
 * from one source of truth: the Status and Health columns borrow their header from the matching
 * {@link FieldDescriptor.label}. The shape is the **same shared entity-table vocabulary** the
 * Projects roster uses — a leading status glyph, a flexing **Title**, then aligned Status + Health
 * columns — so an initiative roster and a project roster read identically. An Initiative carries no
 * work of its own, so where a Project surfaces a lead + target date, an Initiative surfaces its
 * *membership mix* (how many Programs / Projects it spans) as its trailing scope columns. Responsive
 * `priority` tiers shed the least-important columns first so the app never overflows.
 *
 * @param catalog - The initiative catalog (built by {@link buildInitiativeCatalog}).
 * @param deps - The page-supplied vocabulary nouns for the scope columns.
 * @returns the ordered table columns over {@link InitiativeCatalogRow}.
 */
export function initiativeColumns(
  catalog: FieldCatalog<InitiativeCatalogRow>,
  deps: InitiativeColumnDeps,
): readonly Column<InitiativeCatalogRow>[] {
  const status = findField(catalog, 'status');
  const health = findField(catalog, 'rolledUpHealth');

  return [
    // Leading lifecycle-status glyph — the shared, always-kept leading column.
    {
      key: 'glyph',
      header: '',
      width: '1.25rem',
      priority: 'always',
      render: (initiative) =>
        createElement(StatusIcon, {
          type: statusGlyphType(initiative.status),
          label: STATUS_LABEL[initiative.status] ?? initiative.status,
        }),
    },
    // TITLE — the one flexing, truncating column (never hidden).
    {
      key: 'name',
      header: 'Title',
      flex: true,
      render: (initiative) =>
        createElement(
          'span',
          { className: 'text-on-surface truncate font-medium' },
          initiative.name,
        ),
    },
    // STATUS — a quiet text label (an Initiative's status is auto-derived, no badge weight needed).
    {
      key: 'status',
      header: status?.label ?? 'Status',
      width: '7rem',
      priority: 1,
      render: (initiative) =>
        createElement(
          'span',
          { className: 'text-on-surface-variant text-xs font-medium' },
          STATUS_LABEL[initiative.status] ?? initiative.status,
        ),
    },
    // HEALTH — the rolled-up (worst-child) verdict as a token dot + label (shared baseline).
    {
      key: 'rolledUpHealth',
      header: health?.label ?? 'Health',
      minWidth: '7rem',
      priority: 2,
      render: (initiative) =>
        initiative.rolledUpHealth
          ? createElement(
              'span',
              {
                className: 'text-on-surface-variant flex items-center gap-1.5 text-xs font-medium',
              },
              createElement('span', {
                'aria-hidden': true,
                className: `size-1.5 rounded-full ${HEALTH_DOT_CLASS[initiative.rolledUpHealth]}`,
              }),
              HEALTH_LABEL[initiative.rolledUpHealth],
            )
          : emDash(),
    },
    // PROGRAMS scope — how many Programs the theme spans (end-aligned, tabular).
    {
      key: 'programCount',
      header: deps.programsHeader,
      align: 'end',
      width: '7rem',
      priority: 3,
      render: (initiative) =>
        scopeCell(Layers, initiative.programCount, deps.programNoun, deps.programNounPlural),
    },
    // PROJECTS scope — how many Projects the theme spans (end-aligned, tabular).
    {
      key: 'projectCount',
      header: deps.projectsHeader,
      align: 'end',
      width: '7rem',
      priority: 3,
      render: (initiative) =>
        scopeCell(FolderKanban, initiative.projectCount, deps.projectNoun, deps.projectNounPlural),
    },
  ];
}
