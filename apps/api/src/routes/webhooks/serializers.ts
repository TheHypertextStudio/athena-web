/**
 * Webhook route serializers.
 *
 * @packageDocumentation
 */

import { DeliveryStatusSchema, WebhookEventTypeSchema } from '@athena/types/openapi/webhooks';

interface WebhookEndpointRow {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  isActive: boolean;
  lastDeliveredAt: Date | null;
  failureCount: number;
  createdAt: Date;
}

export function toWebhookEndpoint(endpoint: WebhookEndpointRow) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: WebhookEventTypeSchema.array().parse(endpoint.events),
    description: endpoint.description,
    isActive: endpoint.isActive,
    lastDeliveredAt: endpoint.lastDeliveredAt ?? null,
    failureCount: endpoint.failureCount,
    createdAt: endpoint.createdAt,
  };
}

interface WebhookDeliveryRow {
  id: string;
  eventType: string;
  status: string;
  responseStatus: number | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: Date;
  deliveredAt: Date | null;
}

export function toWebhookDelivery(delivery: WebhookDeliveryRow) {
  return {
    id: delivery.id,
    eventType: WebhookEventTypeSchema.parse(delivery.eventType),
    status: DeliveryStatusSchema.parse(delivery.status),
    responseStatus: delivery.responseStatus,
    errorMessage: delivery.errorMessage,
    attempts: delivery.attempts,
    createdAt: delivery.createdAt,
    deliveredAt: delivery.deliveredAt ?? null,
  };
}
