/**
 * Integration route helpers.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { z } from '@hono/zod-openapi';

export type OAuthProvider =
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

export const WEBHOOK_PROVIDERS = ['linear', 'github'] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

export const ERROR_INVALID_WEBHOOK_PAYLOAD = 'Invalid webhook payload';
export const ERROR_UNSUPPORTED_WEBHOOK_PROVIDER = 'Unsupported webhook provider';

export const isOAuthProvider = (value: string): value is OAuthProvider =>
  OAUTH_PROVIDERS.includes(value as OAuthProvider);

export const isWebhookProvider = (value: string): value is WebhookProvider =>
  WEBHOOK_PROVIDERS.includes(value as WebhookProvider);

export const WebhookSignatureHeadersSchema = z.object({
  'x-linear-signature': z.string().optional(),
  'x-hub-signature-256': z.string().optional(),
  'x-webhook-signature': z.string().optional(),
});

export type WebhookSignatureHeaders = z.infer<typeof WebhookSignatureHeadersSchema>;

export function buildValidationError(field: string, message: string) {
  return {
    error: 'Validation error' as const,
    details: [{ field, message }],
  };
}

/**
 * Verify webhook signature for different providers.
 */
export function verifyWebhookSignature(
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
export function processIntegrationWebhook(
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
        throw new Error(ERROR_INVALID_WEBHOOK_PAYLOAD);
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
        throw new Error(ERROR_INVALID_WEBHOOK_PAYLOAD);
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

      throw new Error(ERROR_INVALID_WEBHOOK_PAYLOAD);
    }

    default:
      throw new Error(ERROR_UNSUPPORTED_WEBHOOK_PROVIDER);
  }
}
