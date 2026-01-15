/**
 * Initiative status routes with OpenAPI documentation.
 *
 * @packageDocumentation
 */

import { createOpenAPIApp } from '../lib/openapi.js';
import { requireAuth } from '../middleware/auth.js';
import { createServiceContext } from '../lib/service.js';
import { InitiativeStatusService } from '../services/initiative-statuses/index.js';
import * as routes from './initiative-statuses.openapi.js';

const initiativeStatusRoutes = createOpenAPIApp();

// Apply auth middleware to all routes
initiativeStatusRoutes.use('*', requireAuth);

// List initiative statuses
initiativeStatusRoutes.openapi(routes.listInitiativeStatuses, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const query = c.req.valid('query');
  const statuses = await service.list(query.workspaceId, query.category);
  return c.json({ data: statuses }, 200);
});

// List initiative statuses grouped by category
initiativeStatusRoutes.openapi(routes.listInitiativeStatusesGrouped, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const query = c.req.valid('query');
  const grouped = await service.listGrouped(query.workspaceId);
  return c.json({ data: grouped }, 200);
});

// Get initiative status by ID
initiativeStatusRoutes.openapi(routes.getInitiativeStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const { id } = c.req.valid('param');
  const status = await service.get(id);
  return c.json({ data: status }, 200);
});

// Create initiative status
initiativeStatusRoutes.openapi(routes.createInitiativeStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const input = c.req.valid('json');
  const status = await service.create(input);
  return c.json({ data: status }, 201);
});

// Update initiative status
initiativeStatusRoutes.openapi(routes.updateInitiativeStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');
  const status = await service.update(id, input);
  return c.json({ data: status }, 200);
});

// Delete initiative status
initiativeStatusRoutes.openapi(routes.deleteInitiativeStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const { id } = c.req.valid('param');
  await service.delete(id);
  return c.body(null, 204);
});

// Reorder initiative statuses
initiativeStatusRoutes.openapi(routes.reorderInitiativeStatuses, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const input = c.req.valid('json');
  const statuses = await service.reorder(input);
  return c.json({ data: statuses }, 200);
});

// Set default status
initiativeStatusRoutes.openapi(routes.setDefaultStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');
  const status = await service.setAsDefault(id, input.workspaceId);
  return c.json({ data: status }, 200);
});

export { initiativeStatusRoutes };
