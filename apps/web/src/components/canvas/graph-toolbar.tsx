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
  /** Live counts for the status line. */
  counts: { tasks: number; deps: number; blocked: number };
}

/** The focused-view filter + layout toolbar. */
export default function GraphToolbar({
  filter,
  onChange,
  projectOptions,
  assigneeOptions,
  direction,
  onDirectionChange,
  counts,
}: GraphToolbarProps): React.JSX.Element {
  const priorityOptions: FilterOption[] = PRIORITY_ORDER.map((p) => ({
    value: p,
    label: PRIORITY_LABEL[p],
  }));
  const stateOptions: FilterOption[] = STATE_GROUP_ORDER.map((t) => ({
    value: t,
    label: STATE_GROUP_LABEL[t],
  }));

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
        options={priorityOptions}
        selected={filter.priorities}
        onToggle={(v) => {
          onChange({ ...filter, priorities: toggle(filter.priorities, v) });
        }}
      />
      <MultiSelect
        label="State"
        options={stateOptions}
        selected={filter.stateTypes}
        onToggle={(v) => {
          onChange({ ...filter, stateTypes: toggle(filter.stateTypes, v) });
        }}
      />

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

      <span className="text-on-surface-variant ml-auto text-xs">
        {counts.tasks} tasks · {counts.deps} deps ·{' '}
        <span className="text-state-started">{counts.blocked} blocked</span>
      </span>
    </div>
  );
}
