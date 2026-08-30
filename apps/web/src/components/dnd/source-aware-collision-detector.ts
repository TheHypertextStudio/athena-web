import { defaultCollisionDetection, type CollisionDetector } from '@dnd-kit/collision';
import { useLayoutEffect, useMemo, useRef } from 'react';

/** Resolve an application collision tier from DnD Kit's live collision input. */
export type CollisionPriorityResolver = (input: Parameters<CollisionDetector>[0]) => number | null;

/**
 * Apply an application collision tier without waiting for React to render the active source.
 *
 * @param resolvePriority - Resolves the target tier from the live collision input.
 * @returns A DnD Kit detector that preserves its geometry result and replaces its priority.
 */
export function collisionDetectorWithPriority(
  resolvePriority: CollisionPriorityResolver,
): CollisionDetector {
  return (input) => {
    const collision = defaultCollisionDetection(input);
    if (collision === null) return null;
    const priority = resolvePriority(input);
    if (priority === null) return null;
    return {
      ...collision,
      priority,
    };
  };
}

/**
 * Keep one installed detector while updating the application resolver before browser input.
 *
 * @param resolvePriority - Current resolver for the destination's application contract.
 * @returns A stable detector that reads the latest resolver and the live draggable payload.
 */
export function useCollisionDetectorWithPriority(
  resolvePriority: CollisionPriorityResolver,
): CollisionDetector {
  const resolverRef = useRef(resolvePriority);
  useLayoutEffect(() => {
    resolverRef.current = resolvePriority;
  }, [resolvePriority]);
  return useMemo(() => collisionDetectorWithPriority((input) => resolverRef.current(input)), []);
}
