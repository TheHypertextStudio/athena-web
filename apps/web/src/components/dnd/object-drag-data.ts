import {
  resolveDefaultRelation,
  type RelationEndpoint,
  type RelationResolution,
} from '@docket/work/relation-contract';

import type { ObjectRef } from '@/lib/actions/object';

/** Data carried by the in-document drag manager for one object gesture. */
export interface ObjectDragData {
  /** Discriminator that prevents unrelated spatial drags from entering relationship targets. */
  readonly kind: 'docket-object';
  /** Primary object represented by the source element. */
  readonly object: ObjectRef;
  /** Ordered selection carried with the primary object. */
  readonly objects: readonly ObjectRef[];
  /** Selection surface where the gesture began. */
  readonly sourceSurfaceId: string | null;
}

/** Narrow drag-manager data to the canonical Docket object payload. */
export function isObjectDragData(value: unknown): value is ObjectDragData {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ObjectDragData>;
  return candidate.kind === 'docket-object' && candidate.object !== undefined;
}

/** Project presentation identity into the dependency-free relation endpoint. */
export function relationEndpointForObject(object: ObjectRef): RelationEndpoint {
  return {
    kind:
      object.kind === 'calendar_event' || object.kind === 'time_block'
        ? 'calendar_item'
        : object.kind,
    id: object.id,
    organizationId: object.organizationId,
    ...(object.meta === undefined ? {} : { meta: object.meta }),
  };
}

/** Resolve canonical presentation objects through the pure domain catalog. */
export function resolveObjectRelation(
  subjects: readonly ObjectRef[],
  target: ObjectRef,
): RelationResolution {
  return resolveDefaultRelation({
    subjects: subjects.map(relationEndpointForObject),
    target: relationEndpointForObject(target),
  });
}
