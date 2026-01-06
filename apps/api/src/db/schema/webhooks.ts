/**
 * Webhooks and audit logging schema.
 *
 * @packageDocumentation
 */

import {
  pgTable,
  text,
  timestamp,
  index,
  boolean,
  integer,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth.js';

/**
 * Webhook event types.
 */
export const webhookEventTypeEnum = pgEnum('webhook_event_type', [
  'task.created',
  'task.updated',
  'task.deleted',
  'task.completed',
  'project.created',
  'project.updated',
  'project.deleted',
  'event.created',
  'event.updated',
  'event.deleted',
  'comment.created',
  'timer.started',
  'timer.stopped',
]);

/**
 * Webhook delivery status.
 */
export const webhookStatusEnum = pgEnum('webhook_status', [
  'pending',
  'sending',
  'delivered',
  'failed',
  'retrying',
]);

/**
 * Webhook endpoints registered by users.
 */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Endpoint configuration
    url: text('url').notNull(),
    secret: text('secret').notNull(), // For HMAC signature verification
    description: text('description'),

    // Event subscriptions
    events: text('events').array().notNull(), // Event types to subscribe to

    // Status
    isActive: boolean('is_active').notNull().default(true),
    lastDeliveredAt: timestamp('last_delivered_at'),
    failureCount: integer('failure_count').notNull().default(0),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('webhook_endpoints_user_id_idx').on(table.userId),
    index('webhook_endpoints_is_active_idx').on(table.isActive),
  ],
);

/**
 * Webhook deliveries (outbox pattern).
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Event details
    eventType: webhookEventTypeEnum('event_type').notNull(),
    payload: jsonb('payload').notNull(),

    // Delivery status
    status: webhookStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),

    // Response info
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    errorMessage: text('error_message'),

    // Timestamps
    scheduledFor: timestamp('scheduled_for').notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('webhook_deliveries_endpoint_id_idx').on(table.endpointId),
    index('webhook_deliveries_status_idx').on(table.status),
    index('webhook_deliveries_scheduled_for_idx').on(table.scheduledFor),
  ],
);

/**
 * Audit log for tracking all data changes.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),

    // Action details
    action: text('action').notNull(), // 'create', 'update', 'delete'
    entityType: text('entity_type').notNull(), // 'task', 'project', etc.
    entityId: text('entity_id').notNull(),

    // Change data
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    changedFields: text('changed_fields').array(),

    // Context
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    sessionId: text('session_id'),

    // Timestamp
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_user_id_idx').on(table.userId),
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    index('audit_logs_action_idx').on(table.action),
    index('audit_logs_created_at_idx').on(table.createdAt),
  ],
);

/**
 * Webhook endpoint relations.
 */
export const webhookEndpointsRelations = relations(webhookEndpoints, ({ one, many }) => ({
  user: one(users, {
    fields: [webhookEndpoints.userId],
    references: [users.id],
  }),
  deliveries: many(webhookDeliveries),
}));

/**
 * Webhook delivery relations.
 */
export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  endpoint: one(webhookEndpoints, {
    fields: [webhookDeliveries.endpointId],
    references: [webhookEndpoints.id],
  }),
  user: one(users, {
    fields: [webhookDeliveries.userId],
    references: [users.id],
  }),
}));

/**
 * Audit log relations.
 */
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));
