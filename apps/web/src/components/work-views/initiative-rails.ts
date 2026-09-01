/** One Initiative hierarchy depth inside the shared identity cell. */
export const INITIATIVE_DEPTH_PX = 24;

/** Width of the identity glyph or selection-control slot. */
export const INITIATIVE_LEADING_SLOT_PX = 32;

/** Horizontal center of the glyph inside its leading slot. */
export const INITIATIVE_SLOT_CENTER_PX = INITIATIVE_LEADING_SLOT_PX / 2;

/** Radius used to turn a parent rail into a child elbow. */
export const INITIATIVE_ELBOW_RADIUS_PX = 6;

/** Stroke width shared by each hierarchy segment. */
export const INITIATIVE_RAIL_STROKE_PX = 1.5;

/** Minimal visible Initiative membership used to derive hierarchy rail segments. */
export interface InitiativeRailNode {
  /** Full path-scoped membership key. */
  readonly key: string;
  /** Full path-scoped parent membership key. */
  readonly parentKey: string | null;
}

/** Rail and treegrid facts carried by one flattened Initiative row. */
export interface InitiativeTreePosition {
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

interface InitiativeTreeIndex {
  readonly byKey: ReadonlyMap<string, InitiativeRailNode>;
  readonly parentByKey: ReadonlyMap<string, string | null>;
  readonly children: ReadonlyMap<string | null, readonly InitiativeRailNode[]>;
}

/** Break corrupt parent cycles at the first membership in server display order. */
function normalizedParentKeys(
  nodes: readonly InitiativeRailNode[],
  byKey: ReadonlyMap<string, InitiativeRailNode>,
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
function initiativeTreeIndex(nodes: readonly InitiativeRailNode[]): InitiativeTreeIndex {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const parentByKey = normalizedParentKeys(nodes, byKey);
  const children = new Map<string | null, InitiativeRailNode[]>();
  for (const node of nodes) {
    const parentKey = parentByKey.get(node.key) ?? null;
    children.set(parentKey, [...(children.get(parentKey) ?? []), node]);
  }
  return { byKey, parentByKey, children };
}

/**
 * Put visible Initiative memberships into deterministic parent-before-child display order.
 *
 * @param nodes - Path-scoped nodes in server sibling order.
 * @returns the same nodes in visible hierarchy order.
 */
export function orderInitiativeTreeNodes(
  nodes: readonly InitiativeRailNode[],
): readonly InitiativeRailNode[] {
  const index = initiativeTreeIndex(nodes);
  const ordered: InitiativeRailNode[] = [];
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
 * Derive continuation segments and ARIA sibling facts for a visible Initiative hierarchy.
 *
 * @param nodes - Path-scoped visible nodes in server sibling order.
 * @returns Position facts keyed by full membership key.
 */
export function deriveInitiativeTreePositions(
  nodes: readonly InitiativeRailNode[],
): ReadonlyMap<string, InitiativeTreePosition> {
  const index = initiativeTreeIndex(nodes);
  const ordered = orderInitiativeTreeNodes(nodes);
  const result = new Map<string, InitiativeTreePosition>();

  for (const node of ordered) {
    const ancestors: InitiativeRailNode[] = [];
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
    const siblingIndex = siblings.findIndex((sibling) => sibling.key === node.key);
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
