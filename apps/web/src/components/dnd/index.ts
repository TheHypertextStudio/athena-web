/**
 * `@/components/dnd` — the drag contract.
 *
 * @remarks
 * Any core object can be picked up ({@link useDraggable}) and any surface can declare what it
 * accepts ({@link useDropTarget}). Neither side imports the other: the object in flight is the
 * whole interface between them, which is what makes "drag a task into a project", "drag a task
 * into a time block", and "associate a project with a calendar event" the same mechanism rather
 * than three features.
 */
export {
  DragProvider,
  type DragProviderProps,
  type DragController,
  type DragState,
  useDragController,
  useDragState,
} from './drag-context';
export {
  OBJECT_DRAG_MIME,
  hasObjectPayload,
  readObjectPayload,
  writeObjectPayload,
} from './drag-payload';
export { type DraggableBinding, type UseDraggableOptions, useDraggable } from './use-draggable';
export {
  type DropState,
  type DropTargetBinding,
  type DropTargetProps,
  type UseDropTargetOptions,
  useDropTarget,
} from './use-drop-target';
