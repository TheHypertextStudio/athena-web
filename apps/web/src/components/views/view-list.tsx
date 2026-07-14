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
 *
 * A view's stored filters/grouping describe themselves through the shared task
 * {@link FieldCatalog} (the same one the toolbar drives), so the summary text matches the chips
 * the filter toolbar shows once the view is open.
 */
import type { SavedViewOut, TaskOut } from '@docket/types';
import { Filter, Layers } from '@docket/ui/icons';
import { cn } from '@docket/ui';
import { focusRing } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { describeFilterTerm } from './apply-view';
import type { FieldCatalog } from './field-catalog';
import { findField } from './field-catalog';
import { toViewState } from './task-catalog';
import { ViewScopeBadge } from './view-scope-badge';

/** Props for {@link ViewList}. */
export interface ViewListProps {
  /** The org's saved views. */
  views: readonly SavedViewOut[];
  /** The id of the currently-open view, or `null` when none is open. */
  activeId: string | null;
  /** Open a view. */
  onOpen: (view: SavedViewOut) => void;
  /** The task field catalog (resolves filter + grouping labels for the summary). */
  catalog: FieldCatalog<TaskOut>;
}

/**
 * A compact, plain-language summary of a view's filters + grouping for its list row.
 *
 * @remarks
 * Reads as "2 filters · Grouped by Project", "No filters", etc. — enough to recognize a view at a
 * glance without rendering every predicate. The full predicates are visible once the view is open
 * (as removable chips in the filter toolbar).
 */
function summarize(
  view: SavedViewOut,
  catalog: FieldCatalog<TaskOut>,
): { filters: string; grouping: string | null } {
  const state = toViewState({
    filters: view.filters,
    grouping: view.grouping ?? null,
    sort: view.sort,
  });
  const count = state.filters.length;
  const only = state.filters[0];
  const filters =
    count === 0
      ? 'No filters'
      : count === 1 && only
        ? describeFilterTerm(only, catalog)
        : `${String(count)} filters`;
  const grouping = state.groupBy
    ? `Grouped by ${findField(catalog, state.groupBy.field)?.label ?? state.groupBy.field}`
    : null;
  return { filters, grouping };
}

/**
 * The saved-views directory list.
 *
 * @param props - The {@link ViewListProps}.
 * @returns the rendered list of view rows.
 */
export function ViewList({ views, activeId, onOpen, catalog }: ViewListProps): JSX.Element {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Saved views">
      {views.map((view) => {
        const active = view.id === activeId;
        const summary = summarize(view, catalog);
        return (
          <li key={view.id}>
            <button
              type="button"
              onClick={() => {
                onOpen(view);
              }}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'group flex w-full flex-col gap-1.5 rounded-lg border px-4 py-3 text-left transition-colors outline-none',
                focusRing,
                active
                  ? 'border-primary/40 bg-surface-container-highest'
                  : 'border-outline-variant hover:bg-surface-container-high',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-on-surface text-body-medium truncate font-medium">{view.name}</span>
                <ViewScopeBadge scope={view.scope} />
              </div>
              <div className="text-on-surface-variant flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1">
                  <Filter className="size-3.5" aria-hidden="true" />
                  {summary.filters}
                </span>
                {summary.grouping ? (
                  <span className="inline-flex items-center gap-1">
                    <Layers className="size-3.5" aria-hidden="true" />
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
