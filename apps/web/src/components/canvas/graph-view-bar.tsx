'use client';

/**
 * `components/canvas/graph-view-bar` — the dependency canvas's one-row view bar.
 *
 * @remarks
 * Replaces the bespoke eight-pill toolbar the canvas used to carry. Project, assignee, priority,
 * status, and the rest are now predicates behind the shared **Filter** menu, and everything about
 * how the graph is *drawn* — flow direction, critical path, ready queue, minimap, neighbourhood
 * depth — sits inside **Display**. That is the whole point of adopting
 * {@link import('../views/filter-toolbar').FilterToolbar}: a surface grows menu entries rather
 * than buttons, so the bar holds one row no matter how many capabilities the canvas gains.
 *
 * The row never wraps. Search is the only flexible child and shrinks to make room; the counts pin
 * to the trailing edge and drop their less important members on a narrow viewport rather than
 * pushing the controls onto a second line.
 */
import { Search } from '@docket/ui/icons';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  Input,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { Node } from '@xyflow/react';
import type { JSX } from 'react';

import type {
  FieldCatalog,
  ViewFilterTerm,
  ViewGroupTerm,
  ViewSortTerm,
  ViewState,
} from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';

import { type GraphDisplayState, MAX_DEPTH, MIN_DEPTH } from './graph-display';
import type { LayoutDirection } from './use-dagre-layout';

/** Live counts shown at the trailing edge of the bar. */
export interface GraphCounts {
  /** Nodes surviving the filter. */
  tasks: number;
  /** Dependency edges between them. */
  deps: number;
  /** How many of those nodes have an open blocker. */
  blocked: number;
  /** How many are actionable now. */
  ready: number;
}

/** Props for {@link GraphViewBar}. */
export interface GraphViewBarProps {
  /** The node field catalog driving the Filter menu. */
  catalog: FieldCatalog<Node>;
  /** The active query state (filters + grouping), from `useViewState`. */
  state: ViewState;
  /** Replace the active predicates. */
  onFiltersChange: (filters: readonly ViewFilterTerm[]) => void;
  /** Replace the active grouping. */
  onGroupByChange: (groupBy: ViewGroupTerm | null) => void;
  /** Replace the active sort terms (the graph declares none; wired for the shared contract). */
  onSortChange: (sort: readonly ViewSortTerm[]) => void;
  /** The canvas presentation options. */
  display: GraphDisplayState;
  /** Patch one or more presentation options. */
  onDisplayChange: (patch: Partial<GraphDisplayState>) => void;
  /** Whether the scope is a task neighbourhood (only then is depth meaningful). */
  showDepth: boolean;
  /** The effective neighbourhood depth. */
  depth: number;
  /** Live counts for the status line. */
  counts: GraphCounts;
}

/** Human label for a layout direction. */
const DIRECTION_LABEL: Record<LayoutDirection, string> = {
  LR: 'Left to right',
  TB: 'Top to bottom',
};
const DIRECTIONS: readonly LayoutDirection[] = ['LR', 'TB'];

/** The canvas's presentation section, appended inside the shared Display menu. */
function GraphDisplayExtras({
  display,
  onDisplayChange,
  showDepth,
  depth,
  readyCount,
}: {
  display: GraphDisplayState;
  onDisplayChange: (patch: Partial<GraphDisplayState>) => void;
  showDepth: boolean;
  depth: number;
  readyCount: number;
}): JSX.Element {
  return (
    <>
      <DropdownMenuLabel>Layout</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={display.direction}
        onValueChange={(next) => {
          onDisplayChange({ direction: next as LayoutDirection });
        }}
      >
        {DIRECTIONS.map((dir) => (
          <DropdownMenuRadioItem key={dir} value={dir}>
            {DIRECTION_LABEL[dir]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>

      <DropdownMenuSeparator />
      <DropdownMenuLabel>Overlays</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        checked={display.critical}
        onCheckedChange={(checked) => {
          onDisplayChange({ critical: checked });
        }}
      >
        Critical path
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={display.ready}
        onCheckedChange={(checked) => {
          onDisplayChange({ ready: checked });
        }}
      >
        Ready queue ({readyCount})
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={display.minimap}
        onCheckedChange={(checked) => {
          onDisplayChange({ minimap: checked });
        }}
      >
        Minimap
      </DropdownMenuCheckboxItem>

      {showDepth ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Neighbourhood depth</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={String(depth)}
            onValueChange={(next) => {
              onDisplayChange({ depth: Number.parseInt(next, 10) });
            }}
          >
            {Array.from({ length: MAX_DEPTH - MIN_DEPTH + 1 }, (_, i) => MIN_DEPTH + i).map((n) => (
              <DropdownMenuRadioItem key={n} value={String(n)}>
                {n === 1 ? '1 hop' : `${String(n)} hops`}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </>
      ) : null}
    </>
  );
}

/** The canvas view bar: search, Filter, Display, and the live counts. */
export default function GraphViewBar({
  catalog,
  state,
  onFiltersChange,
  onGroupByChange,
  onSortChange,
  display,
  onDisplayChange,
  showDepth,
  depth,
  counts,
}: GraphViewBarProps): JSX.Element {
  return (
    <FilterToolbar
      catalog={catalog}
      state={state}
      onFiltersChange={onFiltersChange}
      onGroupByChange={onGroupByChange}
      onSortChange={onSortChange}
      leading={
        <div className="relative min-w-24 shrink basis-56">
          <Search
            className="text-on-surface-variant pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            value={display.search}
            onChange={(e) => {
              onDisplayChange({ search: e.target.value });
            }}
            placeholder="Search"
            aria-label="Search tasks by title"
            className="min-h-10 w-full pl-8 @2xl:min-h-8"
          />
        </div>
      }
      displayExtras={
        <GraphDisplayExtras
          display={display}
          onDisplayChange={onDisplayChange}
          showDepth={showDepth}
          depth={depth}
          readyCount={counts.ready}
        />
      }
      saveSlot={
        <span className="text-on-surface-variant text-label-medium shrink-0 whitespace-nowrap">
          <span className="hidden @2xl:inline">
            {counts.tasks} tasks · {counts.deps} deps ·{' '}
          </span>
          <span className={cn(counts.blocked > 0 && 'text-state-started')}>
            {counts.blocked} blocked
          </span>
        </span>
      }
    />
  );
}
