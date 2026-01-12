/**
 * Audit OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema, PaginationQuerySchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const AuditActionSchema = z.enum(['create', 'update', 'delete']).openapi({
  description: 'Audit action type',
  example: 'create',
});

// =============================================================================
// Core Audit Schemas
// =============================================================================

export const AuditLogSchema = z
  .object({
    id: z.string().openapi({ description: 'Audit log ID' }),
    userId: z.uuid().openapi({ description: 'User ID' }),
    action: AuditActionSchema,
    entityType: z.string().openapi({ description: 'Entity type' }),
    entityId: z.string().openapi({ description: 'Entity ID' }),
    changes: z.record(z.string(), z.unknown()).nullable().openapi({ description: 'Changes made' }),
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({ description: 'Additional metadata' }),
    ipAddress: z.string().nullable().openapi({ description: 'IP address' }),
    userAgent: z.string().nullable().openapi({ description: 'User agent' }),
    createdAt: TimestampSchema.openapi({ description: 'Timestamp' }),
  })
  .openapi('AuditLog');

// =============================================================================
// Path Parameters
// =============================================================================

export const AuditEntityParamSchema = z
  .object({
    type: z.string().openapi({
      description: 'Entity type',
      param: { name: 'type', in: 'path' },
    }),
    id: z.string().openapi({
      description: 'Entity ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('AuditEntityParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const AuditQuerySchema = PaginationQuerySchema.extend({
  entityType: z
    .string()
    .optional()
    .openapi({
      description: 'Filter by entity type',
      param: { name: 'entityType', in: 'query' },
    }),
  entityId: z
    .uuid()
    .optional()
    .openapi({
      description: 'Filter by entity ID',
      param: { name: 'entityId', in: 'query' },
    }),
  action: AuditActionSchema.optional().openapi({
    description: 'Filter by action',
    param: { name: 'action', in: 'query' },
  }),
}).openapi('AuditQuery');

export const AuditEntityQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .openapi({
        description: 'Maximum results',
        param: { name: 'limit', in: 'query' },
      }),
  })
  .openapi('AuditEntityQuery');

// =============================================================================
// Response Schemas
// =============================================================================

export const AuditLogsResponseSchema = successResponseSchema(
  z.array(AuditLogSchema),
  'Audit logs',
).openapi('AuditLogsResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditLog = z.infer<typeof AuditLogSchema>;
