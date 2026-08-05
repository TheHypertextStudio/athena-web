'use client';

/**
 * `views` — the unified, drop-in **view bar** every Docket list page adopts.
 *
 * @remarks
 * This is the one control vocabulary that replaces the app's piecewise, per-page controls (the
 * bespoke Projects status menu, the hard-coded Initiatives/Cycles grouping, the controls
 * Programs/Teams lacked).
 *
 * It presents exactly **two** affordances, which is the whole design:
 *
 * - **Filter** — which rows are in the list. Active predicates become removable chips beneath the
 *   bar, so the applied state stays visible without a control per field.
 * - **Display** — how those rows are arranged and drawn: grouping, ordering, and any options the
 *   surface itself contributes through {@link FilterToolbarProps.displayExtras}.
 *
 * Earlier this bar spent a bordered pill each on "Add filter", "Group by", "Sort by", and a sort
 * direction toggle, and a page then added its own lens switcher and view-specific controls beside
 * them. The result read as an undifferentiated field of buttons with no hierarchy, and it wrapped
 * to three rows on a phone — pushing the actual content below the fold. Grouping and ordering are
 * *presentation*, so they belong in Display; the page keeps one row no matter how many
 * capabilities the surface has, because a new capability lands inside a menu rather than beside it.
 *
 * A page wires it in three lines: declare a {@link FieldCatalog} for its row type, hold the state
 * with {@link import('./use-view-state').useViewState} (URL-persisted), and render
 * `<FilterToolbar catalog={…} state={state} on…={…} />`. The toolbar is fully controlled — it owns
 * no state — so the same state drives both the bar and the page's
 * {@link import('./apply-view').applyView} call. Every affordance is keyboard-reachable and the
 * value chooser reads the catalog's options (sync or lazily resolved from loaded page data), so
 * filtering by an enum (status, health) or a relation (lead, team) needs no per-page UI.
 */
import { ChevronDown, Filter, TuneRounded, X } from '@docket/ui/icons';
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
  groupableFields,
  sortableFields,
} from './field-catalog';
import { AddFilterMenu } from './add-filter-menu';

/** The sentinel value for "no grouping" in the Display menu's radio group. */
const NO_GROUPING = '__none__';
/** The sentinel value for "default order" in the Display menu's radio group. */
const DEFAULT_ORDER = '__default__';

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
   * Extra sections appended inside the **Display** menu — a surface's own presentation options
   * (a timeline's scale, density, and axis navigation, say).
   *
   * @remarks
   * This extension point exists so a surface with more capabilities does not grow more *buttons*.
   * Anything about how rows are drawn belongs in this menu beside grouping and ordering, rather
   * than as another pill competing with them for the same row.
   */
  displayExtras?: ReactNode;
  /**
   * A leading slot rendered before the Filter button — typically a lens switcher.
   *
   * @remarks
   * Taken as a slot so the bar stays one flex row that this component controls, instead of a page
   * stacking its own control row above it.
   */
  leading?: ReactNode;
  /**
   * An optional trailing slot, pinned to the bar's end — typically a "Save view" button. Rendered
   * after a flexible spacer so it sits opposite the controls.
   */
  saveSlot?: ReactNode;
}

/**
 * The unified view bar: Filter, Display, and the active-filter chips.
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
  displayExtras,
  leading,
  saveSlot,
}: FilterToolbarProps<T>): JSX.Element {
  const groupable = groupableFields(catalog);
  const sortable = sortableFields(catalog);
  const filterable = filterableFields(catalog);

  const primarySort = state.sort[0] ?? null;
  const hasDisplay = groupable.length > 0 || sortable.length > 0 || displayExtras !== undefined;

  /** Append a predicate to the active set. */
  function addFilter(field: string, op: FilterOperator, value: unknown): void {
    onFiltersChange([...state.filters, { field, op, value }]);
  }
  /** Remove the predicate at `index`. */
  function removeFilter(index: number): void {
    onFiltersChange(state.filters.filter((_, i) => i !== index));
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {leading}

        {filterable.length > 0 ? <AddFilterMenu fields={filterable} onAdd={addFilter} /> : null}

        {hasDisplay ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="min-h-10 gap-1.5 @2xl:min-h-8">
                <TuneRounded className="size-4" aria-hidden="true" />
                <span className="hidden @2xl:inline">Display</span>
                <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" width="md">
              {groupable.length > 0 ? (
                <>
                  <DropdownMenuLabel>Grouping</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={state.groupBy?.field ?? NO_GROUPING}
                    onValueChange={(next) => {
                      onGroupByChange(next === NO_GROUPING ? null : { field: next });
                    }}
                  >
                    <DropdownMenuRadioItem value={NO_GROUPING}>No grouping</DropdownMenuRadioItem>
                    {groupable.map((field) => (
                      <DropdownMenuRadioItem key={field.key} value={field.key}>
                        {field.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              ) : null}

              {groupable.length > 0 && sortable.length > 0 ? <DropdownMenuSeparator /> : null}

              {sortable.length > 0 ? (
                <>
                  <DropdownMenuLabel>Ordering</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={primarySort?.field ?? DEFAULT_ORDER}
                    onValueChange={(next) => {
                      onSortChange(
                        next === DEFAULT_ORDER
                          ? []
                          : [{ field: next, dir: primarySort?.dir ?? 'asc' }],
                      );
                    }}
                  >
                    <DropdownMenuRadioItem value={DEFAULT_ORDER}>
                      Default order
                    </DropdownMenuRadioItem>
                    {sortable.map((field) => (
                      <DropdownMenuRadioItem key={field.key} value={field.key}>
                        {field.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  {primarySort ? (
                    <DropdownMenuCheckboxItem
                      checked={primarySort.dir === 'desc'}
                      onCheckedChange={(checked) => {
                        onSortChange([{ field: primarySort.field, dir: checked ? 'desc' : 'asc' }]);
                      }}
                    >
                      Reverse order
                    </DropdownMenuCheckboxItem>
                  ) : null}
                </>
              ) : null}

              {displayExtras !== undefined && (groupable.length > 0 || sortable.length > 0) ? (
                <DropdownMenuSeparator />
              ) : null}
              {displayExtras}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {saveSlot ? (
          <>
            <span className="flex-1" aria-hidden="true" />
            {saveSlot}
          </>
        ) : null}
      </div>

      {/*
        Active predicates stay visible as removable chips. This is what lets Filter be a single
        control: the applied state lives here in the open, rather than being implied by a row of
        controls each of which must be read to know what is in effect.
      */}
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
