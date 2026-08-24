/** Minimal visible Initiative node used to derive hierarchy rail segments. */
export interface InitiativeRailNode {
  /** Stable Initiative id. */
  readonly id: string;
  /** Visible or hidden parent id; hidden parents make the node a visible root. */
  readonly parentId: string | null;
}

/** Rail facts carried by one flattened Initiative row. */
export interface InitiativeTreePosition {
  /** One-based depth in the visible hierarchy. */
  readonly depth: number;
  /** Whether each hierarchy rail above the immediate parent continues through this row. */
  readonly ancestorRailContinues: readonly boolean[];
  /** Whether the row has at least one visible child. */
  readonly hasChildren: boolean;
  /** Whether the row is the last visible child of its parent. */
  readonly isLastSibling: boolean;
}

/**
 * Derive the exact continuation segments for a flattened Initiative hierarchy.
 *
 * @param nodes - Visible nodes in sibling display order.
 * @returns Position facts keyed by Initiative id.
 */
export function deriveInitiativeTreePositions(
  nodes: readonly InitiativeRailNode[],
): ReadonlyMap<string, InitiativeTreePosition> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visibleParent = (node: InitiativeRailNode): string | null =>
    node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
  const children = new Map<string | null, InitiativeRailNode[]>();
  for (const node of nodes) {
    const parentId = visibleParent(node);
    children.set(parentId, [...(children.get(parentId) ?? []), node]);
  }

  const result = new Map<string, InitiativeTreePosition>();
  for (const node of nodes) {
    const ancestors: InitiativeRailNode[] = [];
    const visited = new Set<string>([node.id]);
    let parentId = visibleParent(node);
    while (parentId !== null && !visited.has(parentId)) {
      const parent = byId.get(parentId);
      if (parent === undefined) break;
      visited.add(parent.id);
      ancestors.unshift(parent);
      parentId = visibleParent(parent);
    }

    const ancestorRailContinues = ancestors.slice(0, -1).map((ancestor) => {
      const siblings = children.get(visibleParent(ancestor)) ?? [];
      return siblings.at(-1)?.id !== ancestor.id;
    });
    const siblings = children.get(visibleParent(node)) ?? [];
    result.set(node.id, {
      depth: ancestors.length + 1,
      ancestorRailContinues,
      hasChildren: (children.get(node.id)?.length ?? 0) > 0,
      isLastSibling: siblings.at(-1)?.id === node.id,
    });
  }
  return result;
}
