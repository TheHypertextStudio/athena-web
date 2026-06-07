'use client';

/**
 * `views` — the directory of the org's saved views.
 *
 * @remarks
 * Lists every saved view the API returned for the org (mvp-plan §8.3d), each as a selectable
 * row showing the view's name, its sharing-{@link ViewScopeBadge | scope} badge, and a compact
 * description of what it filters/groups (so a view's intent reads without opening it). Selecting
 * a row opens that view in the runner; the active row is highlighted and exposes
 * `aria-current`. The list is a single keyboard-navigable column of buttons with visible focus
 * rings. All color comes from semantic tokens.
 */
import type { SavedViewOut } from '@docket/types';
import { Filter, Layers } from '@docket/ui/icons';
import { cn } from '@docket/ui';
import type { JSX } from 'react';

import { type LabelResolver, describeFilter } from './view-engine';
import { ViewScopeBadge } from './view-scope-badge';

/** Props for {@link ViewList}. */
export interface ViewListProps {
  /** The org's saved views. */
  views: readonly SavedViewOut[];
  /** The id of the currently-open view, or `null` when none is open. */
  activeId: string | null;
  /** Open a view. */
  onOpen: (view: SavedViewOut) => void;
  /** Resolve an entity-id value/grouping field to its display label. */
  resolveLabel: LabelResolver;
  /** Resolve a grouping field to its (vocabulary) label. */
  groupingLabel: (field: string) => string;
}

/**
 * A compact, plain-language summary of a view's filters + grouping for its list row.
 *
 * @remarks
 * Reads as "2 filters · grouped by Project", "No filters", etc. — enough to recognize a view
 * at a glance without rendering every predicate. The full predicates are visible once the view
 * is open (as removable chips in the filter builder).
 */
function summarize(
  view: SavedViewOut,
  resolveLabel: LabelResolver,
  groupingLabel: (field: string) => string,
): { filters: string; grouping: string | null } {
  const count = view.filters.length;
  const only = view.filters[0];
  const filters =
    count === 0
      ? 'No filters'
      : count === 1 && only
        ? describeFilter(only, resolveLabel)
        : `${String(count)} filters`;
  const grouping = view.grouping ? `Grouped by ${groupingLabel(view.grouping.by)}` : null;
  return { filters, grouping };
}

/**
 * The saved-views directory list.
 *
 * @param props - The {@link ViewListProps}.
 * @returns the rendered list of view rows.
 */
export function ViewList({
  views,
  activeId,
  onOpen,
  resolveLabel,
  groupingLabel,
}: ViewListProps): JSX.Element {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Saved views">
      {views.map((view) => {
        const active = view.id === activeId;
        const summary = summarize(view, resolveLabel, groupingLabel);
        return (
          <li key={view.id}>
            <button
              type="button"
              onClick={() => {
                onOpen(view);
              }}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'group focus-visible:ring-ring flex w-full flex-col gap-1.5 rounded-lg border px-4 py-3 text-left transition-colors outline-none focus-visible:ring-1',
                active
                  ? 'border-primary/40 bg-accent'
                  : 'border-border hover:border-border hover:bg-accent/50',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-foreground truncate text-sm font-medium">{view.name}</span>
                <ViewScopeBadge scope={view.scope} />
              </div>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1">
                  <Filter className="size-3" aria-hidden="true" />
                  {summary.filters}
                </span>
                {summary.grouping ? (
                  <span className="inline-flex items-center gap-1">
                    <Layers className="size-3" aria-hidden="true" />
                    {summary.grouping}
                  </span>
                ) : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
