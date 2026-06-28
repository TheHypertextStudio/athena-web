/**
 * Audit log routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  AuditEntityParamSchema,
  AuditQuerySchema,
  AuditEntityQuerySchema,
  AuditLogsResponseSchema,
} from '@athena/types/openapi/audit';
import { UnauthorizedErrorSchema } from '@athena/types/openapi/common';
import { getWebhookService } from '../services/webhooks/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { toAuditLog } from './audit/serializers.js';

const app = createOpenAPIApp();

app.use('*', requireAuth);

// =============================================================================
// OpenAPI Route Definitions
// =============================================================================

const listAuditLogs = createRoute({
  method: 'get',
  path: '/',
  tags: ['Audit'],
  summary: 'List audit logs',
  description: 'Get audit logs for the user.',
  request: {
    query: AuditQuerySchema,
  },
  responses: {
    200: {
      description: 'Audit logs retrieved successfully',
      content: {
        'application/json': {
          schema: AuditLogsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const getEntityAuditLogs = createRoute({
  method: 'get',
  path: '/entity/{type}/{id}',
  tags: ['Audit'],
  summary: 'Get entity audit logs',
  description: 'Get audit logs for a specific entity.',
  request: {
    params: AuditEntityParamSchema,
    query: AuditEntityQuerySchema,
  },
  responses: {
    200: {
      description: 'Audit logs retrieved successfully',
      content: {
        'application/json': {
          schema: AuditLogsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

/**
 * GET /audit
 * Get audit logs for the user.
 */
app.openapi(listAuditLogs, async (c) => {
  const userId = getUserId(c);
  const params = c.req.valid('query');

  const service = getWebhookService();
  const logs = await service.getAuditLogs({
    userId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    limit: params.limit,
    offset: params.offset,
  });

  return c.json({ data: logs.map(toAuditLog) }, 200);
});

/**
 * GET /audit/entity/:type/:id
 * Get audit logs for a specific entity.
 */
app.openapi(getEntityAuditLogs, async (c) => {
  const userId = getUserId(c);
  const { type: entityType, id: entityId } = c.req.valid('param');
  const { limit } = c.req.valid('query');

  const service = getWebhookService();
  const logs = await service.getAuditLogs({
    userId,
    entityType,
    entityId,
    limit,
  });

  return c.json({ data: logs.map(toAuditLog) }, 200);
});

export default app;
