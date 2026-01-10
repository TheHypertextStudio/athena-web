/**
 * Task routes with OpenAPI documentation.
 *
 * @packageDocumentation
 */

import { createOpenAPIApp } from '../lib/openapi.js';
import { requireAuth } from '../middleware/auth.js';
import { createServiceContext } from '../lib/service.js';
import { TaskService } from '../services/tasks/index.js';
import * as routes from './tasks.openapi.js';

const taskRoutes = createOpenAPIApp();

// Apply auth middleware to all routes
taskRoutes.use('*', requireAuth);

// List tasks
taskRoutes.openapi(routes.listTasks, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const query = c.req.valid('query');
  const tasks = await service.list(query);
  return c.json({ data: tasks }, 200);
});

// Get task by ID
taskRoutes.openapi(routes.getTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id } = c.req.valid('param');
  const task = await service.get(id);
  return c.json({ data: task }, 200);
});

// Create task
taskRoutes.openapi(routes.createTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const input = c.req.valid('json');
  const task = await service.create(input);
  return c.json({ data: task }, 201);
});

// Update task
taskRoutes.openapi(routes.updateTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');
  const task = await service.update(id, input);
  return c.json({ data: task }, 200);
});

// Delete task
taskRoutes.openapi(routes.deleteTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id } = c.req.valid('param');
  await service.delete(id);
  return c.body(null, 204);
});

// Add tag to task
taskRoutes.openapi(routes.addTagToTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id, tagId } = c.req.valid('param');
  await service.addTag(id, tagId);
  return c.body(null, 201);
});

// Remove tag from task
taskRoutes.openapi(routes.removeTagFromTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id, tagId } = c.req.valid('param');
  await service.removeTag(id, tagId);
  return c.body(null, 204);
});

// Get task dependencies
taskRoutes.openapi(routes.getTaskDependencies, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id } = c.req.valid('param');
  const dependencies = await service.getDependencies(id);
  return c.json({ data: dependencies }, 200);
});

// Add task dependency
taskRoutes.openapi(routes.addTaskDependency, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id, dependsOnId } = c.req.valid('param');
  await service.addDependency(id, dependsOnId);
  return c.body(null, 201);
});

// Remove task dependency
taskRoutes.openapi(routes.removeTaskDependency, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id, dependsOnId } = c.req.valid('param');
  await service.removeDependency(id, dependsOnId);
  return c.body(null, 204);
});

export { taskRoutes };
