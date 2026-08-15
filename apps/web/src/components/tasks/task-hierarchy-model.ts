/** `components/tasks/task-hierarchy-model` — immutable derivations over a flat task forest. */

/** Minimum task fields required to derive hierarchy relationships. */
export interface TaskHierarchyItem {
  readonly id: string;
  readonly parentTaskId?: string | null | undefined;
}

/** Shared hierarchy index consumed by list, picker, and graph interactions. */
export interface TaskHierarchy<T extends TaskHierarchyItem> {
  /** Top-level tasks, including tasks whose stored parent is absent from the input. */
  readonly roots: readonly T[];
  /** Stable parent-before-child traversal, preserving input order among siblings. */
  readonly preorder: readonly T[];
  /** Direct children in stable input order. */
  readonly childrenOf: (taskId: string) => readonly T[];
  /** Ancestor ids ordered from root to direct parent. */
  readonly ancestorsOf: (taskId: string) => readonly string[];
  /** Descendant ids in stable pre-order. */
  readonly descendantsOf: (taskId: string) => readonly string[];
  /** Zero-based hierarchy depth; unknown ids return zero. */
  readonly depthOf: (taskId: string) => number;
  /** Selected task ids reduced to roots, returned in stable hierarchy order. */
  readonly selectedRoots: (selectedIds: readonly string[]) => readonly string[];
  /** Tasks eligible to become parent of every selected hierarchy root. */
  readonly validParentCandidates: (selectedIds: readonly string[]) => readonly T[];
  /** Indentation depths whose ancestor branch continues past this row. */
  readonly continuationDepths: (taskId: string) => readonly number[];
  /** Matching ids plus their ancestor chains, returned in stable hierarchy order. */
  readonly retainAncestors: (matchingIds: readonly string[]) => readonly string[];
}

/**
 * Build one immutable task hierarchy index from flat API rows.
 *
 * @remarks
 * Missing parents are treated as top-level rather than hiding their children. Every ordered
 * derivation follows input order among roots and siblings, which keeps tables, picker results, and
 * xyflow layout visually stable across unrelated cache refreshes.
 *
 * @param items - Flat task rows in their current display order.
 * @returns relationship and traversal derivations over those rows.
 */
export function createTaskHierarchy<T extends TaskHierarchyItem>(
  items: readonly T[],
): TaskHierarchy<T> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const childrenByParent = new Map<string, T[]>();
  const rootItems: T[] = [];

  for (const item of items) {
    const parentId = item.parentTaskId ?? null;
    if (parentId === null || parentId === item.id || !byId.has(parentId)) {
      rootItems.push(item);
      continue;
    }
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(parentId, siblings);
  }

  const ordered: T[] = [];
  const depthById = new Map<string, number>();
  const visited = new Set<string>();
  const visit = (item: T, depth: number): void => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    ordered.push(item);
    depthById.set(item.id, depth);
    for (const child of childrenByParent.get(item.id) ?? []) visit(child, depth + 1);
  };
  for (const root of rootItems) visit(root, 0);
  // Corrupt cyclic input has no natural root. Keep every row visible and deterministic while the
  // server invariant is repaired rather than silently dropping the cycle from all task surfaces.
  for (const item of items) {
    if (!visited.has(item.id)) {
      rootItems.push(item);
      visit(item, 0);
    }
  }

  const ancestorsOf = (taskId: string): readonly string[] => {
    const ancestors: string[] = [];
    const seen = new Set<string>([taskId]);
    let current = byId.get(taskId)?.parentTaskId ?? null;
    while (current !== null && byId.has(current) && !seen.has(current)) {
      ancestors.unshift(current);
      seen.add(current);
      current = byId.get(current)?.parentTaskId ?? null;
    }
    return ancestors;
  };

  const descendantsOf = (taskId: string): readonly string[] => {
    const descendants: string[] = [];
    const seen = new Set<string>([taskId]);
    const collect = (parentId: string): void => {
      for (const child of childrenByParent.get(parentId) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        descendants.push(child.id);
        collect(child.id);
      }
    };
    collect(taskId);
    return descendants;
  };

  const selectedRoots = (selectedIds: readonly string[]): readonly string[] => {
    const selected = new Set(selectedIds.filter((id) => byId.has(id)));
    return ordered
      .filter((item) => selected.has(item.id))
      .filter((item) => !ancestorsOf(item.id).some((ancestorId) => selected.has(ancestorId)))
      .map(({ id }) => id);
  };

  return {
    roots: rootItems,
    preorder: ordered,
    childrenOf: (taskId) => childrenByParent.get(taskId) ?? [],
    ancestorsOf,
    descendantsOf,
    depthOf: (taskId) => depthById.get(taskId) ?? 0,
    selectedRoots,
    validParentCandidates: (selectedIds) => {
      const excluded = new Set<string>();
      for (const rootId of selectedRoots(selectedIds)) {
        excluded.add(rootId);
        for (const descendantId of descendantsOf(rootId)) excluded.add(descendantId);
      }
      return ordered.filter(({ id }) => !excluded.has(id));
    },
    continuationDepths: (taskId) => {
      const continuing: number[] = [];
      for (const ancestorId of ancestorsOf(taskId)) {
        const ancestor = byId.get(ancestorId);
        if (!ancestor) continue;
        const parentId = ancestor.parentTaskId ?? null;
        // Separate roots are separate trees/lanes, so their spacing never draws as a continuing
        // subtask rail inside the current tree.
        if (parentId === null) continue;
        const siblings = childrenByParent.get(parentId) ?? [];
        const index = siblings.findIndex(({ id }) => id === ancestorId);
        if (index >= 0 && index < siblings.length - 1) {
          continuing.push(depthById.get(ancestorId) ?? 0);
        }
      }
      return continuing;
    },
    retainAncestors: (matchingIds) => {
      const retained = new Set<string>();
      for (const id of matchingIds) {
        if (!byId.has(id)) continue;
        retained.add(id);
        for (const ancestorId of ancestorsOf(id)) retained.add(ancestorId);
      }
      return ordered.filter(({ id }) => retained.has(id)).map(({ id }) => id);
    },
  };
}
