/**
 * OpenAPI factory and Scalar documentation setup.
 *
 * This module provides utilities for creating type-safe OpenAPI routes
 * and generating interactive API documentation.
 *
 * @packageDocumentation
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';

/**
 * Environment type for Hono context variables.
 *
 * This ensures type safety when accessing context variables
 * like `c.get('userId')` or `c.var.userId`.
 */
export interface AppEnv {
  Variables: {
    /** Authenticated user's ID (set by requireAuth middleware) */
    userId: string;
    /** Full user object (optional, set by middleware when needed) */
    user?: {
      id: string;
      email: string;
      name: string | null;
    };
    /** Request ID for tracing */
    requestId?: string;
  };
}

/**
 * Create a new OpenAPIHono app instance with typed environment.
 *
 * Use this instead of `new Hono()` for routes that need OpenAPI definitions.
 *
 * @example
 * ```typescript
 * import { createOpenAPIApp } from '../lib/openapi.js';
 * import { createRoute } from '@hono/zod-openapi';
 *
 * const taskRoutes = createOpenAPIApp();
 *
 * const listTasks = createRoute({
 *   method: 'get',
 *   path: '/',
 *   tags: ['Tasks'],
 *   responses: { 200: { ... } },
 * });
 *
 * taskRoutes.openapi(listTasks, async (c) => {
 *   const userId = c.var.userId; // Type-safe access
 *   // ...
 * });
 * ```
 */
export function createOpenAPIApp() {
  return new OpenAPIHono<AppEnv>();
}

/**
 * OpenAPI document configuration.
 */
export interface OpenAPIDocConfig {
  /** API title */
  title?: string;
  /** API version */
  version?: string;
  /** API description */
  description?: string;
  /** Server URLs */
  servers?: { url: string; description?: string }[];
}

/**
 * Setup OpenAPI documentation endpoints on an app.
 *
 * This adds:
 * - `/api/openapi.json` - Raw OpenAPI spec
 * - `/api/docs` - Scalar interactive documentation
 *
 * @param app - The OpenAPIHono app instance
 * @param config - Optional configuration overrides
 *
 * @example
 * ```typescript
 * import { OpenAPIHono } from '@hono/zod-openapi';
 * import { setupOpenAPIDocs } from './lib/openapi.js';
 *
 * const app = new OpenAPIHono();
 * // ... mount routes
 * setupOpenAPIDocs(app);
 * ```
 */
export function setupOpenAPIDocs(app: OpenAPIHono<AppEnv>, config: OpenAPIDocConfig = {}) {
  const {
    title = 'Athena API',
    version = '1.0.0',
    description = 'REST API for Project Athena - Personal productivity and task management',
    servers,
  } = config;

  // Generate OpenAPI spec
  app.doc('/api/openapi.json', {
    openapi: '3.1.0',
    info: {
      title,
      version,
      description,
    },
    servers,
    tags: [
      { name: 'Auth', description: 'Authentication and session management' },
      { name: 'Tasks', description: 'Task management' },
      { name: 'Projects', description: 'Project management' },
      { name: 'Events', description: 'Calendar events and scheduling' },
      { name: 'Initiatives', description: 'High-level initiative tracking' },
      { name: 'Time Blocks', description: 'Time block scheduling' },
      { name: 'Tags', description: 'Tag management' },
      { name: 'Settings', description: 'User settings and preferences' },
      { name: 'Account', description: 'Account management' },
      { name: 'Billing', description: 'Subscription and billing' },
      { name: 'Integrations', description: 'Third-party integrations' },
      { name: 'Notifications', description: 'Push notifications' },
      { name: 'AI', description: 'AI-powered features' },
    ],
  });

  // Scalar interactive documentation
  app.get(
    '/api/docs',
    Scalar({
      url: '/api/openapi.json',
      theme: 'kepler',
      layout: 'modern',
      defaultHttpClient: {
        targetKey: 'js',
        clientKey: 'fetch',
      },
      showSidebar: true,
      searchHotKey: 'k',
    }),
  );
}

/**
 * Type helper for extracting validated request data.
 *
 * Use this to type the validated data from `c.req.valid()`.
 */
export type ValidatedData<T> = T extends { request: infer R }
  ? R extends { body: { content: { 'application/json': { schema: infer S } } } }
    ? S extends { _output: infer O }
      ? O
      : never
    : never
  : never;
