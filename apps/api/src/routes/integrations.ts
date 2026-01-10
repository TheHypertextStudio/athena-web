/**
 * Integration routes for managing third-party service connections.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { linkedIntegrations } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { requireEntitlement } from '../middleware/entitlements.js';
import {
  getMappingService,
  type EntityType,
  type SyncDirection,
} from '../services/sync/mapping-service.js';
import { env } from '../lib/env.js';

const integrationRoutes = new Hono();

// Require authentication for all routes
integrationRoutes.use('*', requireAuth);

// Require 'integrations' entitlement for mutating operations (POST/PUT/DELETE)
// GET requests pass through (read access is sacred)
integrationRoutes.use('*', requireEntitlement('integrations'));

type OAuthProvider =
  | 'linear'
  | 'github'
  | 'google_calendar'
  | 'outlook_calendar'
  | 'apple_calendar';
const OAUTH_PROVIDERS: OAuthProvider[] = [
  'linear',
  'github',
  'google_calendar',
  'outlook_calendar',
  'apple_calendar',
];

const isOAuthProvider = (value: string): value is OAuthProvider =>
  OAUTH_PROVIDERS.includes(value as OAuthProvider);

const WEBHOOK_PROVIDERS = ['linear', 'github'] as const;
type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

const isWebhookProvider = (value: string): value is WebhookProvider =>
  WEBHOOK_PROVIDERS.includes(value as WebhookProvider);

/**
 * List all linked integrations for the authenticated user.
 * GET /api/integrations
 */
integrationRoutes.get('/', async (c) => {
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

  return c.json({ data: result });
});

/**
 * Get a specific integration by ID.
 * GET /api/integrations/:id
 */
integrationRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

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
    return c.json({ error: 'Integration not found' }, 404);
  }

  return c.json({ data: result });
});

/**
 * Connect a new integration.
 * POST /api/integrations/connect
 *
 * Note: In production, this would initiate an OAuth flow.
 * For now, it accepts the integration details directly.
 */
integrationRoutes.post('/connect', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    provider: 'linear' | 'github' | 'google_calendar' | 'outlook_calendar' | 'apple_calendar';
    externalAccountId: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: string;
    scopes?: string;
    metadata?: Record<string, unknown>;
  }>();

  // Check if integration already exists for this provider
  const existing = await db.query.linkedIntegrations.findFirst({
    where: and(
      eq(linkedIntegrations.userId, userId),
      eq(linkedIntegrations.provider, body.provider),
    ),
  });

  if (existing) {
    return c.json({ error: 'Integration already exists for this provider' }, 409);
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
    tokenExpiresAt: body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : null,
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
    },
  });

  return c.json({ data: result }, 201);
});

/**
 * Disconnect (remove) an integration.
 * DELETE /api/integrations/:id
 */
integrationRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const existing = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, id), eq(linkedIntegrations.userId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Integration not found' }, 404);
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
integrationRoutes.get('/oauth/:provider/authorize', (c) => {
  const providerParam = c.req.param('provider');
  if (!isOAuthProvider(providerParam)) {
    return c.json({ error: 'Invalid provider' }, 400);
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
    });
  }

  const redirectUri = c.req.query('redirect_uri');
  if (!redirectUri) {
    return c.json({ success: false, error: 'redirect_uri query parameter is required' }, 400);
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
      {
        success: false,
        error: `${provider} is not configured. Set the required environment variables.`,
      },
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
  });
});

/**
 * Handle incoming webhook from an integration provider.
 * POST /api/integrations/webhooks/:provider
 *
 * This endpoint receives webhooks from third-party services (Linear, GitHub, etc.)
 * and processes them to sync data with local entities.
 */
integrationRoutes.post('/webhooks/:provider', async (c) => {
  const providerParam = c.req.param('provider');
  if (!isWebhookProvider(providerParam)) {
    return c.json({ error: 'Invalid provider' }, 400);
  }
  const provider = providerParam;
  const signature =
    c.req.header('x-linear-signature') ??
    c.req.header('x-hub-signature-256') ??
    c.req.header('x-webhook-signature');

  // Get the raw body for signature verification
  const rawBody = await c.req.text();
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400);
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
      return c.json({ error: 'Invalid webhook signature' }, 401);
    }
  }

  // Process the webhook based on provider
  try {
    const result = processIntegrationWebhook(provider, payload);
    return c.json({ success: true, processed: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed';
    const status =
      message.startsWith('Invalid webhook payload') ||
      message.startsWith('Unsupported webhook provider')
        ? 400
        : 500;
    console.error(`Failed to process ${provider} webhook:`, error);
    return c.json({ error: message }, status);
  }
});

/**
 * Verify webhook signature for different providers.
 */
function verifyWebhookSignature(
  provider: string,
  payload: string,
  signature: string,
  secret: string,
): boolean {
  switch (provider) {
    case 'linear': {
      // Linear uses HMAC-SHA256
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payload);
      const expectedSignature = hmac.digest('hex');
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    }
    case 'github': {
      // GitHub uses sha256=<signature>
      if (!signature.startsWith('sha256=')) return false;
      const sig = signature.slice(7);
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payload);
      const expectedSignature = hmac.digest('hex');
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSignature));
    }
    default:
      return true; // Unknown provider, skip verification
  }
}

/**
 * Process incoming webhook from an integration provider.
 */
function processIntegrationWebhook(
  provider: WebhookProvider,
  payload: unknown,
): { eventType: string; entityUpdated?: boolean } {
  switch (provider) {
    case 'linear': {
      const data = payload as {
        type?: string;
        action?: string;
        data?: { id?: string; title?: string; state?: { name?: string } };
        organizationId?: string;
      };

      if (!data.type || !data.action) {
        throw new Error('Invalid webhook payload: missing type or action');
      }
      const eventType = `${data.type}.${data.action}`;

      if (data.type === 'Issue' && data.data?.id) {
        // Find the mapping for this external issue
        // We'd need to iterate through all integrations to find the matching one
        // For now, just log and return
        console.log(`Linear webhook: ${eventType} for issue ${data.data.id}`);

        // In a full implementation, we would:
        // 1. Find the integration that owns this issue (by organizationId)
        // 2. Look up the mapping to find the local task
        // 3. Update the local task with the new data
        // 4. Mark the mapping as synced

        return { eventType, entityUpdated: false };
      }

      return { eventType };
    }

    case 'github': {
      const data = payload as {
        action?: string;
        issue?: { id?: number; title?: string; state?: string };
        pull_request?: { id?: number; title?: string; state?: string };
        repository?: { full_name?: string };
      };

      if (!data.action) {
        throw new Error('Invalid webhook payload: missing action');
      }

      if (data.issue) {
        const eventType = `issue.${data.action}`;
        const issueId = String(data.issue.id ?? 'unknown');
        console.log(`GitHub webhook: ${eventType} for issue ${issueId}`);
        return { eventType };
      }

      if (data.pull_request) {
        const eventType = `pull_request.${data.action}`;
        const prId = String(data.pull_request.id ?? 'unknown');
        console.log(`GitHub webhook: ${eventType} for PR ${prId}`);
        return { eventType };
      }

      throw new Error('Invalid webhook payload: missing issue or pull_request');
    }

    default:
      throw new Error('Unsupported webhook provider');
  }
}

// ============================================================================
// External ID Mapping Endpoints
// ============================================================================

/**
 * Get all mappings for an integration.
 * GET /api/integrations/:id/mappings
 */
integrationRoutes.get('/:id/mappings', async (c) => {
  const userId = getUserId(c);
  const integrationId = c.req.param('id');

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  const mappingService = getMappingService();
  const mappings = await mappingService.getMappingsForIntegration(integrationId);

  return c.json({ data: mappings });
});

/**
 * Create a new mapping for an integration.
 * POST /api/integrations/:id/mappings
 */
integrationRoutes.post('/:id/mappings', async (c) => {
  const userId = getUserId(c);
  const integrationId = c.req.param('id');
  const body = await c.req.json<{
    entityType: EntityType;
    localEntityId: string;
    externalId: string;
    syncDirection?: SyncDirection;
    externalVersion?: string;
    metadata?: Record<string, unknown>;
  }>();

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.getOrCreateMapping({
    integrationId,
    entityType: body.entityType,
    localEntityId: body.localEntityId,
    externalId: body.externalId,
    syncDirection: body.syncDirection,
    externalVersion: body.externalVersion,
    metadata: body.metadata,
  });

  return c.json({ data: mapping }, 201);
});

/**
 * Find mapping by external ID.
 * GET /api/integrations/:id/mappings/by-external/:externalId
 */
integrationRoutes.get('/:id/mappings/by-external/:externalId', async (c) => {
  const userId = getUserId(c);
  const integrationId = c.req.param('id');
  const externalId = c.req.param('externalId');

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.findByExternalId(integrationId, externalId);

  if (!mapping) {
    return c.json({ error: 'Mapping not found' }, 404);
  }

  return c.json({ data: mapping });
});

/**
 * Find mapping by local entity.
 * GET /api/integrations/:id/mappings/by-entity/:entityType/:localEntityId
 */
integrationRoutes.get('/:id/mappings/by-entity/:entityType/:localEntityId', async (c) => {
  const userId = getUserId(c);
  const integrationId = c.req.param('id');
  const entityType = c.req.param('entityType') as EntityType;
  const localEntityId = c.req.param('localEntityId');

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.findByLocalEntity(integrationId, entityType, localEntityId);

  if (!mapping) {
    return c.json({ error: 'Mapping not found' }, 404);
  }

  return c.json({ data: mapping });
});

/**
 * Delete a mapping.
 * DELETE /api/integrations/:id/mappings/:mappingId
 */
integrationRoutes.delete('/:id/mappings/:mappingId', async (c) => {
  const userId = getUserId(c);
  const integrationId = c.req.param('id');
  const mappingId = c.req.param('mappingId');

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.getMappingById(mappingId);

  if (mapping?.integrationId !== integrationId) {
    return c.json({ error: 'Mapping not found' }, 404);
  }

  await mappingService.deleteMapping(mappingId);

  return c.body(null, 204);
});

/**
 * Mark a mapping as synced from external.
 * POST /api/integrations/:id/mappings/:mappingId/synced-from-external
 */
integrationRoutes.post('/:id/mappings/:mappingId/synced-from-external', async (c) => {
  const userId = getUserId(c);
  const integrationId = c.req.param('id');
  const mappingId = c.req.param('mappingId');
  const body = await c.req.json<{ externalVersion?: string }>();

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.getMappingById(mappingId);

  if (mapping?.integrationId !== integrationId) {
    return c.json({ error: 'Mapping not found' }, 404);
  }

  await mappingService.markSyncedFromExternal(mappingId, body.externalVersion);

  return c.json({ data: { success: true } });
});

/**
 * Mark a mapping as synced to external.
 * POST /api/integrations/:id/mappings/:mappingId/synced-to-external
 */
integrationRoutes.post('/:id/mappings/:mappingId/synced-to-external', async (c) => {
  const userId = getUserId(c);
  const integrationId = c.req.param('id');
  const mappingId = c.req.param('mappingId');
  const body = await c.req.json<{ externalVersion?: string }>();

  // Verify integration belongs to user
  const integration = await db.query.linkedIntegrations.findFirst({
    where: and(eq(linkedIntegrations.id, integrationId), eq(linkedIntegrations.userId, userId)),
  });

  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  const mappingService = getMappingService();
  const mapping = await mappingService.getMappingById(mappingId);

  if (mapping?.integrationId !== integrationId) {
    return c.json({ error: 'Mapping not found' }, 404);
  }

  await mappingService.markSyncedToExternal(mappingId, body.externalVersion);

  return c.json({ data: { success: true } });
});

export { integrationRoutes };
