/**
 * `@/components/dnd` — the drag contract.
 *
 * @remarks
 * Any core object can be picked up through {@link useDraggable}. Relationship destinations use
 * the pure domain catalog and Action Registry through {@link useRelationDropTarget}. Dnd Kit is
 * the only transport, while each domain keeps ownership of the command it executes.
 */
export {
  DragProvider,
  type DragProviderProps,
  type DragController,
  type DragState,
  useDragController,
  useDragState,
} from './drag-context';
export { type DraggableBinding, type UseDraggableOptions, useDraggable } from './use-draggable';
export {
  type DropState,
  type RelationDropTargetBinding,
  type UseRelationDropTargetOptions,
  useRelationDropTarget,
} from './use-relation-drop-target';
