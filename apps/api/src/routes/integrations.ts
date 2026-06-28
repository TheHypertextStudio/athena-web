/**
 * Integration routes for managing third-party service connections.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { createRoute, z } from '@hono/zod-openapi';
import { eq, and } from 'drizzle-orm';
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
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';
import { db } from '../db/index.js';
import { linkedIntegrations } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { requireEntitlement } from '../middleware/entitlements.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { getMappingService } from '../services/sync/mapping-service.js';
import { env } from '../lib/env.js';
import {
  WebhookSignatureHeadersSchema,
  ERROR_INVALID_WEBHOOK_PAYLOAD,
  ERROR_UNSUPPORTED_WEBHOOK_PROVIDER,
  isOAuthProvider,
  processIntegrationWebhook,
  verifyWebhookSignature,
  type OAuthProvider,
} from './integrations/helpers.js';
import {
  toIntegrationMapping,
  toLinkedIntegration,
  toServiceSyncDirection,
} from './integrations/serializers.js';

const integrationRoutes = createOpenAPIApp();

// Require authentication for all routes
integrationRoutes.use('*', requireAuth);

// Require 'integrations' entitlement for mutating operations (POST/PUT/DELETE)
// GET requests pass through (read access is sacred)
integrationRoutes.use('*', requireEntitlement('integrations'));

const ERROR_INVALID_PROVIDER = 'Invalid provider';
const ERROR_INTEGRATION_NOT_FOUND = 'Integration not found';
const ERROR_INTEGRATION_EXISTS = 'Integration already exists for this provider';
const ERROR_INVALID_JSON_PAYLOAD = 'Invalid JSON payload';
const ERROR_INVALID_WEBHOOK_SIGNATURE = 'Invalid webhook signature';
const ERROR_WEBHOOK_PROCESSING_FAILED = 'Webhook processing failed';
const ERROR_MISSING_REDIRECT_URI = 'redirect_uri query parameter is required';
const ERROR_MAPPING_NOT_FOUND = 'Mapping not found';

const optionalOAuthQuerySchema = OAuthQuerySchema.partial();

// =============================================================================
// List Integrations
// =============================================================================

const getIntegrations = createRoute({
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

const getIntegration = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Connect Integration
// =============================================================================

const connectIntegration = createRoute({
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

const disconnectIntegration = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get OAuth Authorization URL
// =============================================================================

const getOAuthAuthorization = createRoute({
  method: 'get',
  path: '/oauth/{provider}/authorize',
  tags: ['Integrations'],
  summary: 'Get OAuth URL',
  description: 'Get OAuth authorization URL for a provider.',
  request: {
    params: ProviderParamSchema,
    query: optionalOAuthQuerySchema,
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
          schema: ErrorResponseSchema,
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

const handleWebhook = createRoute({
  method: 'post',
  path: '/webhooks/{provider}',
  tags: ['Integrations'],
  summary: 'Handle webhook',
  description: 'Handle incoming webhook from an integration provider.',
  request: {
    params: WebhookProviderParamSchema,
    headers: WebhookSignatureHeadersSchema,
    body: {
      content: {
        'application/json': {
          schema: z.unknown(),
        },
      },
    },
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
    500: {
      description: 'Webhook processing failed',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Mappings
// =============================================================================

const getMappings = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Mapping
// =============================================================================

const createMapping = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Find Mapping by External ID
// =============================================================================

const getMappingByExternalId = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Find Mapping by Local Entity
// =============================================================================

const getMappingByEntity = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Mapping
// =============================================================================

const deleteMapping = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Mark Synced from External
// =============================================================================

const markSyncedFromExternal = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Mark Synced to External
// =============================================================================

const markSyncedToExternal = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * List all linked integrations for the authenticated user.
 * GET /api/integrations
 */
integrationRoutes.openapi(getIntegrations, async (c) => {
  const userId = getUserId(c);

  const result = await db.query.linkedIntegrations.findMany({
    where: eq(linkedIntegrations.userId, userId),
    columns: {
      id: true,
      provider: true,
      externalAccountId: true,
      scopes: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return c.json({ data: result.map(toLinkedIntegration) }, 200);
});

/**
 * Get a specific integration by ID.
 * GET /api/integrations/:id
 */
integrationRoutes.openapi(getIntegration, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, id), eq(linkedIntegrations.userId, userId)),
    columns: {
      id: true,
      provider: true,
      externalAccountId: true,
      scopes: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!result) {
    return c.json({ error: ERROR_INTEGRATION_NOT_FOUND }, 404);
  }

  return c.json({ data: toLinkedIntegration(result) }, 200);
});

/**
 * Connect a new integration.
 * POST /api/integrations/connect
 *
 * Note: In production, this would initiate an OAuth flow.
 * For now, it accepts the integration details directly.
 */
integrationRoutes.openapi(connectIntegration, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  // Check if integration already exists for this provider
  const existing = await db.query.linkedIntegrations.findFirst({
    where: and(
      eq(linkedIntegrations.userId, userId),
      eq(linkedIntegrations.provider, body.provider),
    ),
  });

  if (existing) {
    return c.json(
      {
        error: ERROR_INTEGRATION_EXISTS,
      },
      409,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(linkedIntegrations).values({
    id,
    userId,
    provider: body.provider,
    externalAccountId: body.externalAccountId,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    tokenExpiresAt: body.tokenExpiresAt ?? null,
    scopes: body.scopes,
    metadata: body.metadata,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.linkedIntegrations.findFirst({
    where: eq(linkedIntegrations.id, id),
    columns: {
      id: true,
      provider: true,
      externalAccountId: true,
      scopes: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!result) {
    throw new Error('Integration not found after creation');
  }

  return c.json({ data: toLinkedIntegration(result) }, 201);
});

/**
 * Disconnect (remove) an integration.
 * DELETE /api/integrations/:id
 */
integrationRoutes.openapi(disconnectIntegration, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const existing = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, id), eq(linkedIntegrations.userId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_INTEGRATION_NOT_FOUND }, 404);
  }

  await db
    .delete(linkedIntegrations)
    .where(and(eq(linkedIntegrations.id, id), eq(linkedIntegrations.userId, userId)));

  return c.body(null, 204);
});

/**
 * Get OAuth authorization URL for a provider.
 * GET /api/integrations/oauth/:provider/authorize
 */
integrationRoutes.openapi(getOAuthAuthorization, (c) => {
  const { provider: providerParam } = c.req.valid('param');
  if (!isOAuthProvider(providerParam)) {
    return c.json({ error: ERROR_INVALID_PROVIDER }, 400);
  }
  const provider = providerParam;

  // Apple Calendar uses CalDAV, not OAuth - return empty URL
  if (provider === 'apple_calendar') {
    return c.json({
      data: {
        provider,
        authorizationUrl: '',
        configured: true,
      },
    }, 200);
  }

  const defaultRedirectUris: Record<
    Exclude<OAuthProvider, 'apple_calendar'>,
    string | undefined
  > = {
    linear: env.linearIntegration?.redirectUri,
    github: env.githubIntegration?.redirectUri,
    google_calendar: env.googleCalendar?.redirectUri,
    outlook_calendar: env.outlookCalendar?.redirectUri,
  };

  const { redirect_uri: redirectUriParam } = c.req.valid('query');
  const redirectUri = redirectUriParam ?? defaultRedirectUris[provider];
  if (!redirectUri) {
    return c.json(
      { error: ERROR_MISSING_REDIRECT_URI },
      400,
    );
  }

  // Get OAuth credentials from validated env config
  const clientIds: Record<Exclude<OAuthProvider, 'apple_calendar'>, string | undefined> = {
    linear: env.LINEAR_OAUTH_CLIENT_ID,
    github: env.GITHUB_OAUTH_CLIENT_ID,
    google_calendar: env.GOOGLE_CLIENT_ID,
    outlook_calendar: env.MICROSOFT_CLIENT_ID,
  };

  const clientId = clientIds[provider];

  if (!clientId) {
    return c.json(
      { error: `${provider} is not configured. Set the required environment variables.` },
      400,
    );
  }

  const authUrls: Record<Exclude<OAuthProvider, 'apple_calendar'>, string> = {
    linear: `https://linear.app/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read,write,issues:create`,
    github: `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,user`,
    google_calendar: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/calendar.readonly%20https://www.googleapis.com/auth/calendar.events&access_type=offline&prompt=consent`,
    outlook_calendar: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=Calendars.ReadWrite%20offline_access`,
  };

  const authUrl = authUrls[provider];

  return c.json({
    data: {
      provider,
      authorizationUrl: authUrl,
      configured: true,
    },
  }, 200);
});

/**
 * Handle incoming webhook from an integration provider.
 * POST /api/integrations/webhooks/:provider
 *
 * This endpoint receives webhooks from third-party services (Linear, GitHub, etc.)
 * and processes them to sync data with local entities.
 */
integrationRoutes.openapi(handleWebhook, async (c) => {
  const { provider } = c.req.valid('param');
  const headers = c.req.valid('header');
  const signature =
    headers['x-linear-signature'] ??
    headers['x-hub-signature-256'] ??
    headers['x-webhook-signature'];

  // Get the raw body for signature verification
  const rawBody = await c.req.raw.clone().text();
  let payload: unknown;

  try {
    payload = c.req.valid('json');
  } catch {
    return c.json({ error: ERROR_INVALID_JSON_PAYLOAD }, 400);
  }

  // Verify webhook signature based on provider
  const webhookSecrets: Record<string, string | undefined> = {
    linear: process.env.LINEAR_WEBHOOK_SECRET,
    github: process.env.GITHUB_WEBHOOK_SECRET,
  };

  const secret = webhookSecrets[provider];
  if (secret && signature) {
    const isValid = verifyWebhookSignature(provider, rawBody, signature, secret);
    if (!isValid) {
      return c.json({ error: 'Unauthorized', message: ERROR_INVALID_WEBHOOK_SIGNATURE }, 401);
    }
  }

  // Process the webhook based on provider
  try {
    const result = processIntegrationWebhook(provider, payload);
    return c.json({ success: true, processed: result }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status =
      message === ERROR_INVALID_WEBHOOK_PAYLOAD || message === ERROR_UNSUPPORTED_WEBHOOK_PROVIDER
        ? 400
        : 500;
    const errorMessage = status === 400 ? message : ERROR_WEBHOOK_PROCESSING_FAILED;
    console.error(`Failed to process ${provider} webhook:`, error);
    return c.json({ error: errorMessage }, status);
  }
});

// ============================================================================
// External ID Mapping Endpoints
// ============================================================================

/**
 * Get all mappings for an integration.
 * GET /api/integrations/:id/mappings
 */
integrationRoutes.openapi(getMappings, async (c) => {
  const userId = getUserId(c);
  const { id: integrationId } = c.req.valid('param');

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: ERROR_INTEGRATION_NOT_FOUND }, 404);
  }

  const mappingService = getMappingService();
  const mappings = await mappingService.getMappingsForIntegration(integrationId);
  const response = mappings.map((mapping) => toIntegrationMapping(mapping));

  return c.json({ data: response }, 200);
});

/**
 * Create a new mapping for an integration.
 * POST /api/integrations/:id/mappings
 */
integrationRoutes.openapi(createMapping, async (c) => {
  const userId = getUserId(c);
  const { id: integrationId } = c.req.valid('param');
  const body = c.req.valid('json');

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: ERROR_INTEGRATION_NOT_FOUND }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.getOrCreateMapping({
    integrationId,
    entityType: body.entityType,
    localEntityId: body.localEntityId,
    externalId: body.externalId,
    syncDirection: toServiceSyncDirection(body.syncDirection),
    externalVersion: body.externalVersion,
    metadata: body.metadata,
  });

  return c.json({ data: toIntegrationMapping(mapping) }, 201);
});

/**
 * Find mapping by external ID.
 * GET /api/integrations/:id/mappings/by-external/:externalId
 */
integrationRoutes.openapi(getMappingByExternalId, async (c) => {
  const userId = getUserId(c);
  const { id: integrationId, externalId } = c.req.valid('param');

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: ERROR_INTEGRATION_NOT_FOUND }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.findByExternalId(integrationId, externalId);

  if (!mapping) {
    return c.json({ error: ERROR_MAPPING_NOT_FOUND }, 404);
  }

  return c.json({ data: toIntegrationMapping(mapping) }, 200);
});

/**
 * Find mapping by local entity.
 * GET /api/integrations/:id/mappings/by-entity/:entityType/:localEntityId
 */
integrationRoutes.openapi(getMappingByEntity, async (c) => {
  const userId = getUserId(c);
  const { id: integrationId, entityType, localEntityId } = c.req.valid('param');

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: ERROR_INTEGRATION_NOT_FOUND }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.findByLocalEntity(integrationId, entityType, localEntityId);

  if (!mapping) {
    return c.json({ error: ERROR_MAPPING_NOT_FOUND }, 404);
  }

  return c.json({ data: toIntegrationMapping(mapping) }, 200);
});

/**
 * Delete a mapping.
 * DELETE /api/integrations/:id/mappings/:mappingId
 */
integrationRoutes.openapi(deleteMapping, async (c) => {
  const userId = getUserId(c);
  const { id: integrationId, mappingId } = c.req.valid('param');

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: ERROR_INTEGRATION_NOT_FOUND }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.getMappingById(mappingId);

  if (mapping?.integrationId !== integrationId) {
    return c.json({ error: ERROR_MAPPING_NOT_FOUND }, 404);
  }

  await mappingService.deleteMapping(mappingId);

  return c.body(null, 204);
});

/**
 * Mark a mapping as synced from external.
 * POST /api/integrations/:id/mappings/:mappingId/synced-from-external
 */
integrationRoutes.openapi(markSyncedFromExternal, async (c) => {
  const userId = getUserId(c);
  const { id: integrationId, mappingId } = c.req.valid('param');
  const body = c.req.valid('json');

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: ERROR_INTEGRATION_NOT_FOUND }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.getMappingById(mappingId);

  if (mapping?.integrationId !== integrationId) {
    return c.json({ error: ERROR_MAPPING_NOT_FOUND }, 404);
  }

  await mappingService.markSyncedFromExternal(mappingId, body.externalVersion);

  return c.json({ data: { success: true as const } }, 200);
});

/**
 * Mark a mapping as synced to external.
 * POST /api/integrations/:id/mappings/:mappingId/synced-to-external
 */
integrationRoutes.openapi(markSyncedToExternal, async (c) => {
  const userId = getUserId(c);
  const { id: integrationId, mappingId } = c.req.valid('param');
  const body = c.req.valid('json');

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: ERROR_INTEGRATION_NOT_FOUND }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.getMappingById(mappingId);

  if (mapping?.integrationId !== integrationId) {
    return c.json({ error: ERROR_MAPPING_NOT_FOUND }, 404);
  }

  await mappingService.markSyncedToExternal(mappingId, body.externalVersion);

  return c.json({ data: { success: true as const } }, 200);
});

export { integrationRoutes };
