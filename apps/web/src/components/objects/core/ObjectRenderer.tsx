'use client';

/**
 * ObjectRenderer - Type to Component Mapping
 *
 * Maps object types to their visual representations.
 * Handles variant selection and passes context to renderers.
 */

import { type ComponentType, memo } from 'react';
import type {
  AnyObject,
  ObjectType,
  RenderVariant,
  RendererProps,
  TaskObject,
  EventObject,
  ProjectObject,
  InitiativeObject,
  MomentObject,
  ActivityObject,
} from '../types';
import { isTask, isEvent, isProject, isInitiative, isMoment, isActivity } from '../types';

// =============================================================================
// Types
// =============================================================================

interface ObjectRendererProps<T extends AnyObject = AnyObject> {
  object: T;
  variant?: RenderVariant;
  selected?: boolean;
  focused?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
}

// Renderer component types for each object type
type TaskRendererComponent = ComponentType<RendererProps<TaskObject>>;
type EventRendererComponent = ComponentType<RendererProps<EventObject>>;
type ProjectRendererComponent = ComponentType<RendererProps<ProjectObject>>;
type InitiativeRendererComponent = ComponentType<RendererProps<InitiativeObject>>;
type MomentRendererComponent = ComponentType<RendererProps<MomentObject>>;
type ActivityRendererComponent = ComponentType<RendererProps<ActivityObject>>;

interface RendererRegistry {
  task?: TaskRendererComponent;
  event?: EventRendererComponent;
  project?: ProjectRendererComponent;
  initiative?: InitiativeRendererComponent;
  moment?: MomentRendererComponent;
  activity?: ActivityRendererComponent;
}

// =============================================================================
// Default Renderers (Fallbacks)
// =============================================================================

function DefaultTaskRenderer({ object, variant }: RendererProps<TaskObject>) {
  const task = object.data;

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2 py-1">
        <input
          type="checkbox"
          checked={task.status === 'completed'}
          className="border-outline-variant h-4 w-4 rounded"
          readOnly
        />
        <span className={task.status === 'completed' ? 'text-on-surface-variant line-through' : ''}>
          {task.title}
        </span>
      </div>
    );
  }

  return (
    <div className="border-outline-variant bg-surface-container rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={task.status === 'completed'}
          className="border-outline-variant h-5 w-5 rounded"
          readOnly
        />
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-sm font-medium ${task.status === 'completed' ? 'text-on-surface-variant line-through' : ''}`}
          >
            {task.title}
          </p>
          <p className="text-on-surface-variant text-xs">{task.priority}</p>
        </div>
      </div>
    </div>
  );
}

function DefaultEventRenderer({ object, variant }: RendererProps<EventObject>) {
  const event = object.data;

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-sm">{event.title}</span>
      </div>
    );
  }

  return (
    <div className="border-primary-container bg-primary-container/50 rounded-lg border p-3">
      <p className="text-sm font-medium">{event.title}</p>
      {event.location && <p className="text-on-surface-variant text-xs">{event.location}</p>}
    </div>
  );
}

function DefaultProjectRenderer({ object, variant }: RendererProps<ProjectObject>) {
  const project = object.data;

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm">{project.name}</span>
      </div>
    );
  }

  return (
    <div className="border-outline-variant bg-surface-container rounded-lg border p-4">
      <h3 className="font-medium">{project.name}</h3>
      {project.description && (
        <p className="text-on-surface-variant mt-1 text-sm">{project.description}</p>
      )}
      <p className="text-on-surface-variant mt-2 text-xs">Status: {project.status}</p>
    </div>
  );
}

function DefaultInitiativeRenderer({ object, variant }: RendererProps<InitiativeObject>) {
  const initiative = object.data;

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm">{initiative.name}</span>
      </div>
    );
  }

  return (
    <div className="border-outline-variant bg-surface-container-high rounded-lg border p-4">
      <h3 className="font-medium">{initiative.name}</h3>
      {initiative.description && (
        <p className="text-on-surface-variant mt-1 text-sm">{initiative.description}</p>
      )}
    </div>
  );
}

function DefaultMomentRenderer({ object, variant }: RendererProps<MomentObject>) {
  const moment = object.data;

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm">{moment.label ?? 'Moment'}</span>
      </div>
    );
  }

  return (
    <div className="border-secondary-container bg-secondary-container/30 rounded-lg border p-3">
      <p className="text-sm font-medium">{moment.label ?? 'Moment'}</p>
      {moment.description && (
        <p className="text-on-surface-variant mt-1 text-xs">{moment.description}</p>
      )}
    </div>
  );
}

function DefaultActivityRenderer({ object, variant }: RendererProps<ActivityObject>) {
  const activity = object.data;

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm">{activity.type}</span>
      </div>
    );
  }

  return (
    <div className="border-outline-variant bg-surface-container rounded-lg border p-3">
      <p className="text-sm font-medium">{activity.type}</p>
      <p className="text-on-surface-variant text-xs">
        {activity.startTime.toLocaleTimeString()} - {activity.endTime.toLocaleTimeString()}
      </p>
    </div>
  );
}

// =============================================================================
// Registry & Component
// =============================================================================

// Global renderer registry with defaults
const rendererRegistry: Required<RendererRegistry> = {
  task: DefaultTaskRenderer,
  event: DefaultEventRenderer,
  project: DefaultProjectRenderer,
  initiative: DefaultInitiativeRenderer,
  moment: DefaultMomentRenderer,
  activity: DefaultActivityRenderer,
};

/**
 * Register a custom renderer for an object type.
 */
export function registerRenderer(type: ObjectType, renderer: ComponentType<RendererProps>): void {
  (rendererRegistry as Record<string, unknown>)[type] = renderer;
}

/**
 * ObjectRenderer Component
 *
 * Renders any object using the appropriate type-specific renderer.
 */
export const ObjectRenderer = memo(function ObjectRenderer({
  object,
  variant = 'normal',
  selected = false,
  focused = false,
  dragging = false,
  dropTarget = false,
}: ObjectRendererProps) {
  const props = {
    variant,
    selected,
    focused,
    dragging,
    dropTarget,
  };

  if (isTask(object)) {
    const Renderer = rendererRegistry.task;
    return <Renderer object={object} {...props} />;
  }

  if (isEvent(object)) {
    const Renderer = rendererRegistry.event;
    return <Renderer object={object} {...props} />;
  }

  if (isProject(object)) {
    const Renderer = rendererRegistry.project;
    return <Renderer object={object} {...props} />;
  }

  if (isInitiative(object)) {
    const Renderer = rendererRegistry.initiative;
    return <Renderer object={object} {...props} />;
  }

  if (isMoment(object)) {
    const Renderer = rendererRegistry.moment;
    return <Renderer object={object} {...props} />;
  }

  if (isActivity(object)) {
    const Renderer = rendererRegistry.activity;
    return <Renderer object={object} {...props} />;
  }

  // TypeScript exhaustiveness check - this should never be reached
  const _exhaustiveCheck: never = object;
  return _exhaustiveCheck;
});

// =============================================================================
// Variant-Specific Renderers
// =============================================================================

export function CompactRenderer({ object, ...props }: Omit<ObjectRendererProps, 'variant'>) {
  return <ObjectRenderer object={object} variant="compact" {...props} />;
}

export function ExpandedRenderer({ object, ...props }: Omit<ObjectRendererProps, 'variant'>) {
  return <ObjectRenderer object={object} variant="expanded" {...props} />;
}
