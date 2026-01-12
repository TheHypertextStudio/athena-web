/**
 * Audit OpenAPI route definitions.
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

// =============================================================================
// List Audit Logs
// =============================================================================

export const listAuditLogs = createRoute({
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

// =============================================================================
// Get Entity Audit Logs
// =============================================================================

export const getEntityAuditLogs = createRoute({
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
