/**
 * `work-views/hierarchy-rails` — the tree model and rail geometry every nested work list shares.
 *
 * @remarks
 * Initiatives nest under Initiatives and Tasks nest under their parent Task. Both lists flatten
 * the tree into rows, indent each row by its depth, and draw the same rails between a parent and
 * its children, so the ordering, the treegrid facts, and the rail measurements live here once.
 */
import type { EntityTableRowAria } from '@docket/ui/components';

/** One hierarchy depth inside the shared identity cell. */
export const HIERARCHY_DEPTH_PX = 24;

/** Width of the identity glyph or selection-control slot. */
export const HIERARCHY_LEADING_SLOT_PX = 32;

/** Horizontal center of the glyph inside its leading slot. */
export const HIERARCHY_SLOT_CENTER_PX = HIERARCHY_LEADING_SLOT_PX / 2;

/** Radius used to turn a parent rail into a child elbow. */
export const HIERARCHY_ELBOW_RADIUS_PX = 6;

/** Stroke width shared by each hierarchy segment. */
export const HIERARCHY_RAIL_STROKE_PX = 1.5;

/** Minimal visible row membership used to derive hierarchy rail segments. */
export interface HierarchyRailNode {
  /** Full path-scoped membership key. */
  readonly key: string;
  /** Full path-scoped parent membership key. */
  readonly parentKey: string | null;
}

/** Rail and treegrid facts carried by one flattened hierarchy row. */
export interface HierarchyPosition {
  /** One-based depth in the visible hierarchy. */
  readonly depth: number;
  /** Whether each hierarchy rail above the immediate parent continues through this row. */
  readonly ancestorRailContinues: readonly boolean[];
  /** Whether the row has at least one visible child. */
  readonly hasChildren: boolean;
  /** Whether the row is the last visible child of its parent. */
  readonly isLastSibling: boolean;
  /** One-based sibling position for treegrid assistive technology. */
  readonly posInSet: number;
  /** Number of visible siblings in this row's set. */
  readonly setSize: number;
}

interface HierarchyIndex {
  readonly byKey: ReadonlyMap<string, HierarchyRailNode>;
  readonly parentByKey: ReadonlyMap<string, string | null>;
  readonly children: ReadonlyMap<string | null, readonly HierarchyRailNode[]>;
  /** Each node's zero-based position among its siblings. */
  readonly siblingIndex: ReadonlyMap<string, number>;
}

/** Break corrupt parent cycles at the first membership in server display order. */
function normalizedParentKeys(
  nodes: readonly HierarchyRailNode[],
  byKey: ReadonlyMap<string, HierarchyRailNode>,
): Map<string, string | null> {
  const sourceIndex = new Map(nodes.map((node, index) => [node.key, index]));
  const parents = new Map(
    nodes.map((node) => [
      node.key,
      node.parentKey !== node.key && node.parentKey !== null && byKey.has(node.parentKey)
        ? node.parentKey
        : null,
    ]),
  );
  const resolved = new Set<string>();

  for (const node of nodes) {
    if (resolved.has(node.key)) continue;
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let current: string | null = node.key;
    while (current !== null && !resolved.has(current)) {
      const cycleStart = pathIndex.get(current);
      if (cycleStart !== undefined) {
        const cycle = path.slice(cycleStart);
        const root = cycle.reduce((first, candidate) =>
          (sourceIndex.get(candidate) ?? Number.MAX_SAFE_INTEGER) <
          (sourceIndex.get(first) ?? Number.MAX_SAFE_INTEGER)
            ? candidate
            : first,
        );
        parents.set(root, null);
        break;
      }
      pathIndex.set(current, path.length);
      path.push(current);
      current = parents.get(current) ?? null;
    }
    path.forEach((key) => resolved.add(key));
  }
  return parents;
}

/** Build one acyclic membership index without collapsing duplicate entity ids across paths. */
function hierarchyIndex(nodes: readonly HierarchyRailNode[]): HierarchyIndex {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const parentByKey = normalizedParentKeys(nodes, byKey);
  const children = new Map<string | null, HierarchyRailNode[]>();
  const siblingIndex = new Map<string, number>();
  for (const node of nodes) {
    const parentKey = parentByKey.get(node.key) ?? null;
    let siblings = children.get(parentKey);
    if (siblings === undefined) {
      siblings = [];
      children.set(parentKey, siblings);
    }
    siblingIndex.set(node.key, siblings.length);
    siblings.push(node);
  }
  return { byKey, parentByKey, children, siblingIndex };
}

/**
 * Put visible memberships into deterministic parent-before-child display order.
 *
 * @param nodes - Path-scoped nodes in server sibling order.
 * @returns the same nodes in visible hierarchy order.
 */
export function orderHierarchyNodes(
  nodes: readonly HierarchyRailNode[],
): readonly HierarchyRailNode[] {
  return orderWithIndex(nodes, hierarchyIndex(nodes));
}

/** Parent-before-child order over an index already built for `nodes`. */
function orderWithIndex(
  nodes: readonly HierarchyRailNode[],
  index: HierarchyIndex,
): readonly HierarchyRailNode[] {
  const ordered: HierarchyRailNode[] = [];
  const visited = new Set<string>();
  const visit = (parentKey: string | null): void => {
    for (const node of index.children.get(parentKey) ?? []) {
      if (visited.has(node.key)) continue;
      visited.add(node.key);
      ordered.push(node);
      visit(node.key);
    }
  };
  visit(null);
  for (const node of nodes) {
    if (!visited.has(node.key)) ordered.push(node);
  }
  return ordered;
}

/**
 * Derive continuation segments and ARIA sibling facts for a visible hierarchy.
 *
 * @param nodes - Path-scoped visible nodes in server sibling order.
 * @returns Position facts keyed by full membership key.
 */
export function deriveHierarchyPositions(
  nodes: readonly HierarchyRailNode[],
): ReadonlyMap<string, HierarchyPosition> {
  const index = hierarchyIndex(nodes);
  const ordered = orderWithIndex(nodes, index);
  const result = new Map<string, HierarchyPosition>();

  for (const node of ordered) {
    const ancestors: HierarchyRailNode[] = [];
    let parentKey = index.parentByKey.get(node.key) ?? null;
    while (parentKey !== null) {
      const parent = index.byKey.get(parentKey);
      if (parent === undefined) break;
      ancestors.unshift(parent);
      parentKey = index.parentByKey.get(parent.key) ?? null;
    }

    const ancestorRailContinues = ancestors.slice(0, -1).map((ancestor, ancestorIndex) => {
      const nextPathNode = ancestors[ancestorIndex + 1];
      const children = index.children.get(ancestor.key) ?? [];
      return nextPathNode !== undefined && children.at(-1)?.key !== nextPathNode.key;
    });
    const parent = index.parentByKey.get(node.key) ?? null;
    const siblings = index.children.get(parent) ?? [];
    const siblingIndex = index.siblingIndex.get(node.key) ?? 0;
    result.set(node.key, {
      depth: ancestors.length + 1,
      ancestorRailContinues,
      hasChildren: (index.children.get(node.key)?.length ?? 0) > 0,
      isLastSibling: siblingIndex === siblings.length - 1,
      posInSet: siblingIndex + 1,
      setSize: siblings.length,
    });
  }
  return result;
}

/**
 * Describe one hierarchy row to assistive technology as a treegrid row.
 *
 * @remarks
 * No nested list collapses a subtree, so rows carry no `aria-expanded`: announcing a parent as
 * expanded would promise a collapse that nothing performs.
 *
 * @param position - The row's position, or `undefined` for a row outside the hierarchy.
 * @returns the row's level and sibling position; a top-level single when the position is unknown.
 */
export function hierarchyRowAria(position: HierarchyPosition | undefined): EntityTableRowAria {
  if (position === undefined) return { level: 1, posInSet: 1, setSize: 1 };
  return { level: position.depth, posInSet: position.posInSet, setSize: position.setSize };
}
