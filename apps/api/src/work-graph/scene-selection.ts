/** Focus expansion and child paging retain semantic container context within a bounded scene. */
import type { GraphInput, GraphWork } from './contract';

/** Reveal the authorized focus's ancestor chain while leaving unrelated groups collapsed. */
export function expandFocusedAncestors(
  input: GraphInput,
  scoped: ReadonlySet<string>,
  parents: ReadonlyMap<string, string>,
): GraphInput {
  if (!input.focus || !scoped.has(input.focus)) return input;
  const expanded = new Set(input.expanded);
  const seen = new Set<string>();
  let key = parents.get(input.focus);
  while (key && !seen.has(key)) {
    seen.add(key);
    expanded.add(key);
    key = parents.get(key);
  }
  return { ...input, expanded: [...expanded] };
}

function ancestorChain(
  node: GraphWork,
  byKey: ReadonlyMap<string, GraphWork>,
  parents: ReadonlyMap<string, string>,
): GraphWork[] {
  const chain = [node];
  const seen = new Set([node.key]);
  let key = parents.get(node.key);
  while (key && !seen.has(key)) {
    seen.add(key);
    const parent = byKey.get(key);
    if (!parent) break;
    chain.push(parent);
    key = parents.get(key);
  }
  return chain;
}

/** Page visible child work and retain its ancestor cards, with at most 200 total nodes. */
export function pageGraphScene(
  candidates: readonly GraphWork[],
  parents: ReadonlyMap<string, string>,
  input: GraphInput,
): { selected: GraphWork[]; hasNextPage: boolean; omitted: number } {
  const byKey = new Map(candidates.map((n) => [n.key, n]));
  const root = `${input.scope.kind}:${input.scope.id}`;
  const structural = new Set(
    [...parents]
      .filter(([child, parent]) => byKey.has(child) && byKey.has(parent) && parent !== root)
      .map(([, parent]) => parent),
  );
  const work = candidates.filter((n) => !structural.has(n.key));
  const offset = input.page * 100;
  const page = work.slice(offset, offset + 100);
  const selected = new Map<string, GraphWork>();
  for (const node of page) {
    const chain = ancestorChain(node, byKey, parents);
    const missing = chain.filter((n) => !selected.has(n.key));
    if (selected.size + missing.length > 200) continue;
    for (const n of missing) selected.set(n.key, n);
  }
  return {
    selected: [...selected.values()],
    hasNextPage: offset + 100 < work.length,
    omitted: Math.max(0, candidates.length - selected.size),
  };
}
