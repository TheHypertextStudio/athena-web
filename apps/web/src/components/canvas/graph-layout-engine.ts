/** Component-aware layout for measured top-level canvas objects. */
import type { Edge } from '@xyflow/react';
import dagre from 'dagre';

import type { LayoutDirection } from './use-dagre-layout';

const COMPONENT_GAP = 96;

/** A top-level object and the rectangle its host-specific renderer needs. */
export interface MeasuredGraphNode {
  /** Stable object id. */
  readonly id: string;
  /** Rendered width in canvas units. */
  readonly width: number;
  /** Rendered height in canvas units. */
  readonly height: number;
}

/** A dependency after any nested endpoints have been projected to top-level objects. */
export interface ProjectedGraphEdge {
  /** Top-level source id. */
  readonly source: string;
  /** Top-level target id. */
  readonly target: string;
}

/** A positioned rectangle. */
export interface GraphLayoutRect {
  /** Left edge in canvas units. */
  readonly x: number;
  /** Top edge in canvas units. */
  readonly y: number;
  /** Rectangle width in canvas units. */
  readonly width: number;
  /** Rectangle height in canvas units. */
  readonly height: number;
}

/** One weakly connected component in stable source order. */
export interface GraphLayoutComponent {
  /** Member ids in stable source order. */
  readonly nodeIds: readonly string[];
  /** Packed component bounds. */
  readonly bounds: GraphLayoutRect;
}

/** Inputs that change component layout. */
export interface GraphLayoutOptions {
  /** Dagre rank direction within each component. */
  readonly direction: LayoutDirection;
  /** Coarse viewport aspect ratio used to choose a packing. */
  readonly aspectRatio: number;
}

/** Development measurements exposed for profiling and regression checks. */
export interface GraphLayoutDiagnostics {
  /** Number of measured top-level objects. */
  readonly nodeCount: number;
  /** Number of weakly connected components. */
  readonly componentCount: number;
  /** Pure layout duration in milliseconds. */
  readonly durationMs: number;
  /** Bounds of the packed graph. */
  readonly bounds: GraphLayoutRect;
  /** Fraction of the packed bounds occupied by component rectangles. */
  readonly packingDensity: number;
}

/** Output of the shared pure layout boundary. */
export interface GraphLayoutResult {
  /** Top-left position for each measured object. */
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  /** Weak components after packing. */
  readonly components: readonly GraphLayoutComponent[];
  /** Whole-graph bounds. */
  readonly bounds: GraphLayoutRect;
  /** Largest component and the root to anchor when it cannot fit at readable zoom. */
  readonly primary: {
    readonly nodeIds: readonly string[];
    readonly anchorNodeId: string | null;
    readonly bounds: GraphLayoutRect;
  };
  /** Timing and packing diagnostics. */
  readonly diagnostics: GraphLayoutDiagnostics;
}

/** Reduce resize churn to portrait, square, or landscape packing targets. */
export function coarseGraphAspectRatio(aspectRatio: number): number {
  if (aspectRatio < 0.8) return 3 / 4;
  if (aspectRatio > 1.25) return 16 / 9;
  return 1;
}

/** Build the memo key for layout-relevant structure and ignore application properties. */
export function graphLayoutStructureKey(
  nodes: readonly MeasuredGraphNode[],
  edges: readonly ProjectedGraphEdge[],
  direction: LayoutDirection,
  aspectRatio: number,
): string {
  return `${direction}|${coarseGraphAspectRatio(aspectRatio)}|${nodes
    .map((node) => `${node.id}:${node.width}x${node.height}`)
    .join(',')}|${edges.map((edge) => `${edge.source}>${edge.target}`).join(',')}`;
}

/** Project dependency endpoints to top-level objects and discard duplicates and self-edges. */
export function projectGraphEdges(
  edges: readonly Pick<Edge, 'source' | 'target'>[],
  topLevelByNode: ReadonlyMap<string, string>,
): ProjectedGraphEdge[] {
  const projected: ProjectedGraphEdge[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const source = topLevelByNode.get(edge.source);
    const target = topLevelByNode.get(edge.target);
    if (source === undefined || target === undefined || source === target) continue;
    const key = `${source}>${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    projected.push({ source, target });
  }
  return projected;
}

/** Find weak components while preserving node source order. */
function weakComponents(
  nodes: readonly MeasuredGraphNode[],
  edges: readonly ProjectedGraphEdge[],
): string[][] {
  const ids = new Set(nodes.map(({ id }) => id));
  const adjacent = new Map(nodes.map(({ id }) => [id, [] as string[]]));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    adjacent.get(edge.source)?.push(edge.target);
    adjacent.get(edge.target)?.push(edge.source);
  }
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const pending = [node.id];
    const members = new Set<string>();
    visited.add(node.id);
    while (pending.length > 0) {
      const current = pending.shift();
      if (current === undefined) continue;
      members.add(current);
      for (const neighbor of adjacent.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    components.push(nodes.filter(({ id }) => members.has(id)).map(({ id }) => id));
  }
  return components;
}

interface LocalComponent {
  readonly nodeIds: readonly string[];
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  readonly width: number;
  readonly height: number;
}

interface PackedComponents {
  readonly origins: readonly { readonly x: number; readonly y: number }[];
  readonly width: number;
  readonly height: number;
  readonly density: number;
}

/** Score every stable row packing by wasted area and distance from the viewport aspect. */
function packComponents(
  components: readonly LocalComponent[],
  targetAspectRatio: number,
): PackedComponents {
  if (components.length === 0) return { origins: [], width: 0, height: 0, density: 0 };
  const occupiedArea = components.reduce(
    (area, component) => area + component.width * component.height,
    0,
  );
  let best: (PackedComponents & { readonly score: number }) | null = null;
  for (let perRow = 1; perRow <= components.length; perRow += 1) {
    const origins: { x: number; y: number }[] = [];
    let y = 0;
    let width = 0;
    for (let start = 0; start < components.length; start += perRow) {
      const row = components.slice(start, start + perRow);
      let x = 0;
      let rowHeight = 0;
      for (const component of row) {
        origins.push({ x, y });
        x += component.width + COMPONENT_GAP;
        rowHeight = Math.max(rowHeight, component.height);
      }
      width = Math.max(width, x - COMPONENT_GAP);
      y += rowHeight + COMPONENT_GAP;
    }
    const height = y - COMPONENT_GAP;
    const area = width * height;
    const density = area === 0 ? 0 : occupiedArea / area;
    const aspect = height === 0 ? targetAspectRatio : width / height;
    const aspectError = Math.abs(Math.log(aspect / Math.max(targetAspectRatio, 0.1)));
    const score = 1 - density + aspectError;
    if (best === null || score < best.score) best = { origins, width, height, density, score };
  }
  if (best === null) return { origins: [], width: 0, height: 0, density: 0 };
  return best;
}

/** Run Dagre over one component and normalize its origin to zero. */
function layoutComponent(
  members: readonly MeasuredGraphNode[],
  edges: readonly ProjectedGraphEdge[],
  direction: LayoutDirection,
): LocalComponent {
  const only = members[0];
  if (members.length === 1 && only !== undefined) {
    return {
      nodeIds: [only.id],
      positions: new Map([[only.id, { x: 0, y: 0 }]]),
      width: only.width,
      height: only.height,
    };
  }
  const ids = new Set(members.map(({ id }) => id));
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: direction, nodesep: 36, ranksep: 96 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const member of members) graph.setNode(member.id, member);
  for (const edge of edges) {
    if (ids.has(edge.source) && ids.has(edge.target)) graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const raw = new Map<string, { x: number; y: number }>();
  for (const member of members) {
    const point = graph.node(member.id);
    const x = point.x - member.width / 2;
    const y = point.y - member.height / 2;
    raw.set(member.id, { x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + member.width);
    maxY = Math.max(maxY, y + member.height);
  }
  return {
    nodeIds: members.map(({ id }) => id),
    positions: new Map(
      [...raw].map(([id, position]) => [id, { x: position.x - minX, y: position.y - minY }]),
    ),
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Lay out measured objects as independent weak components. */
export function layoutMeasuredGraph(
  nodes: readonly MeasuredGraphNode[],
  edges: readonly ProjectedGraphEdge[],
  _options: GraphLayoutOptions,
): GraphLayoutResult {
  const started = performance.now();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const localComponents = weakComponents(nodes, edges).map((nodeIds) =>
    layoutComponent(
      nodeIds.flatMap((id) => {
        const node = byId.get(id);
        return node === undefined ? [] : [node];
      }),
      edges,
      _options.direction,
    ),
  );
  const packed = packComponents(localComponents, coarseGraphAspectRatio(_options.aspectRatio));
  const positions = new Map<string, { x: number; y: number }>();
  const components = localComponents.map((component, index) => {
    const origin = packed.origins[index] ?? { x: 0, y: 0 };
    const bounds = {
      x: origin.x,
      y: origin.y,
      width: component.width,
      height: component.height,
    };
    for (const [id, position] of component.positions) {
      positions.set(id, { x: position.x + origin.x, y: position.y + origin.y });
    }
    return { nodeIds: component.nodeIds, bounds };
  });
  const bounds = {
    x: 0,
    y: 0,
    width: packed.width,
    height: packed.height,
  };
  const primary = components.reduce<GraphLayoutComponent | undefined>(
    (largest, component) =>
      largest === undefined || component.nodeIds.length > largest.nodeIds.length
        ? component
        : largest,
    undefined,
  ) ?? { nodeIds: [], bounds };
  const primaryIds = new Set(primary.nodeIds);
  const degree = new Map(primary.nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    if (!primaryIds.has(edge.source) || !primaryIds.has(edge.target)) continue;
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const anchorNodeId = primary.nodeIds.reduce<string | null>((best, id) => {
    if (best === null) return id;
    return (degree.get(id) ?? 0) > (degree.get(best) ?? 0) ? id : best;
  }, null);
  const diagnostics: GraphLayoutDiagnostics = {
    nodeCount: nodes.length,
    componentCount: components.length,
    durationMs: performance.now() - started,
    bounds,
    packingDensity: packed.density,
  };
  if (process.env.NODE_ENV === 'development') {
    console.debug('[canvas-layout]', diagnostics);
  }
  return {
    positions,
    components,
    bounds,
    primary: { ...primary, anchorNodeId },
    diagnostics,
  };
}
