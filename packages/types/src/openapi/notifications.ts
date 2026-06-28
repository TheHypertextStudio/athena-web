/**
 * Notifications OpenAPI schemas.
 *
 * These schemas define the API contract for notification endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, PaginationQuerySchema, successResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const NotificationChannelSchema = z
  .enum(['email', 'push', 'sms', 'slack', 'in_app'])
  .openapi({
    description: 'Notification delivery channel',
    example: 'email',
  });

export const NotificationPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']).openapi({
  description: 'Notification priority level',
  example: 'normal',
});

// =============================================================================
// Core Notification Schemas
// =============================================================================

export const NotificationSchema = z
  .object({
    id: z.string().openapi({ description: 'Notification ID' }),
    userId: z.uuid().openapi({ description: 'User ID' }),
    title: z.string().openapi({ description: 'Notification title' }),
    body: z.string().openapi({ description: 'Notification body' }),
    channel: NotificationChannelSchema,
    priority: NotificationPrioritySchema,
    read: z.boolean().openapi({ description: 'Whether notification has been read' }),
    actionUrl: z.string().nullable().openapi({ description: 'Action URL' }),
    entityType: z.string().nullable().openapi({ description: 'Related entity type' }),
    entityId: z.string().nullable().openapi({ description: 'Related entity ID' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
  })
  .openapi('Notification');

export const NotificationPreferencesSchema = z
  .object({
    id: z.string().openapi({ description: 'Preferences ID' }),
    userId: z.uuid().openapi({ description: 'User ID' }),
    emailEnabled: z.boolean().openapi({ description: 'Email notifications enabled' }),
    pushEnabled: z.boolean().openapi({ description: 'Push notifications enabled' }),
    smsEnabled: z.boolean().openapi({ description: 'SMS notifications enabled' }),
    slackEnabled: z.boolean().openapi({ description: 'Slack notifications enabled' }),
    inAppEnabled: z.boolean().openapi({ description: 'In-app notifications enabled' }),
    emailAddress: z.string().nullable().openapi({ description: 'Email address for notifications' }),
    phoneNumber: z.string().nullable().openapi({ description: 'Phone number for SMS' }),
    slackWebhookUrl: z.string().nullable().openapi({ description: 'Slack webhook URL' }),
    slackChannel: z.string().nullable().openapi({ description: 'Slack channel' }),
    quietHoursEnabled: z.boolean().openapi({ description: 'Quiet hours enabled' }),
    quietHoursStart: z.string().nullable().openapi({ description: 'Quiet hours start (HH:MM)' }),
    quietHoursEnd: z.string().nullable().openapi({ description: 'Quiet hours end (HH:MM)' }),
    quietHoursTimezone: z.string().nullable().openapi({ description: 'Quiet hours timezone' }),
    taskDeadlineReminders: z.boolean().openapi({ description: 'Task deadline reminders' }),
    taskAssignmentNotifications: z
      .boolean()
      .openapi({ description: 'Task assignment notifications' }),
    taskCompletionNotifications: z
      .boolean()
      .openapi({ description: 'Task completion notifications' }),
    eventReminders: z.boolean().openapi({ description: 'Event reminders' }),
    dailyPlanningReminder: z.boolean().openapi({ description: 'Daily planning reminder' }),
    weeklyReviewReminder: z.boolean().openapi({ description: 'Weekly review reminder' }),
  })
  .openapi('NotificationPreferences');

export const NotificationResultSchema = z
  .object({
    channel: NotificationChannelSchema,
    success: z.boolean().openapi({ description: 'Whether delivery succeeded' }),
    error: z.string().nullable().openapi({ description: 'Error message if failed' }),
  })
  .openapi('NotificationResult');

// =============================================================================
// Path Parameters
// =============================================================================

export const NotificationIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Notification ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('NotificationIdParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const NotificationsQuerySchema = PaginationQuerySchema.openapi('NotificationsQuery');

export const UnreadNotificationsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .openapi({
        description: 'Maximum number of notifications to return',
        example: 50,
        param: { name: 'limit', in: 'query' },
      }),
  })
  .openapi('UnreadNotificationsQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const UpdateNotificationPreferencesRequestSchema = z
  .object({
    emailEnabled: z.boolean().optional(),
    pushEnabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    slackEnabled: z.boolean().optional(),
    inAppEnabled: z.boolean().optional(),
    emailAddress: z.email().optional(),
    phoneNumber: z.string().optional(),
    slackWebhookUrl: z.url().optional(),
    slackChannel: z.string().optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietHoursStart: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    quietHoursEnd: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    quietHoursTimezone: z.string().optional(),
    taskDeadlineReminders: z.boolean().optional(),
    taskAssignmentNotifications: z.boolean().optional(),
    taskCompletionNotifications: z.boolean().optional(),
    eventReminders: z.boolean().optional(),
    dailyPlanningReminder: z.boolean().optional(),
    weeklyReviewReminder: z.boolean().optional(),
  })
  .openapi('UpdateNotificationPreferencesRequest');

export const SendNotificationRequestSchema = z
  .object({
    userId: z.uuid().openapi({ description: 'Target user ID' }),
    title: z.string().min(1).max(200).openapi({ description: 'Notification title' }),
    body: z.string().min(1).max(2000).openapi({ description: 'Notification body' }),
    channels: z.array(NotificationChannelSchema).optional(),
    priority: NotificationPrioritySchema.optional(),
    actionUrl: z.url().optional(),
    entityType: z.string().optional(),
    entityId: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('SendNotificationRequest');

export const ScheduleNotificationRequestSchema = z
  .object({
    userId: z.uuid().openapi({ description: 'Target user ID' }),
    scheduledFor: TimestampSchema.openapi({ description: 'Scheduled delivery time' }),
    recurrenceRule: z
      .string()
      .optional()
      .openapi({ description: 'Recurrence rule (RFC 5545 RRULE)' }),
    notificationType: z.string().openapi({ description: 'Notification type' }),
    channels: z.array(NotificationChannelSchema).openapi({ description: 'Delivery channels' }),
    title: z.string().min(1).max(200).openapi({ description: 'Notification title' }),
    bodyTemplate: z.string().min(1).max(2000).openapi({ description: 'Body template' }),
    data: z.record(z.string(), z.unknown()).optional(),
    actionUrl: z.url().optional(),
    priority: NotificationPrioritySchema.optional(),
  })
  .openapi('ScheduleNotificationRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const NotificationsResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(NotificationSchema),
    meta: z.object({
      limit: z.number(),
      offset: z.number(),
      count: z.number(),
    }),
  })
  .openapi('NotificationsResponse');

export const UnreadNotificationsResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(NotificationSchema),
    meta: z.object({
      count: z.number(),
    }),
  })
  .openapi('UnreadNotificationsResponse');

export const MarkReadResponseSchema = z
  .object({
    success: z.boolean(),
  })
  .openapi('MarkReadResponse');

export const MarkAllReadResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      markedRead: z.number().openapi({ description: 'Number of notifications marked read' }),
    }),
  })
  .openapi('MarkAllReadResponse');

export const NotificationPreferencesResponseSchema = successResponseSchema(
  NotificationPreferencesSchema,
  'Notification preferences response',
).openapi('NotificationPreferencesResponse');

export const SendNotificationResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      results: z.array(NotificationResultSchema),
      successCount: z.number(),
      failureCount: z.number(),
    }),
  })
  .openapi('SendNotificationResponse');

export const ScheduleNotificationResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      id: z.string().openapi({ description: 'Scheduled notification ID' }),
      scheduledFor: TimestampSchema.openapi({ description: 'Scheduled delivery time' }),
    }),
  })
  .openapi('ScheduleNotificationResponse');

export const NotificationChannelsResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      channels: z.array(NotificationChannelSchema),
    }),
  })
  .openapi('NotificationChannelsResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
export type NotificationPriority = z.infer<typeof NotificationPrioritySchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
export type NotificationResult = z.infer<typeof NotificationResultSchema>;
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof UpdateNotificationPreferencesRequestSchema
>;
export type SendNotificationRequest = z.infer<typeof SendNotificationRequestSchema>;
export type ScheduleNotificationRequest = z.infer<typeof ScheduleNotificationRequestSchema>;
