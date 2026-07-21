/**
 * `initiatives` — the pure logic and typed payload behind dragging one initiative onto another to
 * nest it.
 *
 * @remarks
 * Kept free of React and the DOM so the reparent decision — which is where the real correctness
 * lives (self-drops, no-op re-nests, and cycle prevention) — is unit-tested directly. The treegrid
 * only reads/writes the drag payload and calls {@link planReparent}; it owns no nesting rules.
 */

/** The MIME type carrying an initiative being dragged to a new parent. */
export const INITIATIVE_DRAG_MIME = 'application/x-docket-initiative';

/** The payload written when an initiative row starts dragging. */
export interface InitiativeDragObject {
  readonly id: string;
  /** The row's current parent, or null at the root. */
  readonly parentInitiativeId: string | null;
  /** The hierarchy edge tying the row to its parent, or null at the root. */
  readonly parentLinkId: string | null;
}

/** Write an initiative drag payload onto a native drag event's dataTransfer. */
export function writeInitiativeDragObject(
  dataTransfer: DataTransfer,
  object: InitiativeDragObject,
): void {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(INITIATIVE_DRAG_MIME, JSON.stringify(object));
}

/**
 * Read an initiative drag payload, returning null for anything not written by
 * {@link writeInitiativeDragObject}. Defensive against malformed or foreign drags.
 */
export function readInitiativeDragObject(dataTransfer: DataTransfer): InitiativeDragObject | null {
  const raw = dataTransfer.getData(INITIATIVE_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof parsed.id === 'string'
    ) {
      const candidate = parsed as {
        id: string;
        parentInitiativeId?: unknown;
        parentLinkId?: unknown;
      };
      return {
        id: candidate.id,
        parentInitiativeId:
          typeof candidate.parentInitiativeId === 'string' ? candidate.parentInitiativeId : null,
        parentLinkId: typeof candidate.parentLinkId === 'string' ? candidate.parentLinkId : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/** The mutation a drop resolves to, or a no-op when the drop changes nothing / would be illegal. */
export type ReparentPlan =
  | { readonly kind: 'noop' }
  /** The row has no parent edge yet — create one under the target. */
  | {
      readonly kind: 'create';
      readonly parentInitiativeId: string;
      readonly childInitiativeId: string;
    }
  /** The row already has a parent edge — move it under the target. */
  | { readonly kind: 'move'; readonly linkId: string; readonly parentInitiativeId: string }
  /** Dropped on the root zone — remove the row's parent edge. */
  | { readonly kind: 'detach'; readonly linkId: string };

/** Inputs for {@link planReparent}. */
export interface PlanReparentArgs {
  /** The initiative being dragged. */
  readonly dragged: InitiativeDragObject;
  /** The initiative it was dropped on, or null for the root (un-nest) zone. */
  readonly targetId: string | null;
  /**
   * Whether `descendantId` is `ancestorId` or sits somewhere beneath it in the current tree — used
   * to reject dropping a row onto its own subtree, which would create a cycle.
   */
  readonly isSelfOrDescendant: (ancestorId: string, descendantId: string) => boolean;
}

/**
 * Decide what a drop should do, rejecting the moves that would be no-ops or would corrupt the tree.
 *
 * @remarks
 * Guards, in order: dropping onto the root when already at the root (noop); dropping onto itself
 * (noop); dropping onto its current parent (noop); dropping onto its own subtree (noop — a cycle);
 * otherwise move an existing edge or create a new one.
 */
export function planReparent({
  dragged,
  targetId,
  isSelfOrDescendant,
}: PlanReparentArgs): ReparentPlan {
  if (targetId === null) {
    return dragged.parentLinkId
      ? { kind: 'detach', linkId: dragged.parentLinkId }
      : { kind: 'noop' };
  }
  if (targetId === dragged.id) return { kind: 'noop' };
  if (targetId === dragged.parentInitiativeId) return { kind: 'noop' };
  if (isSelfOrDescendant(dragged.id, targetId)) return { kind: 'noop' };
  return dragged.parentLinkId
    ? { kind: 'move', linkId: dragged.parentLinkId, parentInitiativeId: targetId }
    : { kind: 'create', parentInitiativeId: targetId, childInitiativeId: dragged.id };
}

/**
 * Build a self-or-descendant predicate from the flat parent map of the current tree.
 *
 * @remarks
 * `parentById.get(x)` is x's parent id (or null/undefined at the root). Walking parents up from a
 * candidate reaches the ancestor iff the candidate is in its subtree.
 */
export function selfOrDescendantPredicate(
  parentById: ReadonlyMap<string, string | null>,
): (ancestorId: string, descendantId: string) => boolean {
  return (ancestorId, descendantId) => {
    let current: string | null | undefined = descendantId;
    // Bound the walk by the map size so a malformed cycle can never hang the check.
    for (let steps = 0; current != null && steps <= parentById.size; steps += 1) {
      if (current === ancestorId) return true;
      current = parentById.get(current) ?? null;
    }
    return false;
  };
}
