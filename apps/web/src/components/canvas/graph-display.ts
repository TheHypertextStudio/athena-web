/**
 * `components/canvas/graph-display` — pure codec for the canvas's own presentation options.
 *
 * @remarks
 * Filters, grouping, and ordering are the shared view engine's concern and ride the `filter` /
 * `group` / `sort` params via `components/views/view-state-url`. What remains is presentation that
 * only a canvas has: which way the layout flows, whether the critical path is isolated, whether
 * the ready queue and minimap are shown, how far a neighbourhood reaches, and the free-text search
 * that both filters and pans the viewport.
 *
 * This is the same split the shared engine already draws between {@link
 * import('../views/field-catalog').ViewState} (the query, which a saved view persists) and
 * `ViewDisplayState` (per-viewer presentation). The graph does not reuse `ViewDisplayState` itself
 * because that type models timeline geometry — density, bars, markers, an axis scale — none of
 * which a node-link diagram has.
 *
 * Encoding, all compact and human-legible, every key omitted at its default:
 * - `q` — the title search.
 * - `dir` — `TB` for a top-to-bottom layout; omitted for the default `LR`.
 * - `crit` — `1` when the critical path is isolated.
 * - `ready` — `1` when the ready-queue panel is open.
 * - `map` — `1` when the minimap is shown.
 * - `depth` — the neighbourhood radius, when it differs from the scope's own.
 */
import type { LayoutDirection } from './use-dagre-layout';

/** The search-param keys this codec owns (so a write replaces only these). */
const GRAPH_DISPLAY_PARAM_KEYS = ['q', 'dir', 'crit', 'ready', 'map', 'depth'] as const;

/** The smallest and largest neighbourhood radius the depth control offers. */
export const MIN_DEPTH = 1;
/** @see {@link MIN_DEPTH} */
export const MAX_DEPTH = 5;

/** The canvas's presentation options. */
export interface GraphDisplayState {
  /** Free-text title search: filters the node set *and* pans the viewport to what survives. */
  search: string;
  /** Layout flow direction. */
  direction: LayoutDirection;
  /** Isolate the critical path, softening everything off it. */
  critical: boolean;
  /** Show the ready-to-start queue panel. */
  ready: boolean;
  /**
   * Show the minimap.
   *
   * @remarks
   * Off by default. A minimap earns its space on a graph too large to hold in view; on the ten-node
   * graph the canvas usually renders it is a slab of abstracted rectangles parked over empty
   * canvas, telling the reader nothing the canvas is not already showing.
   */
  minimap: boolean;
  /** Neighbourhood radius, or null to use the scope's own depth. */
  depth: number | null;
}

/** The default presentation: left-to-right, nothing isolated, no minimap. */
export const DEFAULT_GRAPH_DISPLAY: GraphDisplayState = {
  search: '',
  direction: 'LR',
  critical: false,
  ready: false,
  minimap: false,
  depth: null,
};

/** Read a boolean flag: present and `1` means on. */
function parseFlag(raw: string | null): boolean {
  return raw === '1';
}

/** Read the depth param, clamped to the offered range; null when absent or unparseable. */
function parseDepth(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return null;
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, value));
}

/**
 * Parse the canvas presentation options out of URL search params.
 *
 * @remarks
 * Tolerant of missing or garbled tokens: anything unreadable falls back to its default rather than
 * throwing, so a hand-edited link degrades to the default view instead of a broken canvas.
 *
 * @param params - The URL search params.
 * @returns the decoded {@link GraphDisplayState}.
 */
export function parseGraphDisplay(params: URLSearchParams): GraphDisplayState {
  return {
    search: params.get('q') ?? '',
    direction: params.get('dir') === 'TB' ? 'TB' : 'LR',
    critical: parseFlag(params.get('crit')),
    ready: parseFlag(params.get('ready')),
    minimap: parseFlag(params.get('map')),
    depth: parseDepth(params.get('depth')),
  };
}

/**
 * Serialize presentation options onto a copy of `base`, preserving unrelated params.
 *
 * @param state - The state to encode.
 * @param base - The current params, whose keys this codec does not own are carried through.
 * @returns a new {@link URLSearchParams} carrying the encoded state.
 */
export function serializeGraphDisplay(
  state: GraphDisplayState,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of base.entries()) {
    if (!(GRAPH_DISPLAY_PARAM_KEYS as readonly string[]).includes(key)) next.append(key, value);
  }
  const search = state.search.trim();
  if (search.length > 0) next.set('q', search);
  if (state.direction === 'TB') next.set('dir', 'TB');
  if (state.critical) next.set('crit', '1');
  if (state.ready) next.set('ready', '1');
  if (state.minimap) next.set('map', '1');
  if (state.depth !== null) next.set('depth', String(state.depth));
  return next;
}
