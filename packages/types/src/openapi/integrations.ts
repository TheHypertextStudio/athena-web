/**
 * Integrations OpenAPI schemas.
 *
 * These schemas define the API contract for integration endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const IntegrationProviderSchema = z
  .enum([
    'linear',
    'github',
    'todoist',
    'asana',
    'jira',
    'trello',
    'google_tasks',
    'microsoft_todo',
    'apple_reminders',
    'google_calendar',
    'outlook_calendar',
    'apple_calendar',
    'caldav_calendar',
    'slack',
    'zoom',
    'google_drive',
    'dropbox',
    'figma',
  ])
  .openapi({
    description: 'Integration provider',
    example: 'github',
  });

export const WebhookProviderSchema = z.enum(['linear', 'github']).openapi({
  description: 'Webhook-enabled provider',
  example: 'github',
});

export const EntityTypeSchema = z
  .enum(['task', 'project', 'event', 'initiative', 'activity'])
  .openapi({
  description: 'Entity type for mapping',
  example: 'task',
});

export const SyncDirectionSchema = z.enum(['pull', 'push', 'bidirectional']).openapi({
  description: 'Sync direction for mapping',
  example: 'bidirectional',
});

// =============================================================================
// Core Integration Schemas
// =============================================================================

export const LinkedIntegrationSchema = z
  .object({
    id: z.string().openapi({ description: 'Integration ID' }),
    provider: IntegrationProviderSchema,
    externalAccountId: z.string().openapi({ description: 'External account identifier' }),
    scopes: z.string().nullable().openapi({ description: 'OAuth scopes' }),
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({ description: 'Additional metadata' }),
    createdAt: TimestampSchema.openapi({ description: 'Connection timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('LinkedIntegration');

export const IntegrationMappingSchema = z
  .object({
    id: z.string().openapi({ description: 'Mapping ID' }),
    integrationId: z.string().openapi({ description: 'Integration ID' }),
    entityType: EntityTypeSchema,
    localEntityId: z.string().openapi({ description: 'Local entity ID' }),
    externalId: z.string().openapi({ description: 'External entity ID' }),
    syncDirection: SyncDirectionSchema,
    externalVersion: z.string().nullable().openapi({ description: 'External version/etag' }),
    lastSyncedFromExternal: TimestampSchema.nullable().openapi({
      description: 'Last sync from external',
    }),
    lastSyncedToExternal: TimestampSchema.nullable().openapi({
      description: 'Last sync to external',
    }),
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({ description: 'Mapping metadata' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('IntegrationMapping');

export const OAuthAuthorizationSchema = z
  .object({
    provider: IntegrationProviderSchema,
    authorizationUrl: z.string().openapi({ description: 'OAuth authorization URL' }),
    configured: z.boolean().openapi({ description: 'Whether provider is configured' }),
  })
  .openapi('OAuthAuthorization');

export const WebhookResultSchema = z
  .object({
    success: z.boolean(),
    processed: z.object({
      eventType: z.string().openapi({ description: 'Webhook event type' }),
      entityUpdated: z.boolean().optional().openapi({ description: 'Whether entity was updated' }),
    }),
  })
  .openapi('WebhookResult');

// =============================================================================
// Path Parameters
// =============================================================================

export const IntegrationIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Integration ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('IntegrationIdParam');

export const ProviderParamSchema = z
  .object({
    provider: z.string().min(1).openapi({
      description: 'Integration provider',
      param: { name: 'provider', in: 'path' },
    }),
  })
  .openapi('ProviderParam');

export const WebhookProviderParamSchema = z
  .object({
    provider: WebhookProviderSchema.openapi({
      param: { name: 'provider', in: 'path' },
    }),
  })
  .openapi('WebhookProviderParam');

export const MappingIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Integration ID',
      param: { name: 'id', in: 'path' },
    }),
    mappingId: z.string().openapi({
      description: 'Mapping ID',
      param: { name: 'mappingId', in: 'path' },
    }),
  })
  .openapi('MappingIdParam');

export const ExternalIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Integration ID',
      param: { name: 'id', in: 'path' },
    }),
    externalId: z.string().openapi({
      description: 'External entity ID',
      param: { name: 'externalId', in: 'path' },
    }),
  })
  .openapi('ExternalIdParam');

export const EntityMappingParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Integration ID',
      param: { name: 'id', in: 'path' },
    }),
    entityType: EntityTypeSchema.openapi({
      param: { name: 'entityType', in: 'path' },
    }),
    localEntityId: z.string().openapi({
      description: 'Local entity ID',
      param: { name: 'localEntityId', in: 'path' },
    }),
  })
  .openapi('EntityMappingParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const OAuthQuerySchema = z
  .object({
    redirect_uri: z.string().openapi({
      description: 'OAuth redirect URI',
      param: { name: 'redirect_uri', in: 'query' },
    }),
  })
  .openapi('OAuthQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const ConnectIntegrationRequestSchema = z
  .object({
    provider: IntegrationProviderSchema,
    externalAccountId: z.string().openapi({ description: 'External account identifier' }),
    accessToken: z.string().optional().openapi({ description: 'OAuth access token' }),
    refreshToken: z.string().optional().openapi({ description: 'OAuth refresh token' }),
    tokenExpiresAt: TimestampSchema.optional().openapi({ description: 'Token expiration' }),
    scopes: z.string().optional().openapi({ description: 'OAuth scopes' }),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ description: 'Additional metadata' }),
  })
  .openapi('ConnectIntegrationRequest');

export const CreateMappingRequestSchema = z
  .object({
    entityType: EntityTypeSchema,
    localEntityId: z.string().openapi({ description: 'Local entity ID' }),
    externalId: z.string().openapi({ description: 'External entity ID' }),
    syncDirection: SyncDirectionSchema.optional().default('bidirectional'),
    externalVersion: z.string().optional().openapi({ description: 'External version/etag' }),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ description: 'Mapping metadata' }),
  })
  .openapi('CreateMappingRequest');

export const MarkSyncedRequestSchema = z
  .object({
    externalVersion: z.string().optional().openapi({ description: 'External version/etag' }),
  })
  .openapi('MarkSyncedRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const LinkedIntegrationsResponseSchema = successResponseSchema(
  z.array(LinkedIntegrationSchema),
  'List of linked integrations',
).openapi('LinkedIntegrationsResponse');

export const LinkedIntegrationResponseSchema = successResponseSchema(
  LinkedIntegrationSchema,
  'Linked integration',
).openapi('LinkedIntegrationResponse');

export const OAuthAuthorizationResponseSchema = successResponseSchema(
  OAuthAuthorizationSchema,
  'OAuth authorization info',
).openapi('OAuthAuthorizationResponse');

export const IntegrationMappingsResponseSchema = successResponseSchema(
  z.array(IntegrationMappingSchema),
  'List of mappings',
).openapi('IntegrationMappingsResponse');

export const IntegrationMappingResponseSchema = successResponseSchema(
  IntegrationMappingSchema,
  'Integration mapping',
).openapi('IntegrationMappingResponse');

export const MarkSyncedResponseSchema = successResponseSchema(
  z.object({ success: z.literal(true) }),
  'Sync marked response',
).openapi('MarkSyncedResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;
export type WebhookProvider = z.infer<typeof WebhookProviderSchema>;
export type EntityType = z.infer<typeof EntityTypeSchema>;
export type SyncDirection = z.infer<typeof SyncDirectionSchema>;
export type LinkedIntegration = z.infer<typeof LinkedIntegrationSchema>;
export type IntegrationMapping = z.infer<typeof IntegrationMappingSchema>;
export type OAuthAuthorization = z.infer<typeof OAuthAuthorizationSchema>;
export type ConnectIntegrationRequest = z.infer<typeof ConnectIntegrationRequestSchema>;
export type CreateMappingRequest = z.infer<typeof CreateMappingRequestSchema>;
