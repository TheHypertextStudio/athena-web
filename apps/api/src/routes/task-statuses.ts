/**
 * Task status routes with OpenAPI documentation.
 *
 * @packageDocumentation
 */

import { createOpenAPIApp } from '../lib/openapi.js';
import { requireAuth } from '../middleware/auth.js';
import { createServiceContext } from '../lib/service.js';
import { TaskStatusService } from '../services/task-statuses/index.js';
import * as routes from './task-statuses.openapi.js';

const taskStatusRoutes = createOpenAPIApp();

// Apply auth middleware to all routes
taskStatusRoutes.use('*', requireAuth);

// List task statuses
taskStatusRoutes.openapi(routes.listTaskStatuses, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const query = c.req.valid('query');
  const statuses = await service.list(query.workspaceId, query.category);
  return c.json({ data: statuses }, 200);
});

// List task statuses grouped by category
taskStatusRoutes.openapi(routes.listTaskStatusesGrouped, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const query = c.req.valid('query');
  const grouped = await service.listGrouped(query.workspaceId);
  return c.json({ data: grouped }, 200);
});

// Get task status by ID
taskStatusRoutes.openapi(routes.getTaskStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const { id } = c.req.valid('param');
  const status = await service.get(id);
  return c.json({ data: status }, 200);
});

// Create task status
taskStatusRoutes.openapi(routes.createTaskStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const input = c.req.valid('json');
  const status = await service.create(input);
  return c.json({ data: status }, 201);
});

// Update task status
taskStatusRoutes.openapi(routes.updateTaskStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');
  const status = await service.update(id, input);
  return c.json({ data: status }, 200);
});

// Delete task status
taskStatusRoutes.openapi(routes.deleteTaskStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const { id } = c.req.valid('param');
  await service.delete(id);
  return c.body(null, 204);
});

// Reorder task statuses
taskStatusRoutes.openapi(routes.reorderTaskStatuses, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const input = c.req.valid('json');
  const statuses = await service.reorder(input);
  return c.json({ data: statuses }, 200);
});

// Set default status
taskStatusRoutes.openapi(routes.setDefaultStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');
  const status = await service.setAsDefault(id, input.workspaceId);
  return c.json({ data: status }, 200);
});

export { taskStatusRoutes };
