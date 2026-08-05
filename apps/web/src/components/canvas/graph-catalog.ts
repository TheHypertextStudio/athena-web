'use client';

/**
 * `components/canvas/graph-catalog` — the {@link FieldCatalog} for dependency-graph nodes.
 *
 * @remarks
 * The canvas used to carry its own filter UI: a bespoke bar of eight peer pills (project,
 * assignee, priority, state, critical path, ready, grouping, direction) that wrapped to two rows
 * on a normal desktop. Every list surface in the app had already moved onto the shared
 * {@link import('../views/filter-toolbar').FilterToolbar}, whose entire design is that a surface
 * grows *menu entries* rather than buttons. This catalog is what lets the graph join them: it
 * declares the node fields once, and the shared Filter menu, the chip row, and the URL codec all
 * read it.
 *
 * The row type is xyflow's `Node`, not a task DTO, because the canvas filters the laid-out graph
 * rather than the API payload — the node carries everything the toolbar needs on its
 * {@link import('./task-node').TaskNodeData}.
 *
 * ## Unassigned and project-less work
 *
 * The filter engine treats a `null` accessor as "no opinion", so a null can never match an `is` /
 * `is any of` predicate. Assignee, project, and milestone therefore report the {@link UNSET}
 * sentinel rather than null, and each offers an explicit "Unassigned" / "No project" option. That
 * preserves the capability the old bespoke bar had, where filtering *for* unassigned work was one
 * of the more useful things it did.
 */
import type { Node } from '@xyflow/react';

import { PRIORITY_LABEL, PRIORITY_ORDER } from '@/components/task-detail/priority';
import { type FieldCatalog, type FieldOption } from '@/components/views/field-catalog';
import { STATE_GROUP_LABEL, STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';

import { taskData } from './task-node';

/** Sentinel for a field a node does not have set (unassigned, project-less, no milestone). */
export const UNSET = '__none__';

/** Priority options, most pressing first. */
const PRIORITY_OPTIONS: readonly FieldOption[] = PRIORITY_ORDER.map((priority) => ({
  value: priority,
  label: PRIORITY_LABEL[priority],
}));

/** Canonical workflow-state options, in workflow order. */
const STATE_OPTIONS: readonly FieldOption[] = STATE_GROUP_ORDER.map((type) => ({
  value: type,
  label: STATE_GROUP_LABEL[type],
  hint: type,
}));

/** Sort/group rank for a priority value (urgent first). */
function priorityRank(value: string | number | null): number {
  if (value === null) return PRIORITY_ORDER.length;
  const index = PRIORITY_ORDER.indexOf(value as (typeof PRIORITY_ORDER)[number]);
  return index === -1 ? PRIORITY_ORDER.length : index;
}

/** Sort/group rank for a canonical state type, by workflow order. */
function stateRank(value: string | number | null): number {
  if (value === null) return STATE_GROUP_ORDER.length;
  return STATE_GROUP_ORDER.indexOf(value as (typeof STATE_GROUP_ORDER)[number]);
}

/** The reference data the catalog needs to turn ids into names. */
export interface GraphCatalogDeps {
  /** Vocabulary label for the project field. */
  projectLabel: string;
  /** The org's projects, as choosable options. */
  projectOptions: readonly FieldOption[];
  /** The org's assignable actors, as choosable options. */
  assigneeOptions: readonly FieldOption[];
  /** The org's teams, as choosable options. */
  teamOptions: readonly FieldOption[];
  /** The org's milestones, as choosable options. */
  milestoneOptions: readonly FieldOption[];
}

/** Resolve a value against an option list, falling back to the raw value. */
function labelFrom(options: readonly FieldOption[], unsetLabel: string) {
  return (value: string): string => {
    if (value === UNSET) return unsetLabel;
    return options.find((o) => o.value === value)?.label ?? value;
  };
}

/** Prepend the explicit "unset" choice to a relation field's options. */
function withUnset(options: readonly FieldOption[], unsetLabel: string): readonly FieldOption[] {
  return [{ value: UNSET, label: unsetLabel }, ...options];
}

/**
 * Build the dependency-graph field catalog.
 *
 * @param deps - The org reference data used to resolve relation labels + options.
 * @returns the catalog the shared toolbar and filter engine read.
 */
export function buildGraphCatalog(deps: GraphCatalogDeps): FieldCatalog<Node> {
  const { projectLabel, projectOptions, assigneeOptions, teamOptions, milestoneOptions } = deps;
  return [
    {
      key: 'title',
      label: 'Title',
      type: 'text',
      accessor: (node) => taskData(node).title,
    },
    {
      key: 'state',
      label: 'Status',
      type: 'enum',
      accessor: (node) => stateTypeOf(taskData(node).state),
      options: STATE_OPTIONS,
      groupable: true,
      rank: stateRank,
    },
    {
      key: 'priority',
      label: 'Priority',
      type: 'enum',
      accessor: (node) => taskData(node).priority,
      options: PRIORITY_OPTIONS,
      groupable: true,
      rank: priorityRank,
    },
    {
      key: 'assignee',
      label: 'Assignee',
      type: 'relation',
      accessor: (node) => taskData(node).assigneeId ?? UNSET,
      options: withUnset(assigneeOptions, 'Unassigned'),
      resolveLabel: labelFrom(assigneeOptions, 'Unassigned'),
      groupable: true,
    },
    {
      key: 'project',
      label: projectLabel,
      type: 'relation',
      accessor: (node) => taskData(node).projectId ?? UNSET,
      options: withUnset(projectOptions, `No ${projectLabel.toLowerCase()}`),
      resolveLabel: labelFrom(projectOptions, `No ${projectLabel.toLowerCase()}`),
      groupable: true,
    },
    {
      key: 'team',
      label: 'Team',
      type: 'relation',
      accessor: (node) => taskData(node).teamId,
      options: teamOptions,
      resolveLabel: labelFrom(teamOptions, 'Team'),
      groupable: true,
    },
    {
      key: 'milestone',
      label: 'Milestone',
      type: 'relation',
      accessor: (node) => taskData(node).milestoneId ?? UNSET,
      options: withUnset(milestoneOptions, 'No milestone'),
      resolveLabel: labelFrom(milestoneOptions, 'No milestone'),
      groupable: true,
    },
  ];
}
