'use client';

/**
 * `views` — the unified, drop-in **filter toolbar** every Docket list page adopts.
 *
 * @remarks
 * This is the one filter vocabulary that replaces the app's piecewise, per-page controls (the
 * bespoke Projects status menu, the hard-coded Initiatives/Cycles grouping, the controls
 * Programs/Teams lacked). It mirrors Linear's single bar: an **Add filter** menu that produces
 * removable filter **chips**, a **Group by** control, a **Sort by** control with an
 * ascending/descending toggle, and an optional **Save view** slot — all built on the Phase A
 * primitives ({@link DropdownMenu} / {@link Popover}, the shared focus ring, the density rhythm)
 * with real labels (no eyebrows / uppercase).
 *
 * A page wires it in three lines: declare a {@link FieldCatalog} for its row type, hold the state
 * with {@link import('./use-view-state').useViewState} (URL-persisted), and render
 * `<FilterToolbar catalog={…} state={state} on…={…} />`. The toolbar is fully controlled — it
 * owns no state — so the same state drives both the toolbar and the page's
 * {@link import('./apply-view').applyView} call. Every affordance is keyboard-reachable and the
 * value chooser reads the catalog's options (sync or lazily resolved from loaded page data), so
 * filtering by an enum (status, health) or a relation (lead, team) needs no per-page UI.
 */
import { ChevronDown, Filter, X } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  focusRing,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui';
import { type JSX, type ReactNode } from 'react';

import { describeFilterTerm } from './apply-view';
import {
  type FieldCatalog,
  type FilterOperator,
  type ViewFilterTerm,
  type ViewGroupTerm,
  type ViewSortTerm,
  type ViewState,
  filterableFields,
  findField,
  groupableFields,
  sortableFields,
} from './field-catalog';
import { AddFilterMenu } from './add-filter-menu';

/** Props for {@link FilterToolbar}. */
export interface FilterToolbarProps<T> {
  /** The page's field catalog (what can be filtered / grouped / sorted). */
  catalog: FieldCatalog<T>;
  /** The active view state (controlled — typically from `useViewState`). */
  state: ViewState;
  /** Replace the active filter predicates. */
  onFiltersChange: (filters: readonly ViewFilterTerm[]) => void;
  /** Replace the active grouping (or clear with `null`). */
  onGroupByChange: (groupBy: ViewGroupTerm | null) => void;
  /** Replace the active sort terms. */
  onSortChange: (sort: readonly ViewSortTerm[]) => void;
  /**
   * An optional trailing slot, pinned to the bar's end — typically a "Save view" button. Rendered
   * after a flexible spacer so it sits opposite the controls.
   */
  saveSlot?: ReactNode;
}

/**
 * The unified filter / group / sort toolbar.
 *
 * @typeParam T - The page's row type.
 * @param props - The {@link FilterToolbarProps}.
 * @returns the control bar plus the active-filter chip row.
 */
export function FilterToolbar<T>({
  catalog,
  state,
  onFiltersChange,
  onGroupByChange,
  onSortChange,
  saveSlot,
}: FilterToolbarProps<T>): JSX.Element {
  const groupable = groupableFields(catalog);
  const sortable = sortableFields(catalog);
  const filterable = filterableFields(catalog);

  const groupField = state.groupBy ? findField(catalog, state.groupBy.field) : null;
  const primarySort = state.sort[0] ?? null;
  const sortField = primarySort ? findField(catalog, primarySort.field) : null;

  /** Append a predicate to the active set. */
  function addFilter(field: string, op: FilterOperator, value: unknown): void {
    onFiltersChange([...state.filters, { field, op, value }]);
  }
  /** Remove the predicate at `index`. */
  function removeFilter(index: number): void {
    onFiltersChange(state.filters.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {filterable.length > 0 ? <AddFilterMenu fields={filterable} onAdd={addFilter} /> : null}

        {(groupable.length > 0 || sortable.length > 0) && filterable.length > 0 ? (
          <span className="bg-outline-variant mx-0.5 h-5 w-px" aria-hidden="true" />
        ) : null}

        {groupable.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <span className="text-on-surface-variant">Group by</span>
                <span>{groupField ? groupField.label : 'None'}</span>
                <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[12rem]">
              <DropdownMenuLabel>Group by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  onGroupByChange(null);
                }}
              >
                No grouping
              </DropdownMenuItem>
              {groupable.map((field) => (
                <DropdownMenuItem
                  key={field.key}
                  onSelect={() => {
                    onGroupByChange({ field: field.key });
                  }}
                >
                  {field.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {sortable.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <span className="text-on-surface-variant">Sort by</span>
                <span>{sortField ? sortField.label : 'Default'}</span>
                <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[12rem]">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  onSortChange([]);
                }}
              >
                Default order
              </DropdownMenuItem>
              {sortable.map((field) => (
                <DropdownMenuItem
                  key={field.key}
                  onSelect={() => {
                    onSortChange([{ field: field.key, dir: primarySort?.dir ?? 'asc' }]);
                  }}
                >
                  {field.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {primarySort ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              onSortChange([
                { field: primarySort.field, dir: primarySort.dir === 'asc' ? 'desc' : 'asc' },
              ]);
            }}
            aria-label={`Toggle sort direction, currently ${primarySort.dir === 'asc' ? 'ascending' : 'descending'}`}
          >
            {primarySort.dir === 'asc' ? 'Ascending' : 'Descending'}
            <ChevronDown
              className={cn('size-3.5', primarySort.dir === 'asc' && 'rotate-180')}
              aria-hidden="true"
            />
          </Button>
        ) : null}

        {saveSlot ? (
          <>
            <span className="flex-1" aria-hidden="true" />
            {saveSlot}
          </>
        ) : null}
      </div>

      {state.filters.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {state.filters.map((filter, index) => {
            const description = describeFilterTerm(filter, catalog);
            return (
              <li key={`${filter.field}-${filter.op}-${index}`}>
                <span className="border-outline-variant bg-surface-container inline-flex items-center gap-1.5 rounded-md border py-1 pr-1 pl-2.5 text-xs">
                  <Filter className="text-on-surface-variant size-3.5" aria-hidden="true" />
                  <span>{description}</span>
                  <button
                    type="button"
                    onClick={() => {
                      removeFilter(index);
                    }}
                    aria-label={`Remove filter ${description}`}
                    className={cn(
                      'hover:bg-surface-container-high rounded p-0.5 outline-none',
                      focusRing,
                    )}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
