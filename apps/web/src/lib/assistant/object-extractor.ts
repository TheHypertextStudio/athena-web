/**
 * Extract object references from tool call results.
 *
 * When the AI executes tools that create or return objects (tasks, events, etc.),
 * this module extracts structured ObjectReference data for rendering in the UI.
 *
 * @packageDocumentation
 */

import type { ObjectReference, ObjectType } from './types';

/**
 * Extract objects from a tool execution result.
 *
 * @param toolName - The name of the tool that was executed
 * @param result - The result returned by the tool
 * @returns Array of ObjectReference objects
 */
export function extractObjectsFromToolResult(toolName: string, result: unknown): ObjectReference[] {
  if (!result || typeof result !== 'object') {
    return [];
  }

  const extractor = EXTRACTORS[toolName];
  if (!extractor) {
    return [];
  }

  try {
    return extractor(result as Record<string, unknown>);
  } catch (error) {
    console.warn(`[object-extractor] Failed to extract objects from ${toolName}:`, error);
    return [];
  }
}

/**
 * Type for an extractor function.
 */
type Extractor = (result: Record<string, unknown>) => ObjectReference[];

/**
 * Extractors for each tool type.
 */
const EXTRACTORS: Record<string, Extractor> = {
  // ==========================================================================
  // Task Tools
  // ==========================================================================

  create_task: (result) => {
    if (result.success && result.taskId) {
      return [
        {
          type: 'task' as ObjectType,
          id: result.taskId as string,
          action: 'created',
          data: result,
        },
      ];
    }
    return [];
  },

  update_task: (result) => {
    if (result.success && result.taskId) {
      return [
        {
          type: 'task' as ObjectType,
          id: result.taskId as string,
          action: 'updated',
          data: result,
        },
      ];
    }
    return [];
  },

  complete_task: (result) => {
    if (result.success && result.taskId) {
      return [
        {
          type: 'task' as ObjectType,
          id: result.taskId as string,
          action: 'updated',
          data: result,
        },
      ];
    }
    return [];
  },

  list_tasks: (result) => {
    if (!Array.isArray(result.tasks)) {
      return [];
    }

    return (result.tasks as { id: string; [key: string]: unknown }[]).map((task) => ({
      type: 'task' as ObjectType,
      id: task.id,
      action: 'returned' as const,
      data: task,
    }));
  },

  search_tasks: (result) => {
    if (!Array.isArray(result.tasks)) {
      return [];
    }

    return (result.tasks as { id: string; [key: string]: unknown }[]).map((task) => ({
      type: 'task' as ObjectType,
      id: task.id,
      action: 'returned' as const,
      data: task,
    }));
  },

  // ==========================================================================
  // Event Tools
  // ==========================================================================

  create_event: (result) => {
    if (result.success && result.eventId) {
      return [
        {
          type: 'event' as ObjectType,
          id: result.eventId as string,
          action: 'created',
          data: result,
        },
      ];
    }
    return [];
  },

  list_events: (result) => {
    if (!Array.isArray(result.events)) {
      return [];
    }

    return (result.events as { id: string; [key: string]: unknown }[]).map((event) => ({
      type: 'event' as ObjectType,
      id: event.id,
      action: 'returned' as const,
      data: event,
    }));
  },

  // ==========================================================================
  // Project Tools
  // ==========================================================================

  list_projects: (result) => {
    if (!Array.isArray(result.projects)) {
      return [];
    }

    return (result.projects as { id: string; [key: string]: unknown }[]).map((project) => ({
      type: 'project' as ObjectType,
      id: project.id,
      action: 'returned' as const,
      data: project,
    }));
  },

  // ==========================================================================
  // Agenda Tool (combines tasks and events)
  // ==========================================================================

  get_agenda: (result) => {
    const objects: ObjectReference[] = [];

    // Extract tasks
    if (Array.isArray(result.tasks)) {
      for (const task of result.tasks as { id: string; [key: string]: unknown }[]) {
        objects.push({
          type: 'task',
          id: task.id,
          action: 'returned',
          data: task,
        });
      }
    }

    // Extract events
    if (Array.isArray(result.events)) {
      for (const event of result.events as { id: string; [key: string]: unknown }[]) {
        objects.push({
          type: 'event',
          id: event.id,
          action: 'returned',
          data: event,
        });
      }
    }

    return objects;
  },

  // ==========================================================================
  // Timer Tools (no objects returned)
  // ==========================================================================

  start_timer: () => [],
  stop_timer: () => [],
  get_timer_status: () => [],

  // ==========================================================================
  // Productivity Summary (no objects returned)
  // ==========================================================================

  get_productivity_summary: () => [],
};

/**
 * Check if a tool returns objects.
 *
 * @param toolName - The tool name to check
 * @returns true if the tool can return objects
 */
export function toolReturnsObjects(toolName: string): boolean {
  const objectReturningTools = [
    'create_task',
    'update_task',
    'complete_task',
    'list_tasks',
    'search_tasks',
    'create_event',
    'list_events',
    'list_projects',
    'get_agenda',
  ];

  return objectReturningTools.includes(toolName);
}

/**
 * Get the primary object type returned by a tool.
 *
 * @param toolName - The tool name
 * @returns The primary ObjectType or null
 */
export function getToolObjectType(toolName: string): ObjectType | null {
  const toolTypes: Record<string, ObjectType> = {
    create_task: 'task',
    update_task: 'task',
    complete_task: 'task',
    list_tasks: 'task',
    search_tasks: 'task',
    create_event: 'event',
    list_events: 'event',
    list_projects: 'project',
  };

  return toolTypes[toolName] ?? null;
}
