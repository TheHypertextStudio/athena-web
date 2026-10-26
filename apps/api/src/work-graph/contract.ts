/** Validated read-only graph wire contract shared by the reader and MCP adapter. */
import { z } from 'zod';
import { WorkStatusCategory } from '@docket/work/work-status-contract';

/** A saved kind of work that can anchor a dependency review. */
export const GraphKind = z.enum(['task', 'project', 'program', 'initiative']);
/** Identity of a saved graph scope. */
export const GraphScope = z.object({ kind: GraphKind, id: z.string().min(1) });
/** Read options; presentation changes never mutate saved work. */
export const GraphInput = z.object({
  orgId: z.string().min(1),
  scope: GraphScope,
  focus: z.string().optional().describe('Canonical kind:id key to select.'),
  completion: z.enum(['collapsed', 'all', 'remaining']).default('collapsed'),
  expanded: z.array(z.string()).max(200).default([]),
  display: z.enum(['inline', 'fullscreen']).default('inline'),
  viewport: z.enum(['portrait', 'square', 'landscape']).default('landscape'),
  page: z.number().int().min(0).default(0),
  depth: z.number().int().min(1).max(5).default(2),
  focusKeys: z.array(z.string()).max(200).default([]),
  focusFilter: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Existing list_work task filters; matches are highlighted, dependencies remain context.',
    ),
});
/** Resolved graph input including defaults. */
export type GraphInput = z.infer<typeof GraphInput>;
/** Canonical work metadata; no render-time status guessing. */
export const GraphWork = GraphScope.extend({
  key: z.string(),
  title: z.string(),
  status: z.string(),
  category: WorkStatusCategory,
  priority: z.string(),
  href: z.string(),
});
/** A permission-filtered saved work identity. */
export type GraphWork = z.infer<typeof GraphWork>;
/** Saved relationships keep contribution, containment and blocking separate. */
export const GraphRelation = z.object({
  source: z.string(),
  target: z.string(),
  kind: z.enum(['contains', 'contributes', 'task_dependency', 'project_dependency']),
});
/** A permission-filtered saved relationship. */
export type GraphRelation = z.infer<typeof GraphRelation>;
/** Authorized, unbounded semantic inputs to presentation projection. */
export interface GraphData {
  readonly nodes: readonly GraphWork[];
  readonly relations: readonly GraphRelation[];
  readonly matches?: ReadonlySet<string>;
}
/** One scene node, including container expansion and navigation metadata. */
export const SceneNode = GraphWork.extend({
  external: z.boolean(),
  parentKey: z.string().nullable(),
  childCount: z.number(),
  completedCount: z.number(),
  matched: z.boolean(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
/** Complete validated response; displayed counts never stand in for scope totals. */
export const GraphSnapshot = z.object({
  orgId: z.string(),
  expanded: z.array(z.string()),
  scope: GraphWork,
  asOf: z.string(),
  nodes: z.array(SceneNode),
  edges: z.array(GraphRelation.extend({ count: z.number(), aggregated: z.boolean() })),
  relations: z.array(GraphRelation),
  totals: z.object({
    total: z.number(),
    remaining: z.number(),
    completed: z.number(),
    canceled: z.number(),
  }),
  completedGroups: z.array(
    z.object({ key: z.string(), title: z.string(), count: z.number(), focus: z.string() }),
  ),
  omitted: z.number(),
  hasNextPage: z.boolean(),
  page: z.number(),
  boundaries: z.array(z.object({ key: z.string(), incoming: z.number(), outgoing: z.number() })),
  width: z.number(),
  height: z.number(),
});
/** A graph snapshot ready for both MCP rendering and text fallback. */
export type GraphSnapshot = z.infer<typeof GraphSnapshot>;
