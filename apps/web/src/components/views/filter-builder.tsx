'use client';

/**
 * `views` — the live filter / grouping / sort builder for the Saved Views screen.
 *
 * @remarks
 * Lets the viewer compose the working query that a {@link ViewRunner} renders and that the
 * Save control can persist as a new saved view (mvp-plan §8.3d). Every control is a styled
 * `@docket/ui` {@link DropdownMenu} — never a bare `<select>` — mirroring the task-detail
 * Status/Priority pickers and the Agents session filter for a cohesive feel:
 *
 * - **Add filter** opens a field menu, then an operator menu, then (for enumerable fields) a
 *   value menu; the resulting predicate is appended to the active filter set. Each active
 *   predicate renders as a removable chip describing itself in plain language
 *   ("Status is In Progress").
 * - **Group by** is a single-select menu over the groupable fields, plus "No grouping".
 * - **Sort by** is a single-select menu over the sortable fields with an ascending/descending
 *   toggle.
 *
 * The builder is fully controlled: it owns no query state, only emits changes to the parent
 * (the page), which is the single source of truth shared with the runner and the Save control.
 * Entity-noun field labels (Project, Program) are vocabulary-resolved by the parent and passed
 * in via {@link FilterBuilderProps.fieldLabel}; enumerable value labels come from the engine.
 */
import type { ViewFilter, ViewGrouping, ViewSort } from '@docket/types';
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
} from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import {
  FIELD_SPECS,
  type FieldSpec,
  type LabelResolver,
  OP_LABEL,
  type ViewOp,
  describeFilter,
} from './view-engine';

/** Props for {@link FilterBuilder}. */
export interface FilterBuilderProps {
  /** The active filter predicates. */
  filters: readonly ViewFilter[];
  /** The active grouping, or `null` for an ungrouped list. */
  grouping: ViewGrouping | null;
  /** The active sort terms (this builder edits the primary term). */
  sort: readonly ViewSort[];
  /** Replace the active filter set. */
  onFiltersChange: (filters: readonly ViewFilter[]) => void;
  /** Replace the active grouping. */
  onGroupingChange: (grouping: ViewGrouping | null) => void;
  /** Replace the active sort terms. */
  onSortChange: (sort: readonly ViewSort[]) => void;
  /** Resolve an entity-id value to its display label (project/program/assignee names). */
  resolveLabel: LabelResolver;
  /**
   * Override a field's display label (entity nouns are vocabulary-resolved by the parent).
   * Falls back to the engine's neutral label when a field is absent.
   */
  fieldLabel: (field: string, fallback: string) => string;
}

/** The groupable fields, derived once from the field catalog. */
const GROUPABLE: readonly FieldSpec[] = FIELD_SPECS.filter((spec) => spec.groupable);
/** The sortable fields, derived once from the field catalog. */
const SORTABLE: readonly FieldSpec[] = FIELD_SPECS.filter((spec) => spec.sortable);

/**
 * The filter / grouping / sort builder strip.
 *
 * @param props - The {@link FilterBuilderProps}.
 * @returns the rendered control strip with active-filter chips.
 */
export function FilterBuilder({
  filters,
  grouping,
  sort,
  onFiltersChange,
  onGroupingChange,
  onSortChange,
  resolveLabel,
  fieldLabel,
}: FilterBuilderProps): JSX.Element {
  /** Append a predicate to the active filter set. */
  function addFilter(field: string, op: ViewOp, value: unknown): void {
    onFiltersChange([...filters, { field, op, value }]);
  }

  /** Remove the predicate at `index`. */
  function removeFilter(index: number): void {
    onFiltersChange(filters.filter((_, i) => i !== index));
  }

  const primarySort = sort[0] ?? null;
  const groupSpec = grouping ? FIELD_SPECS.find((s) => s.field === grouping.by) : null;
  const sortSpec = primarySort ? FIELD_SPECS.find((s) => s.field === primarySort.field) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <AddFilterMenu onAdd={addFilter} fieldLabel={fieldLabel} />

        <span className="bg-border mx-0.5 h-5 w-px" aria-hidden="true" />

        {/* Group by */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <span className="text-on-surface-variant">Group by</span>
              <span>{groupSpec ? fieldLabel(groupSpec.field, groupSpec.label) : 'None'}</span>
              <ChevronDown className="size-4 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[12rem]">
            <DropdownMenuLabel>Group tasks by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                onGroupingChange(null);
              }}
            >
              No grouping
            </DropdownMenuItem>
            {GROUPABLE.map((spec) => (
              <DropdownMenuItem
                key={spec.field}
                onSelect={() => {
                  onGroupingChange({ by: spec.field });
                }}
              >
                {fieldLabel(spec.field, spec.label)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort by */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <span className="text-on-surface-variant">Sort by</span>
              <span>{sortSpec ? fieldLabel(sortSpec.field, sortSpec.label) : 'Default'}</span>
              <ChevronDown className="size-4 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[12rem]">
            <DropdownMenuLabel>Sort tasks by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                onSortChange([]);
              }}
            >
              Default order
            </DropdownMenuItem>
            {SORTABLE.map((spec) => (
              <DropdownMenuItem
                key={spec.field}
                onSelect={() => {
                  onSortChange([{ field: spec.field, order: primarySort?.order ?? 'asc' }]);
                }}
              >
                {fieldLabel(spec.field, spec.label)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {primarySort ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              onSortChange([
                { field: primarySort.field, order: primarySort.order === 'asc' ? 'desc' : 'asc' },
              ]);
            }}
            aria-label={`Toggle sort direction, currently ${primarySort.order === 'asc' ? 'ascending' : 'descending'}`}
          >
            {primarySort.order === 'asc' ? 'Ascending' : 'Descending'}
            <ChevronDown
              className={primarySort.order === 'asc' ? 'size-4 rotate-180' : 'size-4'}
              aria-hidden="true"
            />
          </Button>
        ) : null}
      </div>

      {filters.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {filters.map((filter, index) => (
            <li key={`${filter.field}-${filter.op}-${index}`}>
              <span className="border-outline-variant bg-surface-container inline-flex items-center gap-1.5 rounded-md border py-1 pr-1 pl-2.5 text-xs">
                <Filter className="text-on-surface-variant size-3" aria-hidden="true" />
                <span>
                  {describeFilter(filter, (field, value) =>
                    resolveLabelWith(field, value, resolveLabel),
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    removeFilter(index);
                  }}
                  aria-label={`Remove filter ${describeFilter(filter, (f, v) => resolveLabelWith(f, v, resolveLabel))}`}
                  className="hover:bg-surface-container-high focus-visible:ring-ring rounded p-0.5 outline-none focus-visible:ring-1"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A {@link LabelResolver} that tolerates a `null` value (chips never pass null). */
function resolveLabelWith(field: string, value: string | null, resolve: LabelResolver): string {
  return resolve(field, value);
}

/** Props for {@link AddFilterMenu}. */
interface AddFilterMenuProps {
  /** Append a predicate. */
  onAdd: (field: string, op: ViewOp, value: unknown) => void;
  /** Override a field's display label. */
  fieldLabel: (field: string, fallback: string) => string;
}

/**
 * The "Add filter" control: a nested field → operator → value menu.
 *
 * @remarks
 * For enumerable fields (status, priority) the value step is a third nested submenu of the
 * field's options, so the whole predicate is composed without ever typing. For free-text /
 * id fields the menu offers the field's operators with a single text-entry value step inline
 * (a controlled {@link Input} inside the menu), keeping every affordance keyboard-reachable.
 */
function AddFilterMenu({ onAdd, fieldLabel }: AddFilterMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="size-4" aria-hidden="true" />
          Add filter
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel>Filter where…</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FIELD_SPECS.map((spec) => (
          <DropdownMenuSub key={spec.field}>
            <DropdownMenuSubTrigger>{fieldLabel(spec.field, spec.label)}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[14rem]">
              {spec.ops.map((op) => (
                <OpBranch
                  key={op}
                  spec={spec}
                  op={op}
                  onAdd={(value) => {
                    onAdd(spec.field, op, value);
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

/** Props for {@link OpBranch}. */
interface OpBranchProps {
  /** The field being filtered. */
  spec: FieldSpec;
  /** The operator for this branch. */
  op: ViewOp;
  /** Commit the predicate's value. */
  onAdd: (value: unknown) => void;
}

/**
 * One operator branch in the Add-filter menu.
 *
 * @remarks
 * Enumerable fields render a further submenu of value options (single-select for scalar
 * operators, additive for `in`/`nin` — each pick appends a one-value predicate the engine
 * folds together). Free-text / id fields render an inline text-entry row committed on Enter.
 */
function OpBranch({ spec, op, onAdd }: OpBranchProps): JSX.Element {
  const opLabel = OP_LABEL[op];

  if (spec.options) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{opLabel}…</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-[12rem]">
          {spec.options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => {
                onAdd(op === 'in' || op === 'nin' ? [option.value] : option.value);
              }}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
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
          type={spec.field === 'dueDate' ? 'date' : 'text'}
          onCommit={onAdd}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** Props for {@link ValueEntry}. */
interface ValueEntryProps {
  /** Placeholder for the entry input. */
  placeholder: string;
  /** Input type (`text` for titles, `date` for the due-date field). */
  type: 'text' | 'date';
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
