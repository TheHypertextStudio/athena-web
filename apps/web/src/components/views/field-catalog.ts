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
import { useCallback } from 'react';

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

/**
 * The geometry token a display option is allowed to affect.
 *
 * @remarks
 * Timeline rendering keeps three dimensions deliberately independent — the uniform row track, the
 * visual bar drawn inside it, and the (larger) pointer target around that bar. Declaring which one
 * an option moves is what stops a new toggle from silently re-coupling them: an option tagged
 * `bar` may never change row height, and an option tagged `row` changes it for *every* row at
 * once. Heterogeneous row heights within a single render are not representable by design.
 */
export type DisplayGeometryToken = 'row' | 'bar' | 'axis';

/**
 * The time-axis granularity a temporal lens renders at; `auto` derives it from the visible span.
 *
 * @remarks
 * The five concrete steps are the calendar units a plan is actually discussed in — days, weeks,
 * months, quarters, years — so a roadmap can be read at the resolution of the decision being made
 * without the viewer inventing an intermediate unit.
 */
export type ViewScale = 'auto' | 'day' | 'week' | 'month' | 'quarter' | 'year';

/** Row density — the only display option permitted to change row height. */
export type ViewDensity = 'comfortable' | 'compact';

/**
 * Presentation toggles that change how rows are *drawn*, not which rows are shown.
 *
 * @remarks
 * Deliberately separate from {@link ViewState}: that models the **query** (which rows, in what
 * order, bucketed how) and is what saved views persist. This models **presentation**, which is a
 * per-viewer preference rather than part of a shared view definition. Both are persisted to the
 * URL by the same codec so a configured lens stays shareable and reload-stable, but neither
 * concern leaks into the other.
 *
 * Non-temporal lenses ignore the options that do not apply to them; an option is never
 * interpreted differently by different lenses.
 */
export interface ViewDisplayState {
  /** Row density. Affects the `row` token — i.e. the uniform row height, for every row at once. */
  density: ViewDensity;
  /** Whether bars carry a completion fill. Affects the `bar` token only. */
  progress: boolean;
  /** Whether dated checkpoint markers are drawn. Affects the `bar` token only. */
  markers: boolean;
  /** The requested time-axis granularity. Affects the `axis` token only. */
  scale: ViewScale;
}

/**
 * Which geometry token each display option is permitted to move.
 *
 * @remarks
 * Exhaustive over {@link ViewDisplayState} by construction, so adding an option without declaring
 * its token is a type error rather than a silent re-coupling of the geometry model.
 */
export const DISPLAY_GEOMETRY_TOKEN: Record<keyof ViewDisplayState, DisplayGeometryToken> = {
  density: 'row',
  progress: 'bar',
  markers: 'bar',
  scale: 'axis',
};

/** The default presentation: comfortable rows, progress and markers shown, auto-scaled axis. */
export const DEFAULT_VIEW_DISPLAY: ViewDisplayState = {
  density: 'comfortable',
  progress: true,
  markers: true,
  scale: 'auto',
};

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
  /**
   * Read *every* value the row holds for this field, for the fields where one row legitimately has
   * several — a Library resource used by two initiatives, say.
   *
   * @remarks
   * Deliberately separate from {@link FieldDescriptor.accessor} rather than widening its return
   * type. `accessor` feeds filtering, grouping, **and** sorting; letting it return an array would
   * ripple into every comparison in the apply engine and into every catalog already written
   * against it. Declaring `values` instead is additive: a descriptor without it behaves exactly as
   * before, byte for byte.
   *
   * When present, filtering uses set semantics (`eq` matches if *any* value matches) and grouping
   * fans the row into one bucket per value — so group counts can legitimately sum to more than the
   * row count. Sorting still reads `accessor`, because ordering a row by a set of values has no
   * single honest answer; return the primary value there.
   *
   * An empty array means unset, and is treated exactly like `accessor` returning `null`.
   */
  values?: (row: T) => readonly string[];
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

/** Shown in place of a relation's name while the data that would resolve it is still loading. */
export const RESOLVING_LABEL = 'Loading…';

/**
 * Resolve a relation id to its name, or {@link RESOLVING_LABEL} while the query backing
 * `resolve` is still pending.
 *
 * @remarks
 * A page's primary rows query often settles before the auxiliary reference query (projects,
 * members, teams, …) that a `resolveX` closure looks names up in. Without this guard, the
 * closure runs against a still-empty lookup and falls through to the raw id — which then leaks
 * into group headers, filter chips, and table cells until the slower query lands. The `?? id`
 * fallback inside `resolve` stays the correct behavior once `isPending` is false and the id
 * genuinely has no match.
 */
export function resolveRelationLabel(
  id: string,
  isPending: boolean,
  resolve: (id: string) => string | undefined,
): string {
  if (isPending) return RESOLVING_LABEL;
  return resolve(id) ?? id;
}

/**
 * A stable `(id) => name` resolver for one query's lookup map, wrapping {@link resolveRelationLabel}.
 *
 * @remarks
 * Calling `resolveRelationLabel` directly inside a `resolveX` closure means the enclosing
 * `useMemo` must separately list the backing query's `isPending` flag in its dependency array —
 * two things that have to be kept in sync by hand, and a call site that adds the closure but
 * forgets the dependency silently keeps showing {@link RESOLVING_LABEL} after the query settles.
 * This hook ties the two together: the returned function's identity changes only when `map` or
 * `isPending` actually change, so a caller depends on one reference instead of two.
 *
 * @param map - The id → name lookup, typically a `useMemo`'d `Map` built from a list query's rows.
 * @param isPending - Whether the query backing `map` is still loading.
 * @returns a resolver suitable for a `FieldCatalog` `resolveX` dependency.
 */
export function useResolvedLabel(
  map: ReadonlyMap<string, string>,
  isPending: boolean,
): (id: string) => string {
  return useCallback(
    (id: string) => resolveRelationLabel(id, isPending, (i) => map.get(i)),
    [map, isPending],
  );
}
