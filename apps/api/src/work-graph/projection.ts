/** Project authorized semantic work into bounded, explicit graph scenes. */
import type { z } from 'zod';
import { GraphInput, type GraphData, type GraphSnapshot, type GraphWork } from './contract';
import { isDependency, isEnded, orderWork, parentKeys, scopeKeys, inlineSlice } from './selection';
import { positionScene } from './scene-layout';
import { expandFocusedAncestors, pageGraphScene } from './scene-selection';
import { NotFoundError } from '../error';

type SceneNode = GraphSnapshot['nodes'][number];

function hasExpandedAncestors(
  key: string,
  context: {
    parents: Map<string, string>;
    root: string;
    scoped: Set<string>;
    expanded: Set<string>;
  },
): boolean {
  let parent = context.parents.get(key);
  const seen = new Set([key]);
  while (parent && parent !== context.root && !seen.has(parent)) {
    if (context.scoped.has(parent) && !context.expanded.has(parent)) return false;
    seen.add(parent);
    parent = context.parents.get(parent);
  }
  return true;
}

function visibleCandidates(
  data: GraphData,
  input: GraphInput,
  scoped: Set<string>,
  parents: Map<string, string>,
  root: string,
) {
  const expanded = new Set([root, ...input.expanded]);
  const rootDependencies = data.relations.some(
    (r) => isDependency(r) && (r.source === root || r.target === root),
  );
  const context = new Set<string>();
  for (const r of data.relations.filter(isDependency)) {
    if (scoped.has(r.source)) context.add(r.target);
    if (scoped.has(r.target)) context.add(r.source);
  }
  const openKeys = new Set(data.nodes.filter((n) => !isEnded(n)).map((n) => n.key));
  const openBranch = (key: string): boolean => {
    const pending = [key],
      seen = new Set<string>();
    while (pending.length) {
      const item = pending.pop();
      if (!item || seen.has(item)) continue;
      seen.add(item);
      if (openKeys.has(item)) return true;
      pending.push(
        ...data.relations
          .filter((r) => r.kind === 'contains' && r.source === item)
          .map((r) => r.target),
      );
    }
    return false;
  };
  return data.nodes.filter((n) => {
    if (!scoped.has(n.key)) return context.has(n.key);
    if (n.key === root) return input.scope.kind === 'task' || rootDependencies;
    if (input.completion !== 'all' && isEnded(n) && !openBranch(n.key)) return false;
    if (input.display === 'inline')
      return (
        n.kind === 'task' ||
        !data.relations.some((r) => r.source === n.key && r.kind === 'contains')
      );
    return hasExpandedAncestors(n.key, { parents, root, scoped, expanded });
  });
}

function projectEdges(
  data: GraphData,
  shown: Set<string>,
  parents: Map<string, string>,
  scoped: Set<string>,
  input: GraphInput,
): GraphSnapshot['edges'] {
  const expanded = new Set([`${input.scope.kind}:${input.scope.id}`, ...input.expanded]);
  const endpoint = (key: string): string | null => {
    const seen = new Set<string>();
    let current: string | undefined = key;
    while (current && !seen.has(current)) {
      if (current !== key && (input.display === 'inline' || expanded.has(current))) return null;
      if (shown.has(current)) return current;
      seen.add(current);
      current = parents.get(current);
    }
    return null;
  };
  const edges = new Map<string, GraphSnapshot['edges'][number]>();
  for (const r of data.relations.filter(isDependency)) {
    if (!scoped.has(r.source) && !scoped.has(r.target)) continue;
    const source = endpoint(r.source),
      target = endpoint(r.target);
    if (!source || !target || source === target) continue;
    const key = `${r.kind}:${source}>${target}`;
    const existing = edges.get(key);
    if (existing) {
      existing.count++;
      continue;
    }
    edges.set(key, {
      source,
      target,
      kind: r.kind,
      count: 1,
      aggregated: source !== r.source || target !== r.target,
    });
  }
  return [...edges.values()];
}

function groupCounts(
  data: GraphData,
  scoped: Set<string>,
  root: string,
  counted: ReadonlySet<string>,
) {
  const parents = parentKeys(data.relations);
  const groups = new Map<string, { count: number; focus: string }>();
  for (const n of data.nodes.filter(
    (n) => scoped.has(n.key) && counted.has(n.key) && n.category === 'completed',
  )) {
    const key = parents.get(n.key) ?? root;
    groups.set(key, {
      count: (groups.get(key)?.count ?? 0) + 1,
      focus: groups.get(key)?.focus ?? n.key,
    });
  }
  const titles = new Map(data.nodes.map((n) => [n.key, n.title]));
  return [...groups].map(([key, group]) => ({
    key,
    title: titles.get(key) ?? 'Completed work',
    count: group.count,
    focus: group.focus,
  }));
}

function boundaries(
  data: GraphData,
  shown: Set<string>,
  edges: GraphSnapshot['edges'],
): GraphSnapshot['boundaries'] {
  return [...shown]
    .map((key) => ({
      key,
      incoming: data.relations.filter(
        (r) =>
          isDependency(r) &&
          r.target === key &&
          !shown.has(r.source) &&
          !edges.some((e) => e.target === key && e.source === r.source),
      ).length,
      outgoing: data.relations.filter(
        (r) =>
          isDependency(r) &&
          r.source === key &&
          !shown.has(r.target) &&
          !edges.some((e) => e.source === key && e.target === r.target),
      ).length,
    }))
    .filter((b) => b.incoming || b.outgoing);
}

function sceneNode(
  n: GraphWork,
  scoped: Set<string>,
  parents: Map<string, string>,
  data: GraphData,
  input: GraphInput,
): SceneNode {
  const children = data.relations.filter((r) => r.source === n.key && r.kind === 'contains');
  const done = new Set(data.nodes.filter((c) => c.category === 'completed').map((c) => c.key));
  return {
    ...n,
    external: !scoped.has(n.key),
    parentKey: parents.get(n.key) ?? null,
    childCount: children.length,
    completedCount: children.filter((r) => done.has(r.target)).length,
    matched: data.matches
      ? data.matches.has(n.key)
      : !input.focusKeys.length || input.focusKeys.includes(n.key),
    x: 0,
    y: 0,
    width: 238,
    height: 96,
  };
}

/** Build one bounded scene; totals describe authorized scope work, never just the displayed page. */
export function projectWorkGraph(
  data: GraphData,
  options: z.input<typeof GraphInput>,
): GraphSnapshot {
  let input = GraphInput.parse(options);
  const root = `${input.scope.kind}:${input.scope.id}`;
  const scope = data.nodes.find((n) => n.key === root);
  if (!scope) throw new NotFoundError('Work not found');
  const scoped = scopeKeys(data, input);
  const parents = parentKeys(data.relations);
  input = expandFocusedAncestors(input, scoped, parents);
  const tasks = data.nodes.filter((n) => scoped.has(n.key) && n.kind === 'task');
  const counted = tasks.length
    ? tasks
    : data.nodes.filter((n) => scoped.has(n.key) && n.key !== root);
  const totals = {
    total: counted.length,
    remaining: counted.filter((n) => !isEnded(n)).length,
    completed: counted.filter((n) => n.category === 'completed').length,
    canceled: counted.filter((n) => n.category === 'canceled').length,
  };
  const candidates = orderWork(
    visibleCandidates(data, input, scoped, parents, root),
    data.relations,
    input.focus,
  );
  const limit = input.viewport === 'portrait' ? 2 : 6;
  const page =
    input.display === 'inline'
      ? {
          selected: inlineSlice(candidates, data.relations, scoped, limit, input.focus),
          hasNextPage: false,
          omitted: Math.max(0, candidates.length - limit),
        }
      : pageGraphScene(candidates, parents, input);
  const selected = page.selected;
  const shown = new Set(selected.map((n) => n.key));
  const nodes = selected.map((n) => sceneNode(n, scoped, parents, data, input));
  const edges = projectEdges(data, shown, parents, scoped, input);
  const relationSet = new Set([...shown, root]);
  const relations = data.relations.filter(
    (r) => !isDependency(r) && relationSet.has(r.source) && relationSet.has(r.target),
  );
  const geometry = positionScene(nodes, edges, input.viewport === 'portrait');
  return {
    orgId: input.orgId,
    expanded: input.expanded,
    scope,
    asOf: new Date().toISOString(),
    nodes,
    edges,
    relations,
    totals,
    completedGroups:
      input.completion === 'collapsed'
        ? groupCounts(data, scoped, root, new Set(counted.map((n) => n.key)))
        : [],
    omitted: page.omitted,
    hasNextPage: page.hasNextPage,
    page: input.page,
    boundaries: boundaries(data, shown, edges),
    ...geometry,
  };
}
