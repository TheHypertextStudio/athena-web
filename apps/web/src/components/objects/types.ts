/**
 * Core types for the Athena Object System.
 *
 * Every entity in Athena extends AthenaObject, enabling unified handling
 * of selection, drag/drop, actions, and rendering across all surfaces.
 */

import type {
  Task,
  Event,
  Project,
  Initiative,
  Moment,
  Activity,
  TaskId,
  EventId,
  ProjectId,
  InitiativeId,
  MomentId,
  ActivityId,
} from '@athena/types';
import type { ComponentType, ReactNode } from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';

// =============================================================================
// Object Types
// =============================================================================

/**
 * All object types in the Athena system.
 */
export type ObjectType = 'task' | 'event' | 'project' | 'initiative' | 'moment' | 'activity';

/**
 * Map from object type to ID type.
 */
export interface ObjectIdMap {
  task: TaskId;
  event: EventId;
  project: ProjectId;
  initiative: InitiativeId;
  moment: MomentId;
  activity: ActivityId;
}

/**
 * Map from object type to entity type.
 */
export interface ObjectDataMap {
  task: Task;
  event: Event;
  project: Project;
  initiative: Initiative;
  moment: Moment;
  activity: Activity;
}

/**
 * Union ID type for any object.
 */
export type AnyObjectId = ObjectIdMap[ObjectType];

/**
 * Base interface for all Athena objects.
 */
export interface AthenaObject<T extends ObjectType = ObjectType> {
  id: ObjectIdMap[T];
  type: T;
  data: ObjectDataMap[T];
}

/**
 * Typed object constructors for type narrowing.
 */
export type TaskObject = AthenaObject<'task'>;
export type EventObject = AthenaObject<'event'>;
export type ProjectObject = AthenaObject<'project'>;
export type InitiativeObject = AthenaObject<'initiative'>;
export type MomentObject = AthenaObject<'moment'>;
export type ActivityObject = AthenaObject<'activity'>;

/**
 * Any Athena object.
 */
export type AnyObject =
  | TaskObject
  | EventObject
  | ProjectObject
  | InitiativeObject
  | MomentObject
  | ActivityObject;

// =============================================================================
// Object Capabilities
// =============================================================================

/**
 * Capabilities matrix for each object type.
 */
export interface ObjectCapabilities {
  draggable: boolean;
  droppable: boolean;
  resizable: boolean;
  completable: boolean;
  nestable: boolean;
}

/**
 * Default capabilities by object type.
 */
export const OBJECT_CAPABILITIES: Record<ObjectType, ObjectCapabilities> = {
  task: {
    draggable: true,
    droppable: false,
    resizable: false,
    completable: true,
    nestable: true, // subtasks
  },
  event: {
    draggable: true,
    droppable: false,
    resizable: true, // time
    completable: false,
    nestable: false,
  },
  project: {
    draggable: true,
    droppable: true, // accepts tasks
    resizable: false,
    completable: true,
    nestable: false,
  },
  initiative: {
    draggable: true,
    droppable: true, // accepts projects
    resizable: false,
    completable: true,
    nestable: true, // sub-initiatives
  },
  moment: {
    draggable: true,
    droppable: true, // accepts any
    resizable: true, // time
    completable: false,
    nestable: false,
  },
  activity: {
    draggable: true,
    droppable: false,
    resizable: false,
    completable: false,
    nestable: false,
  },
};

/**
 * What object types can be dropped into each container type.
 */
export const DROP_ACCEPT_MAP: Record<ObjectType, ObjectType[]> = {
  task: [], // Tasks don't accept drops
  event: [], // Events don't accept drops
  project: ['task'], // Projects accept tasks
  initiative: ['project'], // Initiatives accept projects
  moment: ['task', 'event', 'activity'], // Moments accept most things
  activity: [], // Activities don't accept drops
};

// =============================================================================
// Surface Types
// =============================================================================

/**
 * Unique identifier for a surface in the UI.
 */
export type SurfaceId = string & { readonly __brand: 'SurfaceId' };

/**
 * Create a SurfaceId from a string.
 */
export function surfaceId(id: string): SurfaceId {
  return id as SurfaceId;
}

/**
 * Types of surfaces that can contain objects.
 */
export type SurfaceType =
  | 'list' // Sortable list (agenda, task list)
  | 'calendar' // Time-based grid
  | 'board' // Kanban columns
  | 'timeline' // Activity timeline
  | 'detail'; // Detail panel

/**
 * Position where an object can be dropped.
 */
export type DropPosition =
  | { type: 'index'; index: number } // List position
  | { type: 'time'; start: Date; end?: Date } // Calendar position
  | { type: 'container'; containerId: string }; // Into container

// =============================================================================
// Action Types
// =============================================================================

/**
 * An action that can be performed on objects.
 */
export interface Action {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  shortcut?: string;

  /** Object types this action applies to */
  appliesTo: ObjectType[];

  /** Whether this action is available given the objects */
  isAvailable?: (objects: AnyObject[]) => boolean;

  /** Execute the action */
  execute: (objects: AnyObject[]) => void | Promise<void>;

  /** Whether this is a destructive action */
  isDestructive?: boolean;

  /** Whether to show confirmation dialog */
  requiresConfirmation?: boolean;
}

/**
 * Group of related actions.
 */
export interface ActionGroup {
  id: string;
  label?: string;
  actions: Action[];
}

// =============================================================================
// Renderer Types
// =============================================================================

/**
 * Variant of object rendering.
 */
export type RenderVariant = 'compact' | 'normal' | 'expanded';

/**
 * Props passed to object renderers.
 */
export interface RendererProps<T extends AnyObject = AnyObject> {
  object: T;
  variant: RenderVariant;
  selected?: boolean;
  focused?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  dragHandleProps?: DragHandleProps;
}

/**
 * Props for drag handle elements using dnd-kit types.
 */
export interface DragHandleProps {
  /** Attributes to spread on the drag handle */
  attributes: DraggableAttributes;
  /** Listeners for drag events */
  listeners: DraggableSyntheticListeners;
  /** Ref callback for the drag handle */
  setNodeRef: (node: HTMLElement | null) => void;
}

// =============================================================================
// Context Types
// =============================================================================

/**
 * Context provided to ObjectNode children.
 */
export interface ObjectContext<T extends AnyObject = AnyObject> {
  /** The wrapped object */
  object: T;

  /** Object type */
  type: ObjectType;

  /** Selection state */
  isSelected: boolean;
  isFocused: boolean;

  /** Drag state */
  isDragging: boolean;
  isDropTarget: boolean;

  /** Selection actions */
  select: () => void;
  toggleSelect: () => void;

  /** Drag handle props (for drag-by-handle pattern) */
  dragHandleProps: DragHandleProps | null;

  /** Available actions */
  actions: Action[];
  executeAction: (actionId: string) => void;

  /** Relationships */
  parent: AnyObject | null;
  children: AnyObject[];
}

/**
 * Render prop type for ObjectNode.
 */
export type ObjectNodeRenderProp<T extends AnyObject> = (context: ObjectContext<T>) => ReactNode;

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Helper to create an AthenaObject from domain data.
 */
export function createObject<T extends ObjectType>(
  type: T,
  data: ObjectDataMap[T],
): AthenaObject<T> {
  return {
    id: data.id as ObjectIdMap[T],
    type,
    data,
  };
}

/**
 * Type guard to check if object is a task.
 */
export function isTask(obj: AnyObject): obj is TaskObject {
  return obj.type === 'task';
}

/**
 * Type guard to check if object is an event.
 */
export function isEvent(obj: AnyObject): obj is EventObject {
  return obj.type === 'event';
}

/**
 * Type guard to check if object is a project.
 */
export function isProject(obj: AnyObject): obj is ProjectObject {
  return obj.type === 'project';
}

/**
 * Type guard to check if object is an initiative.
 */
export function isInitiative(obj: AnyObject): obj is InitiativeObject {
  return obj.type === 'initiative';
}

/**
 * Type guard to check if object is a moment.
 */
export function isMoment(obj: AnyObject): obj is MomentObject {
  return obj.type === 'moment';
}

/**
 * Type guard to check if object is an activity.
 */
export function isActivity(obj: AnyObject): obj is ActivityObject {
  return obj.type === 'activity';
}

/**
 * Get the title/name of any object for display.
 */
export function getObjectTitle(obj: AnyObject): string {
  switch (obj.type) {
    case 'task':
      return obj.data.title;
    case 'event':
      return obj.data.title;
    case 'project':
      return obj.data.name;
    case 'initiative':
      return obj.data.name;
    case 'moment':
      return obj.data.label ?? 'Untitled Moment';
    case 'activity':
      return obj.data.type;
    default:
      return 'Unknown';
  }
}

/**
 * Check if an object can be completed.
 */
export function isCompletable(obj: AnyObject): boolean {
  return OBJECT_CAPABILITIES[obj.type].completable;
}

/**
 * Check if an object is currently completed.
 */
export function isCompleted(obj: AnyObject): boolean {
  switch (obj.type) {
    case 'task':
      return obj.data.status === 'completed';
    case 'project':
      return obj.data.status === 'completed';
    case 'initiative':
      return obj.data.status === 'completed';
    default:
      return false;
  }
}
