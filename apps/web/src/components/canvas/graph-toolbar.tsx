'use client';

/**
 * `components/canvas/graph-toolbar` — the focused-view filter + layout bar.
 *
 * @remarks
 * A lightweight, canvas-specific toolbar (not the heavy views engine): title search + multi-select
 * chips for project / assignee / priority / state, a left↔right / top↕bottom layout toggle, and a
 * live count + legend. State is owned by the host (`TaskGraphPanel`); this renders controls and
 * emits a new {@link GraphFilter} on every change. Filtering itself happens in the host so edges
 * can be pruned to surviving endpoints.
 */
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from '@docket/ui/primitives';

import { PRIORITY_LABEL, PRIORITY_ORDER } from '@/components/task-detail/priority';
import { STATE_GROUP_LABEL, STATE_GROUP_ORDER } from '@/lib/work-state';

import type { LayoutDirection } from './use-dagre-layout';

/** A selectable filter option. */
export interface FilterOption {
  /** The stored value. */
  value: string;
  /** The human label. */
  label: string;
}

/** The canvas filter state (empty sets = no filtering on that facet). */
export interface GraphFilter {
  /** Title substring (case-insensitive). */
  search: string;
  /** Allowed project ids (empty = all). */
  projects: Set<string>;
  /** Allowed assignee actor ids; `__none__` matches unassigned (empty = all). */
  assignees: Set<string>;
  /** Allowed priorities (empty = all). */
  priorities: Set<string>;
  /** Allowed canonical state types (empty = all). */
  stateTypes: Set<string>;
}

/** Sentinel value for the "unassigned" assignee filter. */
export const UNASSIGNED = '__none__';

/** The axis the canvas can group tasks into swimlanes by. */
export type GroupBy = 'none' | 'project' | 'team' | 'milestone';

/** Display labels for each {@link GroupBy} option. */
const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: 'No grouping',
  project: 'Project',
  team: 'Team',
  milestone: 'Milestone',
};
const GROUP_BY_ORDER: readonly GroupBy[] = ['none', 'project', 'team', 'milestone'];

/** Priority filter options (fixed ordering — hoisted so they aren't rebuilt per render). */
const PRIORITY_OPTIONS: readonly FilterOption[] = PRIORITY_ORDER.map((p) => ({
  value: p,
  label: PRIORITY_LABEL[p],
}));

/** Canonical state-type filter options (fixed ordering). */
const STATE_OPTIONS: readonly FilterOption[] = STATE_GROUP_ORDER.map((t) => ({
  value: t,
  label: STATE_GROUP_LABEL[t],
}));

/** An empty filter (everything visible). */
export const EMPTY_FILTER: GraphFilter = {
  search: '',
  projects: new Set(),
  assignees: new Set(),
  priorities: new Set(),
  stateTypes: new Set(),
};

/** Toggle a value in a `Set`, returning a new `Set`. */
function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** A labeled multi-select dropdown of checkboxes. */
function MultiSelect({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly FilterOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}): React.JSX.Element {
  if (options.length === 0) {
    return (
      <Button type="button" size="sm" variant="outline" disabled className="gap-1">
        {label}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={selected.size > 0 ? 'default' : 'outline'}
          className="gap-1"
        >
          {label}
          {selected.size > 0 ? <span className="text-xs">({selected.size})</span> : null}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.has(o.value)}
            onSelect={(e) => {
              e.preventDefault();
              onToggle(o.value);
            }}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Props for {@link GraphToolbar}. */
export interface GraphToolbarProps {
  /** Current filter. */
  filter: GraphFilter;
  /** Emit a new filter. */
  onChange: (next: GraphFilter) => void;
  /** Project options (id → name). */
  projectOptions: readonly FilterOption[];
  /** Assignee options (actorId → name); the host prepends "Unassigned". */
  assigneeOptions: readonly FilterOption[];
  /** Current layout direction. */
  direction: LayoutDirection;
  /** Emit a new layout direction. */
  onDirectionChange: (direction: LayoutDirection) => void;
  /** Current grouping axis. */
  groupBy: GroupBy;
  /** Emit a new grouping axis. */
  onGroupByChange: (groupBy: GroupBy) => void;
  /** Whether critical-path highlighting is on. */
  showCritical: boolean;
  /** Toggle critical-path highlighting. */
  onToggleCritical: () => void;
  /** Whether the ready-queue panel is shown. */
  showReady: boolean;
  /** Toggle the ready-queue panel. */
  onToggleReady: () => void;
  /** Neighborhood depth control (only shown when `onDepthChange` is provided). */
  depth?: number;
  /** Change the neighborhood depth (1–5); absent outside the neighborhood scope. */
  onDepthChange?: (depth: number) => void;
  /** Live counts for the status line. */
  counts: { tasks: number; deps: number; blocked: number; ready: number };
}

/** The focused-view filter + layout toolbar. */
export default function GraphToolbar({
  filter,
  onChange,
  projectOptions,
  assigneeOptions,
  direction,
  onDirectionChange,
  groupBy,
  onGroupByChange,
  showCritical,
  onToggleCritical,
  showReady,
  onToggleReady,
  depth,
  onDepthChange,
  counts,
}: GraphToolbarProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={filter.search}
        onChange={(e) => {
          onChange({ ...filter, search: e.target.value });
        }}
        placeholder="Search…"
        className="h-8 w-44"
        aria-label="Search tasks by title"
      />
      <MultiSelect
        label="Project"
        options={projectOptions}
        selected={filter.projects}
        onToggle={(v) => {
          onChange({ ...filter, projects: toggle(filter.projects, v) });
        }}
      />
      <MultiSelect
        label="Assignee"
        options={assigneeOptions}
        selected={filter.assignees}
        onToggle={(v) => {
          onChange({ ...filter, assignees: toggle(filter.assignees, v) });
        }}
      />
      <MultiSelect
        label="Priority"
        options={PRIORITY_OPTIONS}
        selected={filter.priorities}
        onToggle={(v) => {
          onChange({ ...filter, priorities: toggle(filter.priorities, v) });
        }}
      />
      <MultiSelect
        label="State"
        options={STATE_OPTIONS}
        selected={filter.stateTypes}
        onToggle={(v) => {
          onChange({ ...filter, stateTypes: toggle(filter.stateTypes, v) });
        }}
      />

      <Button
        type="button"
        size="sm"
        variant={showCritical ? 'default' : 'outline'}
        onClick={onToggleCritical}
        aria-pressed={showCritical}
      >
        Critical path
      </Button>
      <Button
        type="button"
        size="sm"
        variant={showReady ? 'default' : 'outline'}
        onClick={onToggleReady}
        aria-pressed={showReady}
      >
        Ready ({counts.ready})
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant={groupBy === 'none' ? 'outline' : 'default'}
            className="gap-1"
          >
            Group: {GROUP_BY_LABELS[groupBy]}
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Group by</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={groupBy}
            onValueChange={(v) => {
              onGroupByChange(v as GroupBy);
            }}
          >
            {GROUP_BY_ORDER.map((g) => (
              <DropdownMenuRadioItem key={g} value={g}>
                {GROUP_BY_LABELS[g]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          onDirectionChange(direction === 'LR' ? 'TB' : 'LR');
        }}
        aria-label="Toggle layout direction"
        title={direction === 'LR' ? 'Left → right' : 'Top ↓ bottom'}
      >
        {direction === 'LR' ? 'Horizontal' : 'Vertical'}
      </Button>

      {onDepthChange !== undefined && depth !== undefined ? (
        <div className="border-outline-variant flex items-center gap-1 rounded-md border px-1">
          <button
            type="button"
            aria-label="Decrease depth"
            disabled={depth <= 1}
            onClick={() => {
              onDepthChange(Math.max(1, depth - 1));
            }}
            className="text-on-surface-variant hover:text-on-surface px-1 disabled:opacity-40"
          >
            −
          </button>
          <span className="text-on-surface-variant text-xs">depth {depth}</span>
          <button
            type="button"
            aria-label="Increase depth"
            disabled={depth >= 5}
            onClick={() => {
              onDepthChange(Math.min(5, depth + 1));
            }}
            className="text-on-surface-variant hover:text-on-surface px-1 disabled:opacity-40"
          >
            +
          </button>
        </div>
      ) : null}

      <span className="text-on-surface-variant ml-auto text-xs">
        {counts.tasks} tasks · {counts.deps} deps ·{' '}
        <span className="text-state-started">{counts.blocked} blocked</span>
      </span>
    </div>
  );
}
