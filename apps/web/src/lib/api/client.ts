/**
 * Type-safe API client using openapi-fetch.
 *
 * This client is generated from the OpenAPI spec and provides
 * full type safety for all API requests and responses.
 *
 * @packageDocumentation
 */

import createClient from 'openapi-fetch';
import type { paths } from './types.js';
import { env } from '../env.js';

/**
 * Type-safe API client.
 *
 * @example
 * ```typescript
 * // List tasks
 * const { data, error } = await api.GET('/api/tasks/', {
 *   params: { query: { status: 'pending', limit: 10 } }
 * });
 *
 * // Create task
 * const { data, error } = await api.POST('/api/tasks/', {
 *   body: { title: 'New task', priority: 'high' }
 * });
 *
 * // Update task
 * const { data, error } = await api.PATCH('/api/tasks/{id}', {
 *   params: { path: { id: 'task-uuid' } },
 *   body: { status: 'completed' }
 * });
 * ```
 */
export const api = createClient<paths>({
  baseUrl: env.API_URL,
  credentials: 'include',
});

/**
 * Re-export types for convenience.
 */
export type { paths, components } from './types.js';
