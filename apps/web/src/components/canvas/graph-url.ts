/**
 * `components/canvas/graph-url` — pure codec between the canvas filter/layout and URL params.
 *
 * @remarks
 * Mirrors `components/views/view-state-url.ts`: a plain `URLSearchParams` in/out, no React, so the
 * round-trip is unit-reviewable and a hand-edited/stale param degrades gracefully. Persisting the
 * filter + layout to the URL makes a configured graph **shareable** (copy the link) and **sticky**
 * (reload keeps it). Only the codec's own keys are touched — the scope params (`projectId`,
 * `rootTaskId`, `depth`) and anything else on the URL are preserved.
 *
 * Encoding (all compact + human-legible):
 * - `q` — the title search (omitted when empty).
 * - `fp` / `fa` / `fpr` / `fs` — comma-joined member lists for project / assignee / priority /
 *   state filters (each omitted when empty). Values are component-encoded.
 * - `dir` — `TB` when the layout is top-to-bottom; omitted for the default `LR`.
 */
import { EMPTY_FILTER, type GraphFilter } from './graph-toolbar';
import type { LayoutDirection } from './use-dagre-layout';

/** The search-param keys this codec owns (so the hook replaces only these). */
export const GRAPH_PARAM_KEYS = ['q', 'fp', 'fa', 'fpr', 'fs', 'dir'] as const;

/** The set-valued filter facets and their param keys. */
const SET_FACETS: readonly [key: string, facet: keyof GraphFilter][] = [
  ['fp', 'projects'],
  ['fa', 'assignees'],
  ['fpr', 'priorities'],
  ['fs', 'stateTypes'],
];

/** `decodeURIComponent` that returns the raw input on a malformed escape rather than throwing. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse a comma-joined param into a `Set`, dropping empty members. */
function parseSet(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  return new Set(
    raw
      .split(',')
      .map((part) => safeDecode(part))
      .filter((part) => part.length > 0),
  );
}

/** Encode a `Set` as a comma-joined component-encoded value, or null when empty. */
function encodeSet(values: Set<string>): string | null {
  if (values.size === 0) return null;
  return [...values].map((v) => encodeURIComponent(v)).join(',');
}

/** The decoded canvas view state. */
export interface GraphUrlState {
  /** The filter facets. */
  filter: GraphFilter;
  /** The layout direction. */
  direction: LayoutDirection;
}

/**
 * Parse the canvas filter + layout out of URL search params (tolerant of missing/garbled tokens).
 *
 * @param params - The URL search params.
 * @returns the decoded {@link GraphUrlState}.
 */
export function parseGraphUrl(params: URLSearchParams): GraphUrlState {
  return {
    filter: {
      search: params.get('q') ?? '',
      projects: parseSet(params.get('fp')),
      assignees: parseSet(params.get('fa')),
      priorities: parseSet(params.get('fpr')),
      stateTypes: parseSet(params.get('fs')),
    },
    direction: params.get('dir') === 'TB' ? 'TB' : 'LR',
  };
}

/**
 * Serialize the filter + layout onto a copy of `base`, preserving unrelated (e.g. scope) params.
 *
 * @param state - The state to encode.
 * @param base - The current params to preserve unrelated keys from (defaults to empty).
 * @returns a new {@link URLSearchParams} carrying the encoded state.
 */
export function serializeGraphUrl(
  state: GraphUrlState,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const next = new URLSearchParams();
  // Preserve any params this codec doesn't own (scope, tab ids, …), in original order.
  for (const [key, value] of base.entries()) {
    if (!(GRAPH_PARAM_KEYS as readonly string[]).includes(key)) next.append(key, value);
  }
  const search = state.filter.search.trim();
  if (search.length > 0) next.set('q', search);
  for (const [key, facet] of SET_FACETS) {
    const encoded = encodeSet(state.filter[facet] as Set<string>);
    if (encoded !== null) next.set(key, encoded);
  }
  if (state.direction === 'TB') next.set('dir', 'TB');
  return next;
}

/** The empty canvas view state (no filters, default layout). */
export const EMPTY_GRAPH_URL_STATE: GraphUrlState = { filter: EMPTY_FILTER, direction: 'LR' };
