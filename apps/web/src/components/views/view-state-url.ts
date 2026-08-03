/**
 * `views` — the pure (un)serializer between a {@link ViewState} and URL search params.
 *
 * @remarks
 * The unified toolbar persists its filter/group/sort state to the URL so a configured list is
 * **shareable** (copy the link, land on the same filtered view) and **sticky** (a reload keeps
 * the configuration). Keeping the codec pure — a plain `URLSearchParams` in/out, no React —
 * means the round-trip (`serialize(parse(x)) ≡ x` for well-formed input, and a hand-edited or
 * stale param degrades gracefully rather than throwing) is unit-reviewable, and the
 * {@link import('./use-view-state').useViewState} hook is a thin wrapper that only wires it to
 * `useSearchParams`/`useRouter`.
 *
 * The encoding is compact and human-legible:
 *
 * - **`filter`** — repeated, one per predicate, as `field:op:value`. For `in`/`nin` the value is
 *   a comma-joined list (`status:in:active,planned`). Field/op/value are component-encoded so a
 *   value containing a separator survives. An empty filter set emits no param.
 * - **`group`** — the grouping field key, or absent for no grouping (`group=status`).
 * - **`sort`** — repeated, one per term, as `field:dir` (`sort=health:desc`).
 *
 * Only the toolbar's own keys are touched; any unrelated search params (a tab id, a detail id)
 * are preserved by the hook, so persisting view state never clobbers other URL state.
 */
import {
  DEFAULT_VIEW_DISPLAY,
  type FilterOperator,
  type ViewDensity,
  type ViewDisplayState,
  type ViewFilterTerm,
  type ViewScale,
  type ViewSortTerm,
  type ViewState,
} from './field-catalog';

/** The search-param key carrying filter predicates (repeated, one per predicate). */
export const FILTER_PARAM = 'filter';
/** The search-param key carrying the grouping field. */
export const GROUP_PARAM = 'group';
/** The search-param key carrying sort terms (repeated, one per term). */
export const SORT_PARAM = 'sort';
/** The search-param key carrying presentation toggles (repeated, one per non-default option). */
export const DISPLAY_PARAM = 'display';

/** The set of param keys this codec owns (so the hook can clear/replace only these). */
export const VIEW_PARAM_KEYS: readonly string[] = [
  FILTER_PARAM,
  GROUP_PARAM,
  SORT_PARAM,
  DISPLAY_PARAM,
];

/** The recognized filter operators, for validating a parsed token. */
const OPERATORS = new Set<FilterOperator>(['eq', 'neq', 'in', 'nin', 'gt', 'lt', 'contains']);
/** Whether `op` is a recognized {@link FilterOperator}. */
function isOperator(op: string): op is FilterOperator {
  return OPERATORS.has(op as FilterOperator);
}

/** Whether a value-set operator (`in`/`nin`) — its value encodes as a comma list. */
function isSetOp(op: FilterOperator): boolean {
  return op === 'in' || op === 'nin';
}

/**
 * Parse one `field:op:value` filter token into a predicate, or `null` if malformed.
 *
 * @remarks
 * Only the first two `:` are structural (field, op); everything after is the value, so a value
 * containing a colon survives. Each segment is `decodeURIComponent`-decoded. A token whose op is
 * unrecognized is dropped (returns `null`) so a hand-edited URL never produces a junk predicate.
 */
function parseFilterToken(token: string): ViewFilterTerm | null {
  const first = token.indexOf(':');
  if (first <= 0) return null;
  const second = token.indexOf(':', first + 1);
  if (second < 0) return null;
  const field = safeDecode(token.slice(0, first));
  const op = safeDecode(token.slice(first + 1, second));
  const rawValue = token.slice(second + 1);
  if (field.length === 0 || !isOperator(op)) return null;
  if (isSetOp(op)) {
    const values = rawValue
      .split(',')
      .map((part) => safeDecode(part))
      .filter((part) => part.length > 0);
    if (values.length === 0) return null;
    return { field, op, value: values };
  }
  return { field, op, value: safeDecode(rawValue) };
}

/** Encode one predicate as a `field:op:value` token (set ops join their values with commas). */
function encodeFilterTerm(term: ViewFilterTerm): string | null {
  const field = encodeURIComponent(term.field);
  const op = term.op;
  if (isSetOp(op)) {
    const values = Array.isArray(term.value)
      ? term.value
          .map((v) => coerceScalar(v))
          .filter((v): v is string => v !== null && v.length > 0)
          .map((v) => encodeURIComponent(v))
      : [];
    if (values.length === 0) return null;
    return `${field}:${op}:${values.join(',')}`;
  }
  const scalar = coerceScalar(term.value);
  if (scalar === null) return null;
  return `${field}:${op}:${encodeURIComponent(scalar)}`;
}

/** Coerce a filter value to a string for encoding; `null` for an object/absent value. */
function coerceScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Parse one `field:dir` sort token, or `null` if malformed. */
function parseSortToken(token: string): ViewSortTerm | null {
  const idx = token.lastIndexOf(':');
  if (idx <= 0) return null;
  const field = safeDecode(token.slice(0, idx));
  const dir = token.slice(idx + 1);
  if (field.length === 0 || (dir !== 'asc' && dir !== 'desc')) return null;
  return { field, dir };
}

/** `decodeURIComponent` that returns the raw input on a malformed escape rather than throwing. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parse a {@link ViewState} out of URL search params.
 *
 * @remarks
 * Tolerant by design: unrecognized or malformed tokens are dropped, never thrown on, so a
 * shared link with a renamed field, or a manually-mangled URL, still yields a usable (possibly
 * partial) view rather than an error. Only the first `group` value is honored.
 *
 * @param params - The URL search params (e.g. from `useSearchParams`).
 * @returns the parsed {@link ViewState}.
 */
export function parseViewState(params: URLSearchParams): ViewState {
  const filters: ViewFilterTerm[] = [];
  for (const token of params.getAll(FILTER_PARAM)) {
    const term = parseFilterToken(token);
    if (term) filters.push(term);
  }
  const sort: ViewSortTerm[] = [];
  for (const token of params.getAll(SORT_PARAM)) {
    const term = parseSortToken(token);
    if (term) sort.push(term);
  }
  const groupField = params.get(GROUP_PARAM);
  const groupBy = groupField && groupField.length > 0 ? { field: groupField } : null;
  return { filters, groupBy, sort };
}

/**
 * Serialize a {@link ViewState} onto a copy of the given base params, preserving unrelated keys.
 *
 * @remarks
 * Starts from a clone of `base` with this codec's own keys stripped, then writes the active
 * state — so a tab id or detail id already on the URL is preserved while the view keys are fully
 * replaced (no stale filter param lingers). An empty state emits no view keys at all, yielding a
 * clean URL.
 *
 * @param state - The {@link ViewState} to encode.
 * @param base - The current params to preserve unrelated keys from (defaults to empty).
 * @returns a new {@link URLSearchParams} carrying the encoded state.
 */
export function serializeViewState(
  state: ViewState,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const next = new URLSearchParams();
  // Preserve any unrelated params (not owned by this codec), in their original order.
  for (const [key, value] of base.entries()) {
    if (!VIEW_PARAM_KEYS.includes(key)) next.append(key, value);
  }
  for (const term of state.filters) {
    const encoded = encodeFilterTerm(term);
    if (encoded) next.append(FILTER_PARAM, encoded);
  }
  if (state.groupBy) next.set(GROUP_PARAM, state.groupBy.field);
  for (const term of state.sort) {
    next.append(SORT_PARAM, `${encodeURIComponent(term.field)}:${term.dir}`);
  }
  return next;
}

/** Whether a {@link ViewState} carries no filters / grouping / sort (the empty state). */
export function isEmptyViewState(state: ViewState): boolean {
  return state.filters.length === 0 && state.groupBy === null && state.sort.length === 0;
}

/** The recognized {@link ViewScale} values, for validating a parsed token. */
const SCALES = new Set<ViewScale>(['auto', 'day', 'week', 'month', 'quarter', 'year']);
/** The recognized {@link ViewDensity} values, for validating a parsed token. */
const DENSITIES = new Set<ViewDensity>(['comfortable', 'compact']);

/**
 * Parse a {@link ViewDisplayState} out of URL search params.
 *
 * @remarks
 * Encoded as repeated `display=<option>:<value>` tokens, and **only** for options that differ from
 * {@link DEFAULT_VIEW_DISPLAY} — so a default presentation emits nothing and the URL stays clean.
 * An absent option therefore means "the declared default", never "unset": there is no third state
 * to reason about downstream. Unrecognized options and unparseable values are dropped rather than
 * thrown on, matching the tolerance of the filter codec.
 *
 * @param params - The URL search params (e.g. from `useSearchParams`).
 * @returns the parsed display state, defaulted per option.
 */
export function parseViewDisplay(params: URLSearchParams): ViewDisplayState {
  const display: ViewDisplayState = { ...DEFAULT_VIEW_DISPLAY };
  for (const token of params.getAll(DISPLAY_PARAM)) {
    const idx = token.indexOf(':');
    if (idx <= 0) continue;
    const option = safeDecode(token.slice(0, idx));
    const raw = safeDecode(token.slice(idx + 1));
    if (option === 'density' && DENSITIES.has(raw as ViewDensity)) {
      display.density = raw as ViewDensity;
    } else if (option === 'scale' && SCALES.has(raw as ViewScale)) {
      display.scale = raw as ViewScale;
    } else if ((option === 'progress' || option === 'markers') && (raw === '0' || raw === '1')) {
      display[option] = raw === '1';
    }
  }
  return display;
}

/**
 * Serialize a {@link ViewDisplayState} onto a params object, emitting only non-default options.
 *
 * @remarks
 * Mutates the passed params in place (the caller has already stripped this codec's keys), so it
 * composes with {@link serializeViewState} over the same object.
 *
 * @param display - The display state to encode.
 * @param into - The params to append the display tokens to.
 */
export function serializeViewDisplay(display: ViewDisplayState, into: URLSearchParams): void {
  if (display.density !== DEFAULT_VIEW_DISPLAY.density) {
    into.append(DISPLAY_PARAM, `density:${display.density}`);
  }
  if (display.scale !== DEFAULT_VIEW_DISPLAY.scale) {
    into.append(DISPLAY_PARAM, `scale:${display.scale}`);
  }
  if (display.progress !== DEFAULT_VIEW_DISPLAY.progress) {
    into.append(DISPLAY_PARAM, `progress:${display.progress ? '1' : '0'}`);
  }
  if (display.markers !== DEFAULT_VIEW_DISPLAY.markers) {
    into.append(DISPLAY_PARAM, `markers:${display.markers ? '1' : '0'}`);
  }
}
