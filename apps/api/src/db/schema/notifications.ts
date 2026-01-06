/**
 * Notification schema for multi-channel notifications.
 *
 * @packageDocumentation
 */

import { pgTable, text, timestamp, boolean, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth.js';

// ============================================================================
// Enums
// ============================================================================

export const notificationChannelEnum = pgEnum('notification_channel', [
  'email',
  'push',
  'sms',
  'slack',
  'in_app',
]);

export const notificationStatusEnum = pgEnum('notification_status', [
  'pending',
  'sent',
  'delivered',
  'failed',
  'read',
]);

export const notificationPriorityEnum = pgEnum('notification_priority', [
  'low',
  'normal',
  'high',
  'urgent',
]);

// ============================================================================
// Tables
// ============================================================================

/**
 * Notification preferences per user.
 */
export const notificationPreferences = pgTable('notification_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),

  // Channel enablement
  emailEnabled: boolean('email_enabled').notNull().default(true),
  pushEnabled: boolean('push_enabled').notNull().default(true),
  smsEnabled: boolean('sms_enabled').notNull().default(false),
  slackEnabled: boolean('slack_enabled').notNull().default(false),
  inAppEnabled: boolean('in_app_enabled').notNull().default(true),

  // Email preferences
  emailAddress: text('email_address'),
  emailDailyDigest: boolean('email_daily_digest').notNull().default(true),
  emailWeeklyReport: boolean('email_weekly_report').notNull().default(true),

  // Push notification preferences
  pushDeviceTokens: jsonb('push_device_tokens'), // Array of device tokens

  // SMS preferences
  phoneNumber: text('phone_number'),
  smsUrgentOnly: boolean('sms_urgent_only').notNull().default(true),

  // Slack preferences
  slackWebhookUrl: text('slack_webhook_url'),
  slackChannel: text('slack_channel'),

  // Quiet hours
  quietHoursEnabled: boolean('quiet_hours_enabled').notNull().default(false),
  quietHoursStart: text('quiet_hours_start'), // HH:MM format
  quietHoursEnd: text('quiet_hours_end'), // HH:MM format
  quietHoursTimezone: text('quiet_hours_timezone'),

  // Notification types
  taskDeadlineReminders: boolean('task_deadline_reminders').notNull().default(true),
  taskAssignmentNotifications: boolean('task_assignment_notifications').notNull().default(true),
  taskCompletionNotifications: boolean('task_completion_notifications').notNull().default(true),
  eventReminders: boolean('event_reminders').notNull().default(true),
  dailyPlanningReminder: boolean('daily_planning_reminder').notNull().default(true),
  weeklyReviewReminder: boolean('weekly_review_reminder').notNull().default(true),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Individual notifications sent to users.
 */
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  channel: notificationChannelEnum('channel').notNull(),
  status: notificationStatusEnum('status').notNull().default('pending'),
  priority: notificationPriorityEnum('priority').notNull().default('normal'),

  // Content
  title: text('title').notNull(),
  body: text('body').notNull(),
  /** JSON data for rich content or action buttons */
  data: jsonb('data'),
  /** Deep link URL for the notification */
  actionUrl: text('action_url'),

  // Delivery tracking
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  readAt: timestamp('read_at'),
  failedAt: timestamp('failed_at'),
  failureReason: text('failure_reason'),

  // External references
  /** External ID from email/push/SMS provider */
  externalId: text('external_id'),
  /** Related entity type (task, event, project, etc.) */
  entityType: text('entity_type'),
  /** Related entity ID */
  entityId: text('entity_id'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Scheduled notifications (for reminders, digests, etc.).
 */
export const scheduledNotifications = pgTable('scheduled_notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // Scheduling
  scheduledFor: timestamp('scheduled_for').notNull(),
  /** RRULE for recurring notifications */
  recurrenceRule: text('recurrence_rule'),

  // Content template
  notificationType: text('notification_type').notNull(),
  channels: text('channels').array().notNull(), // Array of channels
  title: text('title').notNull(),
  bodyTemplate: text('body_template').notNull(),
  data: jsonb('data'),
  actionUrl: text('action_url'),
  priority: notificationPriorityEnum('priority').notNull().default('normal'),

  // Status
  isActive: boolean('is_active').notNull().default(true),
  lastSentAt: timestamp('last_sent_at'),
  nextRunAt: timestamp('next_run_at'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================================================
// Relations
// ============================================================================

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [notificationPreferences.userId],
    references: [users.id],
  }),
}));

export const notificationRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const scheduledNotificationRelations = relations(scheduledNotifications, ({ one }) => ({
  user: one(users, {
    fields: [scheduledNotifications.userId],
    references: [users.id],
  }),
}));
