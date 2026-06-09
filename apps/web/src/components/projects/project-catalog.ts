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
import { ActorAvatar, type Column, StatusIcon } from '@docket/ui/components';
import { Calendar, ListChecks } from '@docket/ui/icons';
import { createElement, type ReactNode } from 'react';

import {
  type FieldCatalog,
  type FieldOption,
  findField,
  labelForValue,
} from '@/components/views/field-catalog';

import { HEALTH_DOT_CLASS, HEALTH_LABEL } from './health';
import { ProjectStatusBadge, STATUS_LABEL, statusGlyphType, statusLabel } from './project-status';

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

/** A short, year-less day formatter for a project's target date (e.g. "Jun 21"). */
const TARGET_DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** Format a project's nullable target date for the table cell, or `null` when unset/invalid. */
function formatTargetDate(targetDate: string | null | undefined): string | null {
  if (!targetDate) return null;
  const date = new Date(targetDate);
  if (Number.isNaN(date.getTime())) return null;
  return TARGET_DATE_FMT.format(date);
}

/** Page-supplied roll-ups the table cells need beyond the project row itself (task scope). */
export interface ProjectColumnDeps {
  /** The number of tasks scoped to a project (rolled up client-side from the tasks slice). */
  taskCountFor: (project: ProjectOut) => number;
  /** Singular task noun (vocabulary-resolved, lower-cased). */
  taskNoun: string;
  /** Plural task noun (vocabulary-resolved, lower-cased). */
  taskNounPlural: string;
}

/** Render a muted dash for an unset value, keeping aligned columns visually quiet but present. */
function emDash(): ReactNode {
  return createElement('span', { className: 'text-on-surface-variant/60' }, '—');
}

/**
 * Derive the {@link EntityTable} columns for the Projects roster from its {@link FieldCatalog}.
 *
 * @remarks
 * Columns are derived from the catalog so the table headers + the toolbar's group/sort fields read
 * from one source of truth: each property column borrows its header from the matching
 * {@link FieldDescriptor.label}, and relation cells (Lead) resolve their label through the same
 * {@link labelForValue} the toolbar uses. The shape is the **shared entity-table vocabulary** every
 * Docket roster uses — a leading status glyph, a flexing **Title**, then aligned property columns —
 * with Projects differing only in its trailing properties (lead, target date, task scope). The
 * responsive `priority` tiers shed the least-important columns first so the app never overflows.
 *
 * @param catalog - The project catalog (built by {@link buildProjectCatalog}).
 * @param deps - The page-supplied task-scope roll-up + nouns.
 * @returns the ordered table columns over {@link ProjectOut}.
 */
export function projectColumns(
  catalog: FieldCatalog<ProjectOut>,
  deps: ProjectColumnDeps,
): readonly Column<ProjectOut>[] {
  const status = findField(catalog, 'status');
  const lead = findField(catalog, 'leadId');
  const health = findField(catalog, 'health');
  const targetDate = findField(catalog, 'targetDate');

  return [
    // Leading lifecycle glyph — the shared, always-kept leading column.
    {
      key: 'glyph',
      header: '',
      width: '1.25rem',
      priority: 'always',
      render: (project) =>
        createElement(StatusIcon, {
          type: statusGlyphType(project.status),
          label: statusLabel(project.status),
        }),
    },
    // TITLE — the one flexing, truncating column (never hidden).
    {
      key: 'name',
      header: 'Title',
      flex: true,
      render: (project) =>
        createElement('span', { className: 'text-on-surface truncate font-medium' }, project.name),
    },
    // STATUS badge — header + value labels come straight from the catalog field.
    {
      key: 'status',
      header: status?.label ?? 'Status',
      width: '7rem',
      priority: 1,
      render: (project) => createElement(ProjectStatusBadge, { status: project.status }),
    },
    // HEALTH — a small token dot + label (shared baseline property).
    {
      key: 'health',
      header: health?.label ?? 'Health',
      minWidth: '7rem',
      priority: 2,
      render: (project) =>
        project.health
          ? createElement(
              'span',
              {
                className: 'text-on-surface-variant flex items-center gap-1.5 text-xs font-medium',
              },
              createElement('span', {
                'aria-hidden': true,
                className: `size-1.5 rounded-full ${HEALTH_DOT_CLASS[project.health]}`,
              }),
              HEALTH_LABEL[project.health],
            )
          : emDash(),
    },
    // LEAD/OWNER avatar — relation field; resolveLabel turns the id into a display name.
    {
      key: 'leadId',
      header: lead?.label ?? 'Lead',
      minWidth: '8rem',
      priority: 2,
      render: (project) => {
        if (!lead || !project.leadId) return emDash();
        const name = labelForValue(lead, project.leadId);
        return createElement(
          'span',
          { className: 'flex min-w-0 items-center gap-1.5' },
          createElement(ActorAvatar, { kind: 'human', name, size: 18 }),
          createElement('span', { className: 'text-on-surface truncate' }, name),
        );
      },
    },
    // TARGET DATE — end-aligned, tabular.
    {
      key: 'targetDate',
      header: targetDate?.label ?? 'Target date',
      align: 'end',
      width: '6.5rem',
      priority: 3,
      render: (project) => {
        const formatted = formatTargetDate(project.targetDate);
        return formatted
          ? createElement(
              'span',
              { className: 'text-on-surface-variant flex items-center gap-1.5 tabular-nums' },
              createElement(Calendar, { 'aria-hidden': true, className: 'size-3.5' }),
              formatted,
            )
          : emDash();
      },
    },
    // SCOPE — the project's task count (end-aligned, tabular).
    {
      key: 'scope',
      header: 'Scope',
      align: 'end',
      width: '6.5rem',
      priority: 3,
      render: (project) => {
        const count = deps.taskCountFor(project);
        const word = count === 1 ? deps.taskNoun : deps.taskNounPlural;
        return createElement(
          'span',
          { className: 'text-on-surface-variant flex items-center gap-1.5 tabular-nums' },
          createElement(ListChecks, { 'aria-hidden': true, className: 'size-3.5' }),
          `${String(count)} ${word}`,
        );
      },
    },
  ];
}
