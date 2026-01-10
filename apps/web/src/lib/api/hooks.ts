/**
 * React Query hooks for type-safe API access.
 *
 * These hooks wrap the openapi-fetch client with React Query
 * for caching, deduplication, and optimistic updates.
 *
 * @packageDocumentation
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';
import type { components } from './types.js';

// =============================================================================
// Type Aliases
// =============================================================================

export type Task = components['schemas']['Task'];
export type TaskWithRelations = components['schemas']['TaskWithRelations'];
export type CreateTaskRequest = components['schemas']['CreateTaskRequest'];
export type UpdateTaskRequest = components['schemas']['UpdateTaskRequest'];

export type TaskStatus = Task['status'];
export type TaskPriority = Task['priority'];

// =============================================================================
// Query Keys
// =============================================================================

export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (filters?: TaskListFilters) => [...taskKeys.lists(), filters] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
  dependencies: (id: string) => [...taskKeys.detail(id), 'dependencies'] as const,
};

// =============================================================================
// Task Hooks
// =============================================================================

export interface TaskListFilters {
  projectId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  limit?: number;
  offset?: number;
}

/**
 * Fetch a list of tasks with optional filtering.
 */
export function useTasks(filters?: TaskListFilters) {
  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: async () => {
      const { data, error } = await api.GET('/api/tasks/', {
        params: { query: filters },
      });
      if (error) {
        throw new Error('message' in error ? error.message : 'Failed to fetch tasks');
      }
      return data;
    },
  });
}

/**
 * Fetch a single task by ID.
 */
export function useTask(id: string) {
  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await api.GET('/api/tasks/{id}', {
        params: { path: { id } },
      });
      if (error) {
        throw new Error('message' in error ? error.message : 'Failed to fetch task');
      }
      return data;
    },
    enabled: !!id,
  });
}

/**
 * Fetch task dependencies.
 */
export function useTaskDependencies(taskId: string) {
  return useQuery({
    queryKey: taskKeys.dependencies(taskId),
    queryFn: async () => {
      const { data, error } = await api.GET('/api/tasks/{id}/dependencies', {
        params: { path: { id: taskId } },
      });
      if (error) {
        throw new Error('message' in error ? error.message : 'Failed to fetch dependencies');
      }
      return data;
    },
    enabled: !!taskId,
  });
}

/**
 * Create a new task.
 */
export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (task: CreateTaskRequest) => {
      const { data, error } = await api.POST('/api/tasks/', {
        body: task,
      });
      if (error) {
        throw new Error('message' in error ? error.message : 'Failed to create task');
      }
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

/**
 * Update an existing task.
 */
export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...update }: UpdateTaskRequest & { id: string }) => {
      const { data, error } = await api.PATCH('/api/tasks/{id}', {
        params: { path: { id } },
        body: update,
      });
      if (error) {
        throw new Error('message' in error ? error.message : 'Failed to update task');
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(taskKeys.detail(data.data.id), data);
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

/**
 * Delete a task.
 */
export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE('/api/tasks/{id}', {
        params: { path: { id } },
      });
      if (error) {
        throw new Error('message' in error ? error.message : 'Failed to delete task');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: taskKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

/**
 * Add a tag to a task.
 */
export function useAddTaskTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, tagId }: { taskId: string; tagId: string }) => {
      const { error } = await api.POST('/api/tasks/{id}/tags/{tagId}', {
        params: { path: { id: taskId, tagId } },
      });
      if (error) {
        throw new Error('message' in error ? error.message : 'Failed to add tag');
      }
    },
    onSuccess: (_data, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

/**
 * Remove a tag from a task.
 */
export function useRemoveTaskTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, tagId }: { taskId: string; tagId: string }) => {
      const { error } = await api.DELETE('/api/tasks/{id}/tags/{tagId}', {
        params: { path: { id: taskId, tagId } },
      });
      if (error) {
        throw new Error('message' in error ? error.message : 'Failed to remove tag');
      }
    },
    onSuccess: (_data, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

/**
 * Add a dependency to a task.
 */
export function useAddTaskDependency() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, dependsOnId }: { taskId: string; dependsOnId: string }) => {
      const { error } = await api.POST('/api/tasks/{id}/dependencies/{dependsOnId}', {
        params: { path: { id: taskId, dependsOnId } },
      });
      if (error) {
        throw new Error('message' in error ? error.message : 'Failed to add dependency');
      }
    },
    onSuccess: (_data, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.dependencies(taskId) });
    },
  });
}

/**
 * Remove a dependency from a task.
 */
export function useRemoveTaskDependency() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, dependsOnId }: { taskId: string; dependsOnId: string }) => {
      const { error } = await api.DELETE('/api/tasks/{id}/dependencies/{dependsOnId}', {
        params: { path: { id: taskId, dependsOnId } },
      });
      if (error) {
        throw new Error('message' in error ? error.message : 'Failed to remove dependency');
      }
    },
    onSuccess: (_data, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.dependencies(taskId) });
    },
  });
}
