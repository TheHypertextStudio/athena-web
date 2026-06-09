/**
 * `views` — the reusable, typed **field catalog** model that lets any list page declare its
 * filterable / groupable / sortable fields once, and drop in the shared {@link FilterToolbar}
 * over it.
 *
 * @remarks
 * Docket's lists were piecewise: Projects had a bespoke single-select status menu, Initiatives /
 * Cycles hard-coded their grouping, Programs / Teams had nothing. This module is the foundation
 * of the unified, Linear-style filter vocabulary that replaces all of that — a single
 * declaration of *what can be filtered* that the toolbar UI, the URL serializer, and the pure
 * apply engine all read.
 *
 * A {@link FieldCatalog} is an ordered list of {@link FieldDescriptor}s, each describing one
 * field of the row type `T`:
 *
 * - **`key`** — the stable identifier used in the URL and in stored predicates.
 * - **`label`** — the human noun shown in menus and chips ("Status", "Lead"). Entity nouns are
 *   vocabulary-resolved by the page before being handed to the catalog.
 * - **`type`** — the value type ({@link FieldValueType}), which selects the natural operator set
 *   and the value-entry affordance (a chooser for enum/relation fields, a text box for free
 *   text, a date picker for dates).
 * - **`accessor`** — a pure function reading the row's comparable scalar for this field, used by
 *   filtering, grouping, and sorting alike.
 * - **`options` / `resolveLabel`** — for enum/relation fields, the choosable values (sync
 *   `options`, or an async/lazy `resolveOptions`) and a resolver turning a stored id into its
 *   display label for chips and group headers.
 * - **`rank`** — an optional custom sort/group ordering (e.g. status by workflow order, priority
 *   by urgency) so a domain field never sorts merely alphabetically.
 *
 * The model is deliberately framework-agnostic and `T`-generic so it is unit-reviewable and so a
 * new list page only writes a catalog plus the page's data fetch — never a new filter UI.
 */

/** The value type of a field, which selects its operators and value-entry affordance. */
export type FieldValueType =
  | 'enum' // a fixed, small set of known values (status, health) chosen from a list
  | 'relation' // an entity id (lead, team) chosen from a resolved set of options
  | 'text' // free text, filtered by substring
  | 'date' // an ISO date, filtered by before/after and sortable chronologically
  | 'number'; // a numeric value, filtered by comparison and sortable

/**
 * A filter operator.
 *
 * @remarks
 * Mirrors the stored `op` union on {@link import('@docket/types').ViewFilter} so a toolbar-built
 * predicate is byte-compatible with a saved view. Not every operator applies to every field; the
 * natural set per {@link FieldValueType} is computed by {@link operatorsForType}.
 */
export type FilterOperator = 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'lt' | 'contains';

/** A direction for a sort term. */
export type SortDirection = 'asc' | 'desc';

/** A single filter predicate built by the toolbar (field + operator + value). */
export interface ViewFilterTerm {
  /** The {@link FieldDescriptor.key} this predicate filters on. */
  field: string;
  /** The operator. */
  op: FilterOperator;
  /** The compared value: a scalar for scalar ops, a string array for `in`/`nin`. */
  value: unknown;
}

/** The active grouping: a single field key, or `null` for an ungrouped (flat) list. */
export interface ViewGroupTerm {
  /** The {@link FieldDescriptor.key} to group rows by. */
  field: string;
}

/** A single sort term (field + direction). */
export interface ViewSortTerm {
  /** The {@link FieldDescriptor.key} to sort by. */
  field: string;
  /** The direction. */
  dir: SortDirection;
}

/** The complete view state a toolbar edits and the apply engine consumes. */
export interface ViewState {
  /** Active filter predicates, combined with AND. */
  filters: readonly ViewFilterTerm[];
  /** Active grouping, or `null`. */
  groupBy: ViewGroupTerm | null;
  /** Active sort terms, applied in order (a stable, multi-key sort). */
  sort: readonly ViewSortTerm[];
}

/** The empty starting view state (no filters / grouping / sort). */
export const EMPTY_VIEW_STATE: ViewState = { filters: [], groupBy: null, sort: [] };

/** One choosable value for an enum/relation field (a stable id + its display label). */
export interface FieldOption {
  /** The stored value (an enum value, or an entity id). */
  value: string;
  /** The human-readable label shown in the chooser and on chips. */
  label: string;
  /**
   * An optional swatch/glyph hint for the option (e.g. a status type or a health token), so a
   * chooser row or a chip can render the field's domain glyph. Opaque to the engine.
   */
  hint?: string;
}

/**
 * A descriptor for one filterable / groupable / sortable field of the row type `T`.
 *
 * @typeParam T - The row type this field reads from (e.g. `ProjectOut`).
 */
export interface FieldDescriptor<T> {
  /** Stable field key, used in the URL and in stored predicates. */
  key: string;
  /** Human noun shown in menus and chips (vocabulary-resolved by the page before being passed). */
  label: string;
  /** The value type, which selects the operator set + value-entry affordance. */
  type: FieldValueType;
  /**
   * Read the row's comparable scalar for this field. Returns `null` when the field is unset for
   * the row (a `null` value sorts last and never matches an `eq`/`in` predicate, but does match
   * `nin`/`neq`). Used uniformly by filtering, grouping, and sorting.
   */
  accessor: (row: T) => string | number | null;
  /** Whether this field can group a list. Defaults to `false`. */
  groupable?: boolean;
  /** Whether this field can sort a list. Defaults to `false`. */
  sortable?: boolean;
  /** Whether this field can be filtered. Defaults to `true`. */
  filterable?: boolean;
  /**
   * For `enum`/`relation` fields, the choosable values (sync). Prefer this for small fixed sets
   * (status, health). For relation fields whose options come from another query, pass
   * {@link FieldDescriptor.resolveOptions} instead (or in addition, as a fallback).
   */
  options?: readonly FieldOption[];
  /**
   * For `relation` fields, a lazy resolver returning the choosable options from already-loaded
   * page data (e.g. the org's members for a "Lead" field). Called by the toolbar when its value
   * chooser opens; kept sync because the page already has the data in memory (Phase B loads it
   * via `useApiQuery`), so there is no spinner — the array is computed on demand.
   */
  resolveOptions?: () => readonly FieldOption[];
  /**
   * Resolve a stored value (an enum value or an entity id) to its display label for chips and
   * group headers. Falls back to {@link FieldDescriptor.options} / {@link resolveOptions}, then
   * to the raw value, when omitted.
   */
  resolveLabel?: (value: string) => string;
  /**
   * A custom ordering rank for a value, used by grouping and sorting so a domain field orders by
   * meaning rather than alphabetically (status by workflow order, priority by urgency, health by
   * severity). Lower ranks come first. Omit for natural (lexical / numeric / chronological) order.
   */
  rank?: (value: string | number | null) => number;
}

/** A field catalog: the ordered fields a list declares for the shared toolbar + engine. */
export type FieldCatalog<T> = readonly FieldDescriptor<T>[];

/** Human label for each filter operator (drives the operator menu + chip descriptions). */
export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is any of',
  nin: 'is none of',
  gt: 'is after',
  lt: 'is before',
  contains: 'contains',
};

/**
 * The natural operator set for a {@link FieldValueType}, in menu order.
 *
 * @remarks
 * Enum/relation fields read as set membership ("is", "is not", "is any of", "is none of");
 * free text as substring ("contains"); dates and numbers as comparison ("is", and before/after).
 * A field may narrow this further via the catalog, but this is the sensible default so a page
 * rarely declares operators by hand.
 *
 * @param type - The field's value type.
 * @returns the ordered operators offered for the field.
 */
export function operatorsForType(type: FieldValueType): readonly FilterOperator[] {
  switch (type) {
    case 'enum':
    case 'relation':
      return ['eq', 'neq', 'in', 'nin'];
    case 'text':
      return ['contains'];
    case 'date':
      return ['eq', 'gt', 'lt'];
    case 'number':
      return ['eq', 'neq', 'gt', 'lt'];
    /* v8 ignore next 2 -- defensive: `type` is a closed union; guards a future value type. */
    default:
      return ['eq', 'neq'];
  }
}

/** Look up a field descriptor by key. */
export function findField<T>(
  catalog: FieldCatalog<T>,
  key: string,
): FieldDescriptor<T> | undefined {
  return catalog.find((field) => field.key === key);
}

/** The groupable fields of a catalog, in declaration order. */
export function groupableFields<T>(catalog: FieldCatalog<T>): FieldCatalog<T> {
  return catalog.filter((field) => field.groupable === true);
}

/** The sortable fields of a catalog, in declaration order. */
export function sortableFields<T>(catalog: FieldCatalog<T>): FieldCatalog<T> {
  return catalog.filter((field) => field.sortable === true);
}

/** The filterable fields of a catalog (default `true`), in declaration order. */
export function filterableFields<T>(catalog: FieldCatalog<T>): FieldCatalog<T> {
  return catalog.filter((field) => field.filterable !== false);
}

/**
 * The choosable options for a field (sync `options`, else lazy `resolveOptions`, else none).
 *
 * @param field - The field descriptor.
 * @returns the field's choosable options, or an empty array for free-entry fields.
 */
export function optionsFor<T>(field: FieldDescriptor<T>): readonly FieldOption[] {
  if (field.options) return field.options;
  if (field.resolveOptions) return field.resolveOptions();
  return [];
}

/**
 * Resolve a stored value to its display label for a chip / group header.
 *
 * @remarks
 * Prefers the field's explicit {@link FieldDescriptor.resolveLabel}, then a matching option's
 * label, then the raw value — so an id with no resolvable name still renders (never blank).
 *
 * @param field - The field descriptor.
 * @param value - The stored value (an enum value or an entity id).
 * @returns the display label.
 */
export function labelForValue<T>(field: FieldDescriptor<T>, value: string): string {
  if (field.resolveLabel) return field.resolveLabel(value);
  const option = optionsFor(field).find((o) => o.value === value);
  if (option) return option.label;
  return value;
}
