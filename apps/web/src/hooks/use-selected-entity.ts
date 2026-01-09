/**
 * Selected entity state management.
 *
 * This hook provides global state for tracking which entity (task, project,
 * event, etc.) is currently selected or being viewed. The command palette
 * uses this to enable context-aware actions like "Edit Task" or "Delete Project".
 *
 * ## How Entity Selection Works
 *
 * Unlike route-based detection (which guesses from URL patterns), this system
 * uses explicit selection. Pages call `setEntity()` when they load an entity,
 * and `clearEntity()` when unmounting. This gives us reliable, typed entity data.
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    Entity Selection Flow                        │
 * │                                                                 │
 * │  User navigates to /tasks/123                                   │
 * │           │                                                     │
 * │           ▼                                                     │
 * │  TaskPage fetches task data                                     │
 * │           │                                                     │
 * │           ▼                                                     │
 * │  TaskPage calls setEntity({ type: 'task', id: '123', data })    │
 * │           │                                                     │
 * │           ▼                                                     │
 * │  CommandPalette sees entity.type === 'task'                     │
 * │           │                                                     │
 * │           ▼                                                     │
 * │  "Edit Task", "Delete Task" actions become available            │
 * │           │                                                     │
 * │           ▼                                                     │
 * │  User navigates away, TaskPage unmounts                         │
 * │           │                                                     │
 * │           ▼                                                     │
 * │  TaskPage calls clearEntity()                                   │
 * │           │                                                     │
 * │           ▼                                                     │
 * │  Entity-specific actions are hidden again                       │
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Usage in Page Components
 *
 * ```typescript
 * // In apps/web/src/app/(protected)/tasks/[id]/page.tsx
 * 'use client';
 *
 * import { useSelectedEntity } from '@/hooks/use-selected-entity';
 * import { useQuery } from '@tanstack/react-query';
 * import { useEffect } from 'react';
 *
 * export default function TaskPage({ params }: { params: { id: string } }) {
 *   const { setEntity, clearEntity } = useSelectedEntity();
 *
 *   const { data: task } = useQuery({
 *     queryKey: ['tasks', params.id],
 *     queryFn: () => tasksApi.get(params.id),
 *   });
 *
 *   // Set entity when data loads
 *   useEffect(() => {
 *     if (task) {
 *       setEntity({ type: 'task', id: task.id, data: task });
 *     }
 *     // Clear on unmount
 *     return () => clearEntity();
 *   }, [task, setEntity, clearEntity]);
 *
 *   // ... render
 * }
 * ```
 *
 * ## Usage in Command Palette Actions
 *
 * ```typescript
 * const editTaskAction: ExecutableAction = {
 *   id: 'edit-task',
 *   label: 'Edit Task',
 *   // Only show when viewing a task
 *   isAvailable: (ctx) => ctx.entity?.type === 'task',
 *   // Pre-fill form from entity data
 *   form: (ctx) => ({
 *     fields: [{
 *       name: 'title',
 *       defaultValue: (ctx.entity?.data as Task)?.title,
 *       // ...
 *     }],
 *   }),
 *   execute: async ({ context }) => {
 *     const taskId = context.entity!.id;
 *     // ... update task
 *   },
 * };
 * ```
 *
 * @packageDocumentation
 */

import { create } from 'zustand';
import type { SelectedEntity } from '@/lib/command-palette/types';

/**
 * Internal store state and actions for entity selection.
 *
 * This interface defines the shape of the Zustand store. It includes both
 * the state (the currently selected entity) and the actions to modify it.
 */
interface EntityStore {
  /**
   * The currently selected entity, or null if none.
   *
   * When a page displays an entity (task, project, etc.), it sets this value.
   * The command palette reads this to determine which context-aware actions
   * to show.
   */
  entity: SelectedEntity | null;

  /**
   * Set the currently selected entity.
   *
   * Called by page components when they load entity data. The entity includes
   * the type (for action filtering), ID (for API calls), and full data (for
   * pre-filling forms).
   *
   * @param entity - The entity to select
   */
  setEntity: (entity: SelectedEntity) => void;

  /**
   * Clear the selected entity.
   *
   * Called when navigating away from an entity page, or when the entity is
   * deleted. This ensures stale entity data doesn't affect action availability.
   */
  clearEntity: () => void;
}

/**
 * Zustand store for entity selection state.
 *
 * This is the internal store - use `useSelectedEntity()` hook to access it.
 * The store is intentionally not persisted to localStorage because entity
 * selection should be transient (based on current page, not remembered).
 */
const useEntityStore = create<EntityStore>((set) => ({
  entity: null,

  setEntity: (entity) => {
    set({ entity });
  },

  clearEntity: () => {
    set({ entity: null });
  },
}));

/**
 * Hook to access and modify the selected entity.
 *
 * Returns the current entity (if any) and functions to set/clear it.
 * Components that display entities should call `setEntity` on mount
 * and `clearEntity` on unmount.
 *
 * @returns Object with entity state and control functions
 *
 * @example
 * // Reading the selected entity
 * function ActionDisplay() {
 *   const { entity } = useSelectedEntity();
 *
 *   if (!entity) {
 *     return <div>No entity selected</div>;
 *   }
 *
 *   return <div>Viewing {entity.type}: {entity.id}</div>;
 * }
 *
 * @example
 * // Setting entity in a page component
 * function ProjectPage({ projectId }: { projectId: string }) {
 *   const { setEntity, clearEntity } = useSelectedEntity();
 *   const { data: project } = useQuery(['projects', projectId]);
 *
 *   useEffect(() => {
 *     if (project) {
 *       setEntity({ type: 'project', id: project.id, data: project });
 *     }
 *     return () => clearEntity();
 *   }, [project, setEntity, clearEntity]);
 *
 *   // ...
 * }
 */
export function useSelectedEntity(): EntityStore {
  const entity = useEntityStore((s) => s.entity);
  const setEntity = useEntityStore((s) => s.setEntity);
  const clearEntity = useEntityStore((s) => s.clearEntity);
  return { entity, setEntity, clearEntity };
}

/**
 * Direct access to get entity state outside of React components.
 *
 * Use this for synchronous access in non-React code, such as:
 * - Action execution functions
 * - Middleware or interceptors
 * - Utility functions
 *
 * For React components, always prefer the `useSelectedEntity()` hook
 * to get proper reactivity.
 *
 * @returns Current entity state snapshot
 *
 * @example
 * // In an action execute function
 * execute: async ({ context }) => {
 *   // context.entity comes from CommandContext, but you could also:
 *   const { entity } = getEntityState();
 *   if (entity?.type !== 'task') {
 *     return { success: false, message: 'No task selected' };
 *   }
 *   // ...
 * }
 */
export function getEntityState(): Pick<EntityStore, 'entity'> {
  return {
    entity: useEntityStore.getState().entity,
  };
}
