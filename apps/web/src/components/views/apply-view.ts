/**
 * `views` — the pure, generic engine that turns a {@link ViewState} (filters + grouping + sort)
 * into a filtered, grouped, sorted shape any Docket list page can render.
 *
 * @remarks
 * This is the framework-agnostic heart of the unified filtering system. It is parameterized over
 * the row type `T` and reads every field through the page's {@link FieldCatalog}, so the same
 * code drives Projects, Programs, Initiatives, Cycles, and Teams — there is no per-page filter
 * logic. It is deliberately UI-free and side-effect-free so it stays unit-reviewable and so its
 * behavior (AND-across-predicates, custom-ranked grouping/sorting, blanks-last) is pinned by
 * tests rather than by a render.
 *
 * The output is the grouped/sorted shape: either one flat ordered row list (no grouping) or an
 * ordered set of {@link AppliedGroup}s (each with a stable id + display label + its ordered
 * rows). A page maps that onto the design-system `EntityList`/`ListView` directly.
 *
 * Robustness mirrors the saved-view engine: an unknown field or a value that cannot be coerced is
 * treated as "no opinion" (it never excludes a row), so a predicate authored elsewhere — or a
 * URL someone hand-edited — can never silently blank a list.
 */
import {
  type FieldCatalog,
  type FieldDescriptor,
  type ViewFilterTerm,
  type ViewState,
  findField,
  labelForValue,
} from './field-catalog';

/** A group bucket produced by {@link applyView} when a grouping is active. */
export interface AppliedGroup<T> {
  /** Stable bucket id (the grouping field's value, or the empty-bucket sentinel). */
  id: string;
  /** Display label for the group header. */
  label: string;
  /**
   * The grouping field's swatch/glyph hint for this bucket (from the matching option), so a
   * header can render the field's domain glyph. `undefined` when the field has no hint.
   */
  hint?: string;
  /** The bucket's rows, in the active sort order. */
  rows: readonly T[];
}

/** The result of {@link applyView}: a flat ordered list, or ordered groups. */
export interface AppliedView<T> {
  /** All matching rows in sort order (the flat list; also the ungrouped render). */
  rows: readonly T[];
  /** The grouped buckets in group order, or `null` when no grouping is active. */
  groups: readonly AppliedGroup<T>[] | null;
}

/** The id of the synthesized bucket rows with no value for the grouping field land in. */
export const EMPTY_GROUP_ID = '\0__none__';

/** Coerce an accessor result to a string for scalar comparison (numbers stringify). */
function asScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Coerce a stored filter `value` to a set of strings for `in` / `nin`. */
function asScalarSet(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    const out = new Set<string>();
    for (const entry of value) {
      const scalar = asScalar(entry);
      if (scalar !== null) out.add(scalar);
    }
    return out;
  }
  const single = asScalar(value);
  return single === null ? new Set() : new Set([single]);
}

/**
 * Evaluate a single filter predicate against a row.
 *
 * @remarks
 * An unrecognized field, or a predicate whose value cannot be coerced, is treated as "no
 * opinion" (returns `true`) rather than excluding the row — a malformed predicate must never
 * silently blank a list. `eq`/`in` require a present value; `neq`/`nin` are satisfied by a `null`
 * (an unset field "is not" any concrete value), matching set semantics.
 */
function matchesFilter<T>(
  row: T,
  filter: ViewFilterTerm,
  field: FieldDescriptor<T> | undefined,
): boolean {
  if (!field) return true;
  if (field.values) return matchesMultiFilter(readValues(field, row), filter);
  const actual = asScalar(field.accessor(row));
  switch (filter.op) {
    case 'eq':
      return actual === asScalar(filter.value);
    case 'neq':
      return actual !== asScalar(filter.value);
    case 'in':
      return actual !== null && asScalarSet(filter.value).has(actual);
    case 'nin':
      return actual === null || !asScalarSet(filter.value).has(actual);
    case 'contains': {
      const needle = asScalar(filter.value);
      if (needle === null) return true;
      return (actual ?? '').toLowerCase().includes(needle.toLowerCase());
    }
    case 'gt': {
      const bound = asScalar(filter.value);
      if (bound === null || actual === null) return false;
      return actual > bound;
    }
    case 'lt': {
      const bound = asScalar(filter.value);
      if (bound === null || actual === null) return false;
      return actual < bound;
    }
    /* v8 ignore next 2 -- defensive: `op` is a closed union; guards a future operator. */
    default:
      return true;
  }
}

/**
 * Read a multi-valued field's values, dropping blanks.
 *
 * @remarks
 * Only called for descriptors that declare {@link FieldDescriptor.values}; an empty result means
 * unset and is handled by the callers exactly as a `null` scalar would be.
 */
function readValues<T>(field: FieldDescriptor<T>, row: T): readonly string[] {
  return field.values ? field.values(row).filter((value) => value.length > 0) : [];
}

/**
 * Evaluate one predicate against a multi-valued field, with set semantics.
 *
 * @remarks
 * A row "is" a value when *any* of its values matches, and "is not" one when none do — so a
 * resource used by both the launch and the billing initiative satisfies `eq launch`. `gt`/`lt`
 * have no meaning over an unordered set and are treated as "no opinion", consistent with how the
 * scalar path treats a predicate it cannot evaluate.
 */
function matchesMultiFilter(values: readonly string[], filter: ViewFilterTerm): boolean {
  switch (filter.op) {
    case 'eq': {
      const expected = asScalar(filter.value);
      return expected !== null && values.includes(expected);
    }
    case 'neq': {
      const expected = asScalar(filter.value);
      return expected === null || !values.includes(expected);
    }
    case 'in': {
      const expected = asScalarSet(filter.value);
      return values.some((value) => expected.has(value));
    }
    case 'nin': {
      const expected = asScalarSet(filter.value);
      return !values.some((value) => expected.has(value));
    }
    case 'contains': {
      const needle = asScalar(filter.value);
      if (needle === null) return true;
      return values.some((value) => value.toLowerCase().includes(needle.toLowerCase()));
    }
    default:
      return true;
  }
}

/**
 * Apply a filter set to the rows (AND across predicates).
 *
 * @typeParam T - The row type.
 * @param rows - The rows to filter (typically the page's loaded query results).
 * @param filters - The active predicates; an empty set passes every row through.
 * @param catalog - The page's field catalog (resolves each predicate's field accessor).
 * @returns the rows satisfying every predicate (input order preserved).
 */
export function filterRows<T>(
  rows: readonly T[],
  filters: readonly ViewFilterTerm[],
  catalog: FieldCatalog<T>,
): readonly T[] {
  if (filters.length === 0) return rows;
  return rows.filter((row) =>
    filters.every((filter) => matchesFilter(row, filter, findField(catalog, filter.field))),
  );
}

/**
 * Compare two rows on one field for one directional sort term.
 *
 * @remarks
 * Null-handling is **direction-independent**: a `null` value always sorts last (so blanks never
 * lead a list, ascending *or* descending). For two present values the comparison honors the
 * field's custom {@link FieldDescriptor.rank} (status by lifecycle, priority by urgency) — else
 * orders naturally (numbers numerically, everything else lexically) — and only *that* comparison
 * is negated for a descending term. Returns the final ordered value for this term.
 */
function compareOn<T>(a: T, b: T, field: FieldDescriptor<T>, dir: 'asc' | 'desc'): number {
  const av = field.accessor(a);
  const bv = field.accessor(b);
  // Blanks last regardless of direction.
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  let cmp: number;
  if (field.rank) {
    cmp = field.rank(av) - field.rank(bv);
  } else if (typeof av === 'number' && typeof bv === 'number') {
    cmp = av - bv;
  } else {
    const as = String(av);
    const bs = String(bv);
    cmp = as < bs ? -1 : as > bs ? 1 : 0;
  }
  return dir === 'desc' ? -cmp : cmp;
}

/**
 * Sort rows by the ordered sort terms (stable, multi-key); never mutates the input.
 *
 * @typeParam T - The row type.
 * @param rows - The (already filtered) rows to order.
 * @param sort - The ordered sort terms; an empty set leaves input order untouched.
 * @param catalog - The page's field catalog (resolves each term's field).
 * @returns a new, ordered array.
 */
export function sortRows<T>(
  rows: readonly T[],
  sort: readonly ViewSortLike[],
  catalog: FieldCatalog<T>,
): readonly T[] {
  if (sort.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const term of sort) {
      const field = findField(catalog, term.field);
      if (!field) continue;
      const cmp = compareOn(a, b, field, term.dir);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

/** The minimal sort-term shape {@link sortRows} reads (field key + direction). */
interface ViewSortLike {
  field: string;
  dir: 'asc' | 'desc';
}

/**
 * The bucket ids one row belongs to under a grouping field.
 *
 * @remarks
 * Exactly one for a scalar field, preserving the previous behavior exactly. A field declaring
 * {@link FieldDescriptor.values} yields one id per value. A row with no values lands in the empty
 * bucket, the same as a `null` scalar.
 */
function bucketIdsFor<T>(field: FieldDescriptor<T>, row: T): readonly string[] {
  if (field.values) {
    const values = readValues(field, row);
    return values.length > 0 ? values : [EMPTY_GROUP_ID];
  }
  return [asScalar(field.accessor(row)) ?? EMPTY_GROUP_ID];
}

/**
 * Bucket already-sorted rows under the grouping field, in the field's rank/option order.
 *
 * @remarks
 * Group order follows, in priority: the field's custom {@link FieldDescriptor.rank} (status by
 * workflow order); else the declared {@link FieldDescriptor.options} order; else the order groups
 * are first encountered in the (already sorted) rows. The synthesized empty bucket (rows with no
 * value for the field) always sorts last. Each bucket's rows preserve the incoming sort order.
 *
 * A field declaring {@link FieldDescriptor.values} places one row in several buckets, so the
 * bucket sizes may sum to more than `sorted.length`. That is the intended reading — a resource
 * used by two initiatives belongs under both — and a caller showing a total must count rows, not
 * sum groups.
 */
function groupRows<T>(sorted: readonly T[], field: FieldDescriptor<T>): readonly AppliedGroup<T>[] {
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of sorted) {
    for (const id of bucketIdsFor(field, row)) {
      let bucket = buckets.get(id);
      if (!bucket) {
        bucket = [];
        buckets.set(id, bucket);
        order.push(id);
      }
      bucket.push(row);
    }
  }

  // Establish the group order: ranked fields and option-declared fields impose a deterministic
  // order; otherwise groups appear in first-seen order. The empty bucket always trails.
  const rankOf = (id: string): number => {
    if (id === EMPTY_GROUP_ID) return Number.POSITIVE_INFINITY;
    if (field.rank) return field.rank(id);
    const declared = field.options?.findIndex((o) => o.value === id) ?? -1;
    if (declared >= 0) return declared;
    return order.indexOf(id) + (field.options ? field.options.length : 0);
  };
  order.sort((a, b) => rankOf(a) - rankOf(b));

  const hintOf = (id: string): string | undefined =>
    field.options?.find((o) => o.value === id)?.hint;

  return order.map((id) => {
    const hint = hintOf(id);
    return {
      id,
      label:
        id === EMPTY_GROUP_ID
          ? (field.emptyGroupLabel ?? `No ${field.label.toLowerCase()}`)
          : labelForValue(field, id),
      ...(hint === undefined ? {} : { hint }),
      rows: buckets.get(id) ?? [],
    };
  });
}

/**
 * Apply a complete {@link ViewState} to a row array: filter, then sort, then group.
 *
 * @remarks
 * The single entry point a list page calls (typically inside a `useMemo` over its loaded query
 * results). Filtering and sorting are applied first; grouping then partitions the sorted rows so
 * within each group the sort order is preserved. When no grouping is active, `groups` is `null`
 * and the page renders the flat `rows`.
 *
 * @typeParam T - The row type.
 * @param rows - The page's loaded rows.
 * @param state - The active {@link ViewState}.
 * @param catalog - The page's {@link FieldCatalog}.
 * @returns the {@link AppliedView} (flat rows + optional groups).
 */
export function applyView<T>(
  rows: readonly T[],
  state: ViewState,
  catalog: FieldCatalog<T>,
): AppliedView<T> {
  const filtered = filterRows(rows, state.filters, catalog);
  const sorted = sortRows(filtered, state.sort, catalog);
  if (!state.groupBy) {
    return { rows: sorted, groups: null };
  }
  const field = findField(catalog, state.groupBy.field);
  if (!field) {
    return { rows: sorted, groups: null };
  }
  return { rows: sorted, groups: groupRows(sorted, field) };
}

export { describeFilterTerm } from './apply-view-describe';
