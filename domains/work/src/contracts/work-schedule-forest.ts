import { z } from 'zod';
import { StepKey } from './work-template-blueprint';
import { WorkScheduleDraft } from './work-schedule';

/** Private path in a particular forest root; equal child paths in other roots are distinct. */
export const WorkScheduleForestPath = z.strictObject({
  rootKey: StepKey,
  path: z.array(StepKey).max(499),
});
/** Root-qualified canonical logical path, checked against the expanded publication by the compiler. */
export type WorkScheduleForestPath = z.infer<typeof WorkScheduleForestPath>;

const dependency = z.strictObject({
  blocker: WorkScheduleForestPath,
  blocked: WorkScheduleForestPath,
});
const timing = z.strictObject({
  target: WorkScheduleForestPath,
  prerequisite: WorkScheduleForestPath,
  offsetDays: z.number().int().min(-36500).max(36500),
});

const forest = z.strictObject({
  kind: z.literal('forest'),
  revision: z.literal(1),
  state: z.enum(['published', 'pending_draft']),
  roots: z
    .array(z.strictObject({ key: StepKey, draft: WorkScheduleDraft }))
    .min(1)
    .max(500),
  dependencies: z.array(dependency).max(500),
  timing: z.array(timing).max(500),
});
type Forest = z.infer<typeof forest>;
type Edge = readonly [WorkScheduleForestPath, WorkScheduleForestPath];

function pathKey(path: WorkScheduleForestPath): string {
  return JSON.stringify([path.rootKey, path.path]);
}
function validateEdges(
  edges: readonly Edge[],
  roots: ReadonlySet<string>,
  field: 'dependencies' | 'timing',
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [from, to] of edges) {
    const key = JSON.stringify([pathKey(from), pathKey(to)]);
    if (!roots.has(from.rootKey) || !roots.has(to.rootKey))
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'Every rule requires an existing root.',
      });
    if (pathKey(from) === pathKey(to) || seen.has(key))
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'Private rules must be distinct and cannot refer to themselves.',
      });
    seen.add(key);
  }
}
function buildGraph(edges: readonly Edge[]): {
  graph: Map<string, Set<string>>;
  indegree: Map<string, number>;
} {
  const graph = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const [from, to] of edges) {
    const a = pathKey(from),
      b = pathKey(to);
    if (!graph.has(a)) graph.set(a, new Set());
    if (!indegree.has(a)) indegree.set(a, 0);
    if (graph.get(a)?.has(b)) continue;
    graph.get(a)?.add(b);
    indegree.set(b, (indegree.get(b) ?? 0) + 1);
  }
  return { graph, indegree };
}
function hasCycle(edges: readonly Edge[]): boolean {
  const { graph, indegree } = buildGraph(edges);
  const ready = [...indegree.keys()].filter((key) => indegree.get(key) === 0);
  let count = 0;
  for (const key of ready) {
    count++;
    for (const next of graph.get(key) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }
  return count !== indegree.size;
}
function validateForest(value: Forest, ctx: z.RefinementCtx): void {
  // One occurrence has one saved civil calendar for cadence and actual completion facts.
  if (new Set(value.roots.map((root) => root.draft.timezone)).size !== 1)
    ctx.addIssue({
      code: 'custom',
      path: ['roots'],
      message: 'All schedule roots must share their saved timezone.',
    });
  const roots = new Set(value.roots.map((root) => root.key));
  if (roots.size !== value.roots.length)
    ctx.addIssue({
      code: 'custom',
      path: ['roots'],
      message: 'Each forest root needs a distinct key.',
    });
  const dependencies = value.dependencies.map((edge): Edge => [edge.blocker, edge.blocked]);
  const timing = value.timing.map((edge): Edge => [edge.prerequisite, edge.target]);
  validateEdges(dependencies, roots, 'dependencies', ctx);
  validateEdges(timing, roots, 'timing', ctx);
  if (hasCycle([...dependencies, ...timing]))
    ctx.addIssue({
      code: 'custom',
      message: 'Private dependency and timing rules must not form a cycle.',
    });
}
/** Immutable private authoring forest; pending documents never authorize execution or publication. */
export const WorkScheduleForest = forest.superRefine(validateForest);
/** Private native forest, separate from the byte-preserved historical invocation representation. */
export type WorkScheduleForest = z.infer<typeof WorkScheduleForest>;
