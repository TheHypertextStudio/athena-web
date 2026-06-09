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
import { ChevronDown, Filter, Plus, X } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  focusRing,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui';
import { type JSX, type ReactNode, useState } from 'react';

import { describeFilterTerm } from './apply-view';
import {
  type FieldCatalog,
  type FieldDescriptor,
  type FilterOperator,
  type ViewFilterTerm,
  type ViewGroupTerm,
  type ViewSortTerm,
  type ViewState,
  OPERATOR_LABEL,
  filterableFields,
  findField,
  groupableFields,
  operatorsForType,
  optionsFor,
  sortableFields,
} from './field-catalog';

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

/** Props for {@link AddFilterMenu}. */
interface AddFilterMenuProps<T> {
  /** The filterable fields. */
  fields: FieldCatalog<T>;
  /** Append a predicate. */
  onAdd: (field: string, op: FilterOperator, value: unknown) => void;
}

/**
 * The "Add filter" control: a nested field → operator → value menu.
 *
 * @remarks
 * For enum/relation fields the value step is a third nested submenu of the field's options, so
 * the whole predicate composes without typing. For free-text / date fields the value step is an
 * inline entry committed on Enter. The menu closes once a predicate is committed.
 */
function AddFilterMenu<T>({ fields, onAdd }: AddFilterMenuProps<T>): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="size-3.5" aria-hidden="true" />
          Add filter
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel>Filter where</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {fields.map((field) => (
          <DropdownMenuSub key={field.key}>
            <DropdownMenuSubTrigger>{field.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[14rem]">
              {operatorsForType(field.type).map((op) => (
                <OperatorBranch
                  key={op}
                  field={field}
                  op={op}
                  onCommit={(value) => {
                    onAdd(field.key, op, value);
                    setOpen(false);
                  }}
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Props for {@link OperatorBranch}. */
interface OperatorBranchProps<T> {
  /** The field being filtered. */
  field: FieldDescriptor<T>;
  /** The operator for this branch. */
  op: FilterOperator;
  /** Commit the predicate's value. */
  onCommit: (value: unknown) => void;
}

/**
 * One operator branch in the Add-filter menu.
 *
 * @remarks
 * Enum/relation fields render a value submenu over the field's options; `in`/`nin` append a
 * one-value predicate per pick (the engine folds membership). Free-text / date fields render an
 * inline entry row.
 */
function OperatorBranch<T>({ field, op, onCommit }: OperatorBranchProps<T>): JSX.Element {
  const opLabel = OPERATOR_LABEL[op];
  const hasOptions = field.type === 'enum' || field.type === 'relation';

  if (hasOptions) {
    const options = optionsFor(field);
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{opLabel}…</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-[12rem]">
          {options.length === 0 ? (
            <DropdownMenuItem disabled>No options</DropdownMenuItem>
          ) : (
            options.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => {
                  onCommit(op === 'in' || op === 'nin' ? [option.value] : option.value);
                }}
              >
                {option.label}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{opLabel}…</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[14rem] p-2">
        <ValueEntry
          placeholder={`${opLabel}…`}
          type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
          onCommit={onCommit}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** Props for {@link ValueEntry}. */
interface ValueEntryProps {
  /** Placeholder for the entry input. */
  placeholder: string;
  /** Input type (text / date / number). */
  type: 'text' | 'date' | 'number';
  /** Commit the entered value. */
  onCommit: (value: string) => void;
}

/** A small inline value-entry row committed on Enter (used inside the Add-filter menu). */
function ValueEntry({ placeholder, type, onCommit }: ValueEntryProps): JSX.Element {
  const [value, setValue] = useState('');
  return (
    <Input
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      autoFocus
      className="h-8"
      onChange={(event) => {
        setValue(event.target.value);
      }}
      onKeyDown={(event) => {
        // Keep typing keys inside the input rather than triggering menu typeahead.
        event.stopPropagation();
        if (event.key === 'Enter' && value.trim().length > 0) {
          event.preventDefault();
          onCommit(value.trim());
        }
      }}
    />
  );
}
