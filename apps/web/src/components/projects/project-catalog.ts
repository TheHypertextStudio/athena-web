'use client';

/**
 * The {@link FieldCatalog} for the org Projects list — the declaration of what the unified
 * {@link FilterToolbar} can filter / group / sort a project roster by.
 *
 * @remarks
 * This is the reference application of the unified filtering engine (the pattern the Apply phase
 * copies to Programs, Initiatives, Cycles, and Teams). It replaces the bespoke single-select
 * status menu the Projects list used to ship: a project can now be filtered by **status**,
 * **lead**, and **team**; grouped by status / lead / team; and sorted by status, target date, or
 * name — all through one Linear-style bar.
 *
 * Status is whatever the workspace named its Project stages, so its options and its
 * {@link FieldDescriptor.rank} come from the status registry rather than from a list written here:
 * the roster orders by the board order someone chose in settings, and each option carries its
 * category as a glyph `hint` so a grouped header can draw the field's domain glyph. Lead and team are `relation` fields whose options + label resolution are
 * injected from the page's already-loaded members/teams (Phase B data), so the value chooser
 * needs no extra fetch.
 */
import type { ProjectOut } from '../../lib/contracts/project';
import { ActorAvatar, type Column } from '@docket/ui/components';
import { Calendar, ListChecks } from '@docket/ui/icons';
import { createElement, type ReactNode } from 'react';

import {
  type WorkStatusDisplay,
  statusFieldOptions,
  statusRankOf,
  unknownStatus,
  WorkStatusBadge,
  WorkStatusIcon,
} from '@/components/entity-display/work-status';
import {
  type FieldCatalog,
  type FieldOption,
  findField,
  labelForValue,
} from '@/components/views/field-catalog';
import {
  formatPlanningTimeframe,
  planningTimeframeKey,
  toPlanningTimeframe,
} from '@/lib/planning-timeframe';

/** Injected resolvers a page supplies so the project catalog can skin relation fields. */
export interface ProjectCatalogDeps {
  /** Loaded Project rows used to derive non-empty semantic timeframe options. */
  projects: readonly ProjectOut[];
  /** The workspace's Project statuses, in board order, from the status registry. */
  statuses: readonly WorkStatusDisplay[];
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
  const timeframeByKey = new Map<string, { value: string; label: string; date: string }>();
  for (const project of deps.projects) {
    const value = targetTimeframeKey(project);
    const label = formatProjectTarget(project);
    if (!value || !label || !project.targetDate) continue;
    timeframeByKey.set(value, { value, label, date: project.targetDate });
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
      accessor: (project) => project.status,
      options: statusFieldOptions(deps.statuses),
      groupable: true,
      sortable: true,
      rank: statusRankOf(deps.statuses),
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
      key: 'targetTimeframe',
      label: 'Target timeframe',
      type: 'enum',
      accessor: targetTimeframeKey,
      options: targetTimeframeOptions,
      groupable: true,
      rank: (value) =>
        typeof value === 'string' ? Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`) : Infinity,
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

/** Format one Project target with its saved planning semantics. */
export function formatProjectTarget(project: ProjectOut): string | null {
  return formatPlanningTimeframe(
    toPlanningTimeframe(
      project.targetDate,
      project.targetDateResolution,
      project.targetDateFiscalYearStartMonth,
    ),
  );
}

/** Build one Project target's stable semantic filter and grouping key. */
export function targetTimeframeKey(project: ProjectOut): string | null {
  return planningTimeframeKey(
    toPlanningTimeframe(
      project.targetDate,
      project.targetDateResolution,
      project.targetDateFiscalYearStartMonth,
    ),
  );
}

/** Page-supplied roll-ups the table cells need beyond the project row itself (task scope). */
export interface ProjectColumnDeps {
  /** The workspace's Project statuses, in board order, so a row can name and draw its own. */
  statuses: readonly WorkStatusDisplay[];
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
  const targetDate = findField(catalog, 'targetDate');
  const statusOf = (project: ProjectOut): WorkStatusDisplay =>
    deps.statuses.find((candidate) => candidate.key === project.status) ??
    unknownStatus(project.status);

  return [
    // Leading lifecycle glyph — the shared, always-kept leading column.
    {
      key: 'glyph',
      header: '',
      width: '1.25rem',
      priority: 'always',
      render: (project) => {
        const { name, category } = statusOf(project);
        return createElement(WorkStatusIcon, { name, category });
      },
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
      render: (project) => {
        const { name, category } = statusOf(project);
        return createElement(WorkStatusBadge, { name, category });
      },
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
      width: '9.5rem',
      priority: 3,
      render: (project) => {
        const formatted = formatProjectTarget(project);
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
