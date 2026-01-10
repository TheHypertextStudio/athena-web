/**
 * Integrations OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  IntegrationIdParamSchema,
  ProviderParamSchema,
  WebhookProviderParamSchema,
  MappingIdParamSchema,
  ExternalIdParamSchema,
  EntityMappingParamSchema,
  OAuthQuerySchema,
  ConnectIntegrationRequestSchema,
  CreateMappingRequestSchema,
  MarkSyncedRequestSchema,
  LinkedIntegrationsResponseSchema,
  LinkedIntegrationResponseSchema,
  OAuthAuthorizationResponseSchema,
  IntegrationMappingsResponseSchema,
  IntegrationMappingResponseSchema,
  MarkSyncedResponseSchema,
  WebhookResultSchema,
} from '@athena/types/openapi/integrations';
import {
  ErrorResponseSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';

// =============================================================================
// List Integrations
// =============================================================================

export const getIntegrations = createRoute({
  method: 'get',
  path: '/',
  tags: ['Integrations'],
  summary: 'List integrations',
  description: 'List all linked integrations for the authenticated user.',
  responses: {
    200: {
      description: 'Integrations retrieved successfully',
      content: {
        'application/json': {
          schema: LinkedIntegrationsResponseSchema,
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
// Get Integration
// =============================================================================

export const getIntegration = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Integrations'],
  summary: 'Get integration',
  description: 'Get a specific integration by ID.',
  request: {
    params: IntegrationIdParamSchema,
  },
  responses: {
    200: {
      description: 'Integration retrieved successfully',
      content: {
        'application/json': {
          schema: LinkedIntegrationResponseSchema,
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
    404: {
      description: 'Integration not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Connect Integration
// =============================================================================

export const connectIntegration = createRoute({
  method: 'post',
  path: '/connect',
  tags: ['Integrations'],
  summary: 'Connect integration',
  description: 'Connect a new integration.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: ConnectIntegrationRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Integration connected successfully',
      content: {
        'application/json': {
          schema: LinkedIntegrationResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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
    409: {
      description: 'Integration already exists for this provider',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Disconnect Integration
// =============================================================================

export const disconnectIntegration = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Integrations'],
  summary: 'Disconnect integration',
  description: 'Disconnect (remove) an integration.',
  request: {
    params: IntegrationIdParamSchema,
  },
  responses: {
    204: {
      description: 'Integration disconnected successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Integration not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get OAuth Authorization URL
// =============================================================================

export const getOAuthAuthorization = createRoute({
  method: 'get',
  path: '/oauth/{provider}/authorize',
  tags: ['Integrations'],
  summary: 'Get OAuth URL',
  description: 'Get OAuth authorization URL for a provider.',
  request: {
    params: ProviderParamSchema,
    query: OAuthQuerySchema,
  },
  responses: {
    200: {
      description: 'OAuth authorization URL retrieved',
      content: {
        'application/json': {
          schema: OAuthAuthorizationResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid provider or missing redirect_uri',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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
// Handle Webhook
// =============================================================================

export const handleWebhook = createRoute({
  method: 'post',
  path: '/webhooks/{provider}',
  tags: ['Integrations'],
  summary: 'Handle webhook',
  description: 'Handle incoming webhook from an integration provider.',
  request: {
    params: WebhookProviderParamSchema,
  },
  responses: {
    200: {
      description: 'Webhook processed successfully',
      content: {
        'application/json': {
          schema: WebhookResultSchema,
        },
      },
    },
    400: {
      description: 'Invalid webhook payload',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Invalid webhook signature',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Mappings
// =============================================================================

export const getMappings = createRoute({
  method: 'get',
  path: '/{id}/mappings',
  tags: ['Integrations'],
  summary: 'Get mappings',
  description: 'Get all mappings for an integration.',
  request: {
    params: IntegrationIdParamSchema,
  },
  responses: {
    200: {
      description: 'Mappings retrieved successfully',
      content: {
        'application/json': {
          schema: IntegrationMappingsResponseSchema,
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
    404: {
      description: 'Integration not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Mapping
// =============================================================================

export const createMapping = createRoute({
  method: 'post',
  path: '/{id}/mappings',
  tags: ['Integrations'],
  summary: 'Create mapping',
  description: 'Create a new mapping for an integration.',
  request: {
    params: IntegrationIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: CreateMappingRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Mapping created successfully',
      content: {
        'application/json': {
          schema: IntegrationMappingResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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
    404: {
      description: 'Integration not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Find Mapping by External ID
// =============================================================================

export const getMappingByExternalId = createRoute({
  method: 'get',
  path: '/{id}/mappings/by-external/{externalId}',
  tags: ['Integrations'],
  summary: 'Find mapping by external ID',
  description: 'Find a mapping by external ID.',
  request: {
    params: ExternalIdParamSchema,
  },
  responses: {
    200: {
      description: 'Mapping retrieved successfully',
      content: {
        'application/json': {
          schema: IntegrationMappingResponseSchema,
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
    404: {
      description: 'Mapping or integration not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Find Mapping by Local Entity
// =============================================================================

export const getMappingByEntity = createRoute({
  method: 'get',
  path: '/{id}/mappings/by-entity/{entityType}/{localEntityId}',
  tags: ['Integrations'],
  summary: 'Find mapping by local entity',
  description: 'Find a mapping by local entity type and ID.',
  request: {
    params: EntityMappingParamSchema,
  },
  responses: {
    200: {
      description: 'Mapping retrieved successfully',
      content: {
        'application/json': {
          schema: IntegrationMappingResponseSchema,
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
    404: {
      description: 'Mapping or integration not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Mapping
// =============================================================================

export const deleteMapping = createRoute({
  method: 'delete',
  path: '/{id}/mappings/{mappingId}',
  tags: ['Integrations'],
  summary: 'Delete mapping',
  description: 'Delete a mapping.',
  request: {
    params: MappingIdParamSchema,
  },
  responses: {
    204: {
      description: 'Mapping deleted successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Mapping or integration not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Mark Synced from External
// =============================================================================

export const markSyncedFromExternal = createRoute({
  method: 'post',
  path: '/{id}/mappings/{mappingId}/synced-from-external',
  tags: ['Integrations'],
  summary: 'Mark synced from external',
  description: 'Mark a mapping as synced from external.',
  request: {
    params: MappingIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: MarkSyncedRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Mapping marked as synced',
      content: {
        'application/json': {
          schema: MarkSyncedResponseSchema,
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
    404: {
      description: 'Mapping or integration not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Mark Synced to External
// =============================================================================

export const markSyncedToExternal = createRoute({
  method: 'post',
  path: '/{id}/mappings/{mappingId}/synced-to-external',
  tags: ['Integrations'],
  summary: 'Mark synced to external',
  description: 'Mark a mapping as synced to external.',
  request: {
    params: MappingIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: MarkSyncedRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Mapping marked as synced',
      content: {
        'application/json': {
          schema: MarkSyncedResponseSchema,
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
    404: {
      description: 'Mapping or integration not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
