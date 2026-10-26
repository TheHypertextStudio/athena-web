/** Shared React-independent graph geometry, retained here for existing web adapters. */
import {
  layoutMeasuredGraph as sharedLayout,
  type GraphLayoutOptions,
  type GraphLayoutResult,
  type MeasuredGraphNode,
  type ProjectedGraphEdge,
} from '@docket/work/graph-layout';
export * from '@docket/work/graph-layout';

/** Lay out web graph components and retain development diagnostics in the web adapter. */
export function layoutMeasuredGraph(
  nodes: readonly MeasuredGraphNode[],
  edges: readonly ProjectedGraphEdge[],
  options: GraphLayoutOptions,
): GraphLayoutResult {
  const result = sharedLayout(nodes, edges, options);
  if (process.env.NODE_ENV === 'development') console.debug('[canvas-layout]', result.diagnostics);
  return result;
}
