/**
 * Notification route helpers.
 *
 * @packageDocumentation
 */

import type { NotificationResult as ServiceNotificationResult } from '../../services/notifications/types.js';
import type {
  Notification as ApiNotification,
  NotificationPreferences as ApiNotificationPreferences,
  NotificationResult as ApiNotificationResult,
} from '@athena/types/openapi/notifications';
import type { notifications } from '../../db/schema/notifications.js';

type NotificationPreferencesSource = Omit<ApiNotificationPreferences, 'id' | 'userId'> & {
  id?: string;
  userId?: string;
};
type NotificationRow = typeof notifications.$inferSelect;

export const toNotificationPreferences = (
  preferences: NotificationPreferencesSource,
  userId: string,
): ApiNotificationPreferences => ({
  id: preferences.id ?? userId,
  userId: preferences.userId ?? userId,
  emailEnabled: preferences.emailEnabled,
  pushEnabled: preferences.pushEnabled,
  smsEnabled: preferences.smsEnabled,
  slackEnabled: preferences.slackEnabled,
  inAppEnabled: preferences.inAppEnabled,
  emailAddress: preferences.emailAddress ?? null,
  phoneNumber: preferences.phoneNumber ?? null,
  slackWebhookUrl: preferences.slackWebhookUrl ?? null,
  slackChannel: preferences.slackChannel ?? null,
  quietHoursEnabled: preferences.quietHoursEnabled,
  quietHoursStart: preferences.quietHoursStart ?? null,
  quietHoursEnd: preferences.quietHoursEnd ?? null,
  quietHoursTimezone: preferences.quietHoursTimezone ?? null,
  taskDeadlineReminders: preferences.taskDeadlineReminders,
  taskAssignmentNotifications: preferences.taskAssignmentNotifications,
  taskCompletionNotifications: preferences.taskCompletionNotifications,
  eventReminders: preferences.eventReminders,
  dailyPlanningReminder: preferences.dailyPlanningReminder,
  weeklyReviewReminder: preferences.weeklyReviewReminder,
});

export const toNotificationResult = (
  result: ServiceNotificationResult,
): ApiNotificationResult => ({
  channel: result.channel,
  success: result.success,
  error: result.error ?? null,
});

export const toNotification = (notification: NotificationRow): ApiNotification => ({
  id: notification.id,
  userId: notification.userId,
  title: notification.title,
  body: notification.body,
  channel: notification.channel,
  priority: notification.priority,
  read: notification.readAt !== null,
  actionUrl: notification.actionUrl ?? null,
  entityType: notification.entityType ?? null,
  entityId: notification.entityId ?? null,
  createdAt: notification.createdAt,
});
